import { errorMessage, log } from "./log.js";

export type ShopifyUserError = { field?: string[]; message: string };
export type ShopifyAddress = { address1: string; address2?: string; city: string; province?: string; country: string; zip: string; firstName: string; lastName: string; phone?: string };
export type ShopifyLineItem = { variantId: string; quantity: number };
export type ShopifyVariant = { id: string; title: string; sku: string | null; price: string; inventoryQuantity: number | null; inventoryPolicy: "CONTINUE" | "DENY"; availableForSale: boolean; product: { id: string; title: string; handle: string; status: string; featuredMedia?: { preview?: { image?: { url: string } } } | null } };
export type ShopifyDraft = { id: string; name: string; invoiceUrl: string | null; status: string; totalPrice: string; currencyCode: string };

export function quoteTags(quoteId: string): string[] {
  // Shopify limits individual tags to 40 characters. The complete quote ID is
  // still stored in the note and custom attribute for reconciliation.
  return ["setareh", `q:${quoteId}`];
}

type GraphQlResponse<T> = { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };

/** Per-call deadline for the Admin API; a hung call must not hold a paid quote open indefinitely. */
const SHOPIFY_TIMEOUT_MS = Number(process.env.SHOPIFY_TIMEOUT_MS) > 0 ? Number(process.env.SHOPIFY_TIMEOUT_MS) : 10_000;
const MAX_BACKOFF_MS = 5_000;

/** Thrown for failures that may succeed on a retry: throttling, 5xx, network errors and timeouts. */
export class ShopifyTransientError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) { super(message); this.name = "ShopifyTransientError"; }
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const variantFields = `id title sku price inventoryQuantity inventoryPolicy availableForSale product { id title handle status featuredMedia { preview { image { url } } } }`;

export type ShopifyAccessTokenProvider = { readonly mode: string; getAccessToken(): Promise<string> };

/** Client credentials grant: only valid when the app and the store belong to the same Shopify organization. */
export class ClientCredentialsTokenProvider implements ShopifyAccessTokenProvider {
  readonly mode = "client_credentials";
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;

  constructor(private readonly storeDomain: string, private readonly clientId: string, private readonly clientSecret: string) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    const response = await fetch(`https://${this.storeDomain}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret }) });
    const payload = await response.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !payload.access_token) throw new Error(`Shopify token request failed (${response.status}): ${payload.error_description ?? payload.error ?? "unknown error"}`);
    this.accessToken = payload.access_token;
    this.tokenExpiresAt = Date.now() + (payload.expires_in ?? 86_399) * 1_000;
    return this.accessToken;
  }
}

export type ShopifyEnvironment = { storeDomain: string; clientId: string; clientSecret: string; apiVersion: string };

export function shopifyEnvironment(): ShopifyEnvironment {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim().toLowerCase();
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!storeDomain || !clientId || !clientSecret) throw new Error("Shopify is not configured. Set SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in backend/.env.");
  return { storeDomain, clientId, clientSecret, apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-10" };
}

export class ShopifyClient {
  private readonly endpoint: string;
  private readonly accessScopesEndpoint: string;

  private readonly timeoutMs: number;

  constructor(private readonly storeDomain: string, apiVersion: string, private readonly tokens: ShopifyAccessTokenProvider, options: { baseUrl?: string; timeoutMs?: number } = {}) {
    const base = options.baseUrl ?? `https://${storeDomain}`;
    this.endpoint = `${base}/admin/api/${apiVersion}/graphql.json`;
    this.accessScopesEndpoint = `${base}/admin/oauth/access_scopes.json`;
    this.timeoutMs = options.timeoutMs ?? SHOPIFY_TIMEOUT_MS;
  }

  async searchVariants(query: string, limit: number): Promise<ShopifyVariant[]> {
    const data = await this.graphql<{ productVariants: { nodes: ShopifyVariant[] } }>(`query SearchVariants($first: Int!, $query: String!) { productVariants(first: $first, query: $query) { nodes { ${variantFields} } } }`, { first: limit, query: `status:active ${query}`.trim() }, { retries: 2 });
    return data.productVariants.nodes;
  }

  async getVariant(id: string): Promise<ShopifyVariant | null> {
    const data = await this.graphql<{ productVariant: ShopifyVariant | null }>(`query Variant($id: ID!) { productVariant(id: $id) { ${variantFields} } }`, { id }, { retries: 2 });
    return data.productVariant;
  }

  async getAccessScopes(): Promise<string[]> {
    const response = await fetch(this.accessScopesEndpoint, { headers: { "X-Shopify-Access-Token": await this.tokens.getAccessToken() } });
    const payload = await response.json() as { access_scopes?: Array<{ handle?: string }> };
    if (!response.ok || !payload.access_scopes) throw new Error(`Unable to inspect Shopify access scopes (${response.status}).`);
    return payload.access_scopes.flatMap((scope) => scope.handle ? [scope.handle] : []);
  }

