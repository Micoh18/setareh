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

type GraphQlResponse<T> = { data?: T; errors?: Array<{ message: string }> };
const variantFields = `id title sku price inventoryQuantity inventoryPolicy availableForSale product { id title handle status featuredMedia { preview { image { url } } } }`;

export class ShopifyClient {
  private readonly endpoint: string;
  private readonly accessScopesEndpoint: string;
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;

  constructor(private readonly storeDomain: string, private readonly clientId: string, private readonly clientSecret: string, apiVersion: string) {
    this.endpoint = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;
    this.accessScopesEndpoint = `https://${storeDomain}/admin/oauth/access_scopes.json`;
  }

  static fromEnvironment(): ShopifyClient {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2026-10";
    if (!storeDomain || !clientId || !clientSecret) throw new Error("Shopify is not configured. Set SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in backend/.env.");
    return new ShopifyClient(storeDomain, clientId, clientSecret, apiVersion);
  }

  async searchVariants(query: string, limit: number): Promise<ShopifyVariant[]> {
    const data = await this.graphql<{ productVariants: { nodes: ShopifyVariant[] } }>(`query SearchVariants($first: Int!, $query: String!) { productVariants(first: $first, query: $query) { nodes { ${variantFields} } } }`, { first: limit, query: `status:active ${query}`.trim() });
    return data.productVariants.nodes;
  }

  async getVariant(id: string): Promise<ShopifyVariant | null> {
    const data = await this.graphql<{ productVariant: ShopifyVariant | null }>(`query Variant($id: ID!) { productVariant(id: $id) { ${variantFields} } }`, { id });
    return data.productVariant;
  }

  async getAccessScopes(): Promise<string[]> {
    const response = await fetch(this.accessScopesEndpoint, { headers: { "X-Shopify-Access-Token": await this.getAccessToken() } });
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
    );
    assertNoUserErrors(data.orderUpdate.userErrors, "Unable to attach Stellar payment evidence to Shopify order");
    if (!data.orderUpdate.order) throw new Error("Shopify did not return an order after attaching payment evidence.");
  }

  async getDraftOrder(id: string): Promise<{ id: string; name: string; status: string; invoiceUrl: string | null; totalPrice: string; currencyCode: string; order: { id: string; name: string } | null } | null> {
    const data = await this.graphql<{ node: { id: string; name: string; status: string; invoiceUrl: string | null; totalPrice: string; currencyCode: string; order: { id: string; name: string } | null } | null }>(`query Draft($id: ID!) { node(id: $id) { ... on DraftOrder { id name status invoiceUrl totalPrice currencyCode order { id name } } } }`, { id });
    return data.node;
  }

  async getDraftStatus(id: string): Promise<{ id: string; name: string; status: string; completedAt: string | null } | null> {
    const data = await this.graphql<{ node: { id: string; name: string; status: string; completedAt: string | null } | null }>(`query DraftStatus($id: ID!) { node(id: $id) { ... on DraftOrder { id name status completedAt } } }`, { id });
    return data.node;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await this.getAccessToken() }, body: JSON.stringify({ query, variables }) });
    const payload = await response.json() as GraphQlResponse<T>;
    if (!response.ok || payload.errors?.length) throw new Error(`Shopify Admin API error (${response.status}): ${payload.errors?.map((error) => error.message).join("; ") ?? response.statusText}`);
    if (!payload.data) throw new Error("Shopify Admin API returned no data.");
    return payload.data;
  }

  get domain() { return this.storeDomain; }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    const response = await fetch(`https://${this.storeDomain}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret }) });
    const payload = await response.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !payload.access_token) throw new Error(`Shopify token request failed (${response.status}): ${payload.error_description ?? payload.error ?? "unknown error"}`);
    this.accessToken = payload.access_token;
    this.tokenExpiresAt = Date.now() + (payload.expires_in ?? 86_399) * 1_000;
    return this.accessToken;
  }
}

export function assertNoUserErrors(errors: ShopifyUserError[], action: string) { if (errors.length) throw new Error(`${action}: ${errors.map((error) => error.message).join("; ")}`); }
export function availability(variant: ShopifyVariant, quantity: number) {
  const remaining = variant.inventoryQuantity;
  if (variant.availableForSale && (remaining === null || remaining >= quantity)) return { status: "READY_TO_SHIP" as const, canPurchase: true, inventoryQuantity: remaining, disclosure: "Disponible para despacho según las condiciones de la tienda." };
  if (variant.inventoryPolicy === "CONTINUE") return { status: "MADE_TO_ORDER" as const, canPurchase: true, inventoryQuantity: remaining, disclosure: "Se puede pedir por encargo. El agente debe confirmar plazo de elaboración antes de pagar." };
  return { status: "OUT_OF_STOCK" as const, canPurchase: false, inventoryQuantity: remaining, disclosure: "No disponible para compra ahora." };
}
