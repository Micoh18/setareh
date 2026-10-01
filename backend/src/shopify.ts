export type ShopifyUserError = { field?: string[]; message: string };

type GraphQlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export class ShopifyClient {
  private readonly endpoint: string;
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;

  constructor(
    private readonly storeDomain: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    apiVersion: string,
  ) {
    this.endpoint = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;
  }

  static fromEnvironment(): ShopifyClient {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2026-07";

    if (!storeDomain || !clientId || !clientSecret) {
      throw new Error(
        "Shopify is not configured. Set SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in backend/.env.",
      );
    }

    return new ShopifyClient(storeDomain, clientId, clientSecret, apiVersion);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;

    const response = await fetch(`https://${this.storeDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    const payload = (await response.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !payload.access_token) {
      throw new Error(`Shopify token request failed (${response.status}): ${payload.error_description ?? payload.error ?? "unknown error"}`);
    }
    this.accessToken = payload.access_token;
    this.tokenExpiresAt = Date.now() + (payload.expires_in ?? 86_399) * 1_000;
    return this.accessToken;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": await this.getAccessToken(),
      },
      body: JSON.stringify({ query, variables }),
    });

    const payload = (await response.json()) as GraphQlResponse<T>;
    if (!response.ok || payload.errors?.length) {
      const details = payload.errors?.map((error) => error.message).join("; ") ?? response.statusText;
      throw new Error(`Shopify Admin API error (${response.status}): ${details}`);
    }
    if (!payload.data) throw new Error("Shopify Admin API returned no data.");
    return payload.data;
  }

  get domain(): string {
    return this.storeDomain;
  }
}

export function assertNoUserErrors(errors: ShopifyUserError[], action: string): void {
  if (errors.length) {
    throw new Error(`${action}: ${errors.map((error) => error.message).join("; ")}`);
  }
}