  async createDraftOrder(input: { items: ShopifyLineItem[]; email: string; shippingAddress: ShopifyAddress; quoteId: string; shippingLine?: { title: string; price: number } }): Promise<ShopifyDraft> {
    const data = await this.graphql<{ draftOrderCreate: { draftOrder: ShopifyDraft | null; userErrors: ShopifyUserError[] } }>(
      `mutation CreateDraft($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id name invoiceUrl status totalPrice currencyCode } userErrors { field message } } }`,
      { input: { email: input.email, lineItems: input.items, shippingAddress: input.shippingAddress, shippingLine: input.shippingLine, tags: quoteTags(input.quoteId), note: `Setareh quote ${input.quoteId}. Payment must settle through Stellar x402 before completion.`, customAttributes: [{ key: "setareh_quote_id", value: input.quoteId }] } },
    );
    assertNoUserErrors(data.draftOrderCreate.userErrors, "Unable to create Shopify draft order");
    if (!data.draftOrderCreate.draftOrder) throw new Error("Shopify did not return a draft order.");
    return data.draftOrderCreate.draftOrder;
  }

  async completeDraftOrder(id: string): Promise<{ id: string; name: string }> {
    const data = await this.graphql<{ draftOrderComplete: { draftOrder: { order: { id: string; name: string } | null } | null; userErrors: ShopifyUserError[] } }>(`mutation CompleteDraft($id: ID!) { draftOrderComplete(id: $id) { draftOrder { order { id name } } userErrors { field message } } }`, { id });
    assertNoUserErrors(data.draftOrderComplete.userErrors, "Unable to complete Shopify draft order");
    const order = data.draftOrderComplete.draftOrder?.order;
    if (!order) throw new Error("Shopify did not return an order after completing the draft.");
    return order;
  }

  async attachPaymentEvidence(orderId: string, evidence: { quoteId: string; network: string; asset: string; transactionHash?: string }) {
    const value = JSON.stringify({ quoteId: evidence.quoteId, network: evidence.network, asset: evidence.asset, transactionHash: evidence.transactionHash ?? null });
    const data = await this.graphql<{ orderUpdate: { order: { id: string } | null; userErrors: ShopifyUserError[] } }>(
      `mutation AttachSetarehPayment($input: OrderInput!) {
        orderUpdate(input: $input) {
          order { id }
          userErrors { field message }
        }
      }`,
      { input: { id: orderId, metafields: [{ namespace: "setareh", key: "stellar_payment", type: "json", value }] } },
      // Setting the same metafield twice is idempotent, so one retry cannot duplicate anything.
      { retries: 1 },
    );
    assertNoUserErrors(data.orderUpdate.userErrors, "Unable to attach Stellar payment evidence to Shopify order");
    if (!data.orderUpdate.order) throw new Error("Shopify did not return an order after attaching payment evidence.");
  }

  async getDraftOrder(id: string): Promise<{ id: string; name: string; status: string; invoiceUrl: string | null; totalPrice: string; currencyCode: string; order: { id: string; name: string } | null } | null> {
    const data = await this.graphql<{ node: { id: string; name: string; status: string; invoiceUrl: string | null; totalPrice: string; currencyCode: string; order: { id: string; name: string } | null } | null }>(`query Draft($id: ID!) { node(id: $id) { ... on DraftOrder { id name status invoiceUrl totalPrice currencyCode order { id name } } } }`, { id }, { retries: 2 });
    return data.node;
  }

  async getDraftStatus(id: string): Promise<{ id: string; name: string; status: string; completedAt: string | null } | null> {
    const data = await this.graphql<{ node: { id: string; name: string; status: string; completedAt: string | null } | null }>(`query DraftStatus($id: ID!) { node(id: $id) { ... on DraftOrder { id name status completedAt } } }`, { id }, { retries: 2 });
    return data.node;
  }

  /**
   * One Admin API call under a deadline. `retries` must only be set by callers whose operation is safe to
   * repeat (reads, idempotent updates): draft creation and completion are never retried here, because a
   * lost response may still have created the order; that case belongs to reconciliation.
   */
  async graphql<T>(query: string, variables: Record<string, unknown> = {}, options: { retries?: number } = {}): Promise<T> {
    const retries = options.retries ?? 0;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.graphqlOnce<T>(query, variables, attempt);
      } catch (error) {
        if (!(error instanceof ShopifyTransientError) || attempt > retries) throw error;
        await sleep(Math.min(error.retryAfterMs ?? 500 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
      }
    }
  }

  private async graphqlOnce<T>(query: string, variables: Record<string, unknown>, attempt: number): Promise<T> {
    // Only the operation name is logged: variables carry buyer email and shipping address.
    const operation = /^\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "anonymous";
    const startedAt = performance.now();
    let httpStatus: number | undefined;
    try {
      let response: Response;
      try {
        response = await fetch(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await this.tokens.getAccessToken() }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new ShopifyTransientError(timedOut ? `Shopify Admin API timed out after ${this.timeoutMs} ms.` : `Shopify Admin API unreachable: ${errorMessage(error)}`);
      }
      httpStatus = response.status;
      if (response.status === 401) throw new Error(`Shopify rejected Setareh's access token (401) using ${this.tokens.mode}. Verify that the app is still installed on ${this.storeDomain}.`);
      if (response.status === 429 || response.status >= 500) throw new ShopifyTransientError(`Shopify Admin API error (${response.status}): ${response.statusText}`, retryAfterMs(response));
      const payload = await response.json() as GraphQlResponse<T>;
      if (payload.errors?.some((error) => error.extensions?.code === "THROTTLED")) throw new ShopifyTransientError("Shopify Admin API throttled the request.", retryAfterMs(response));
      if (!response.ok || payload.errors?.length) throw new Error(`Shopify Admin API error (${response.status}): ${payload.errors?.map((error) => error.message).join("; ") ?? response.statusText}`);
      if (!payload.data) throw new Error("Shopify Admin API returned no data.");
      log("info", "shopify.call", { operation, httpStatus, attempt, durationMs: Math.round(performance.now() - startedAt) });
      return payload.data;
    } catch (error) {
      log("warn", "shopify.call", { operation, httpStatus, attempt, durationMs: Math.round(performance.now() - startedAt), message: errorMessage(error) });
      throw error;
    }
  }


  /** Creates or repoints the app/uninstalled subscription for this store. Idempotent; returns the subscription id. */
  async ensureUninstallWebhook(callbackUrl: string): Promise<{ id: string; action: "created" | "updated" | "unchanged" }> {
    const existing = await this.graphql<{ webhookSubscriptions: { nodes: Array<{ id: string; endpoint: { __typename: string; callbackUrl?: string } }> } }>(
      `query SetarehUninstallWebhook { webhookSubscriptions(first: 10, topics: [APP_UNINSTALLED]) { nodes { id endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`,
    );
    const http = existing.webhookSubscriptions.nodes.filter((node) => node.endpoint.__typename === "WebhookHttpEndpoint");
    const current = http.find((node) => node.endpoint.callbackUrl === callbackUrl);
    if (current) return { id: current.id, action: "unchanged" };
    if (http[0]) {
      const data = await this.graphql<{ webhookSubscriptionUpdate: { webhookSubscription: { id: string } | null; userErrors: ShopifyUserError[] } }>(
        `mutation UpdateSetarehUninstallWebhook($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) { webhookSubscription { id } userErrors { field message } } }`,
        { id: http[0].id, webhookSubscription: { callbackUrl, format: "JSON" } },
      );
      assertNoUserErrors(data.webhookSubscriptionUpdate.userErrors, "Unable to update the app/uninstalled webhook");
      return { id: http[0].id, action: "updated" };
    }
    const data = await this.graphql<{ webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: ShopifyUserError[] } }>(
      `mutation CreateSetarehUninstallWebhook($webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription: $webhookSubscription) { webhookSubscription { id } userErrors { field message } } }`,
      { webhookSubscription: { callbackUrl, format: "JSON" } },
    );
    assertNoUserErrors(data.webhookSubscriptionCreate.userErrors, "Unable to create the app/uninstalled webhook");
    if (!data.webhookSubscriptionCreate.webhookSubscription) throw new Error("Shopify did not return the app/uninstalled webhook subscription.");
    return { id: data.webhookSubscriptionCreate.webhookSubscription.id, action: "created" };
  }

  get domain() { return this.storeDomain; }
  get authMode() { return this.tokens.mode; }
}

export function assertNoUserErrors(errors: ShopifyUserError[], action: string) { if (errors.length) throw new Error(`${action}: ${errors.map((error) => error.message).join("; ")}`); }
export function availability(variant: ShopifyVariant, quantity: number) {
  const remaining = variant.inventoryQuantity;
  if (variant.availableForSale && (remaining === null || remaining >= quantity)) return { status: "READY_TO_SHIP" as const, canPurchase: true, inventoryQuantity: remaining, disclosure: "Disponible para despacho según las condiciones de la tienda." };
  if (variant.inventoryPolicy === "CONTINUE") return { status: "MADE_TO_ORDER" as const, canPurchase: true, inventoryQuantity: remaining, disclosure: "Se puede pedir por encargo. El agente debe confirmar plazo de elaboración antes de pagar." };
  return { status: "OUT_OF_STOCK" as const, canPurchase: false, inventoryQuantity: remaining, disclosure: "No disponible para compra ahora." };
}
