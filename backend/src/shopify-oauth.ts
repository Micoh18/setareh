import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SetarehDatabase, ShopifyInstallationRecord } from "./db.js";
import { ClientCredentialsTokenProvider, ShopifyClient, shopifyEnvironment, type ShopifyAccessTokenProvider } from "./shopify.js";

/** Admin API scopes Setareh needs on every installed store. */
export const SHOPIFY_REQUIRED_SCOPES = ["read_products", "read_inventory", "write_draft_orders", "read_orders", "write_orders"] as const;

export const SHOPIFY_INSTALL_PATH = "/shopify/install";
export const SHOPIFY_CALLBACK_PATH = "/shopify/oauth/callback";
export const SHOPIFY_UNINSTALLED_WEBHOOK_PATH = "/shopify/webhooks/app-uninstalled";

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
// Anchored at both ends so hosts such as "shop.myshopify.com.attacker.example" are rejected.
const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export class ShopifyOAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

export function isValidShopDomain(shop: unknown): shop is string {
  return typeof shop === "string" && shop.length <= 255 && SHOP_DOMAIN_PATTERN.test(shop);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Message Shopify signs on OAuth and app-launch redirects: every param except hmac/signature, sorted, as key=value joined by "&". */
export function queryHmacMessage(params: URLSearchParams) {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of params) if (key !== "hmac" && key !== "signature") entries.push([key, value]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([key, value]) => `${key}=${value}`).join("&");
}

export function verifyQueryHmac(params: URLSearchParams, clientSecret: string) {
  const received = params.getAll("hmac");
  if (received.length !== 1) return false;
  // Repeated keys are never produced by Shopify and would make the signed message ambiguous.
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return false;
  const expected = createHmac("sha256", clientSecret).update(queryHmacMessage(params)).digest("hex");
  return safeEqual(expected, received[0].toLowerCase());
}

export function verifyWebhookHmac(rawBody: Buffer, header: string | undefined, clientSecret: string) {
  if (!header) return false;
  const expected = createHmac("sha256", clientSecret).update(rawBody).digest("base64");
  return safeEqual(expected, header);
}

/** AES-256-GCM for Shopify tokens at rest. The shop domain is bound as associated data, so a token row cannot be replayed for another shop. */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) throw new Error("SETAREH_TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as base64.");
    this.key = key;
  }

  encrypt(plaintext: string, shop: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(shop, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
  }

  decrypt(sealed: string, shop: string) {
    if (!sealed.startsWith("v1:")) throw new Error("Unsupported Shopify token encoding.");
    const raw = Buffer.from(sealed.slice(3), "base64url");
    if (raw.length < 29) throw new Error("Corrupted Shopify token.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(shop, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}

type TokenResponse = { access_token?: string; scope?: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number; error?: string; error_description?: string };
type TokenSet = { accessToken: string; scope: string; accessTokenExpiresAt: string | null; refreshToken: string | null; refreshTokenExpiresAt: string | null };

export type ShopifyOAuthOptions = {
  db: SetarehDatabase;
  cipher: TokenCipher;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: readonly string[];
  fetch?: typeof fetch;
  /** Overridable for tests; production always talks to https://{shop}. */
  adminOrigin?: (shop: string) => string;
  /** Runs after tokens are stored, e.g. to subscribe the uninstall webhook. Failures are logged, not fatal. */
  onInstalled?: (shop: string) => Promise<void>;
};

/** Authorization code grant with expiring offline tokens, as Shopify requires for apps installed on other organizations' stores. */
export class ShopifyOAuth {
  readonly scopes: readonly string[];
  private readonly fetchImpl: typeof fetch;
  private readonly adminOrigin: (shop: string) => string;
  private readonly refreshes = new Map<string, Promise<string>>();

  constructor(private readonly options: ShopifyOAuthOptions) {
    this.scopes = options.scopes ?? SHOPIFY_REQUIRED_SCOPES;
    this.fetchImpl = options.fetch ?? fetch;
    this.adminOrigin = options.adminOrigin ?? ((shop) => `https://${shop}`);
  }

  get clientSecret() { return this.options.clientSecret; }

  /** Starts an install: stores a single-use state nonce and returns Shopify's consent URL. */
  beginInstall(shop: string) {
    if (!isValidShopDomain(shop)) throw new ShopifyOAuthError("invalid_shop", "shop must be a *.myshopify.com domain.");
    const state = randomBytes(24).toString("base64url");
    this.options.db.createOAuthState(state, shop.toLowerCase(), new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString());
    const url = new URL(`${this.adminOrigin(shop.toLowerCase())}/admin/oauth/authorize`);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("scope", this.scopes.join(","));
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  /** Validates Shopify's callback, exchanges the code and stores the encrypted tokens. */
  async completeInstall(params: URLSearchParams) {
    const shop = params.get("shop");
    if (!isValidShopDomain(shop)) throw new ShopifyOAuthError("invalid_shop", "Invalid shop in OAuth callback.");
    if (!verifyQueryHmac(params, this.options.clientSecret)) throw new ShopifyOAuthError("invalid_hmac", "OAuth callback signature is invalid.", 401);
    const state = params.get("state");
    const pending = state ? this.options.db.consumeOAuthState(state) : undefined;
    if (!pending || pending.shop !== shop.toLowerCase()) throw new ShopifyOAuthError("invalid_state", "OAuth state is missing, expired, already used or for another shop.", 401);
    const code = params.get("code");
    if (!code) throw new ShopifyOAuthError("missing_code", "OAuth callback did not include an authorization code.");

    const tokens = await this.requestTokens(shop.toLowerCase(), { code, expiring: "1" });
    const granted = tokens.scope.split(",").map((scope) => scope.trim()).filter(Boolean);
    const missing = this.scopes.filter((scope) => !granted.includes(scope));
    if (missing.length) throw new ShopifyOAuthError("missing_scopes", `Shopify did not grant required scopes: ${missing.join(", ")}.`);
    this.saveTokens(shop.toLowerCase(), tokens);
    if (this.options.onInstalled) {
      try { await this.options.onInstalled(shop.toLowerCase()); } catch (error) { console.error(`Post-install step failed for ${shop.toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return { shop: shop.toLowerCase(), scopes: granted };
  }

  /** Called from the app/uninstalled webhook: Shopify has already revoked the tokens; drop our copies. */
  revoke(shop: string) {
    if (!isValidShopDomain(shop)) return false;
    return this.options.db.revokeShopifyInstallation(shop.toLowerCase());
  }

  installationStatus(shop: string) {
    const installation = this.options.db.getShopifyInstallation(shop.toLowerCase());
    if (!installation) return { installed: false as const };
    return { installed: installation.status === "active", status: installation.status, scopes: installation.scope.split(","), refreshTokenExpiresAt: installation.refreshTokenExpiresAt, updatedAt: installation.updatedAt };
  }

  /** Returns a valid Admin API token, refreshing it at most once at a time per shop. */
  async getAccessToken(shop: string): Promise<string> {
    const normalized = shop.toLowerCase();
    const installation = this.activeInstallation(normalized);
    if (!installation.accessTokenExpiresAt || new Date(installation.accessTokenExpiresAt).getTime() - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.options.cipher.decrypt(installation.accessTokenEnc!, normalized);
    }
    const inFlight = this.refreshes.get(normalized);
    if (inFlight) return inFlight;
    const refresh = this.refresh(normalized, installation).finally(() => this.refreshes.delete(normalized));
    this.refreshes.set(normalized, refresh);
    return refresh;
  }

  tokenProvider(shop: string): ShopifyAccessTokenProvider {
    return { mode: "authorization_code", getAccessToken: () => this.getAccessToken(shop) };
  }

  private activeInstallation(shop: string): ShopifyInstallationRecord {
    const installation = this.options.db.getShopifyInstallation(shop);
    if (!installation || installation.status !== "active" || !installation.accessTokenEnc) {
      throw new Error(`Setareh is not installed on ${shop}. Ask the store to install the app through ${SHOPIFY_INSTALL_PATH}?shop=${shop}.`);
    }
    return installation;
  }

  private async refresh(shop: string, installation: ShopifyInstallationRecord) {
    if (!installation.refreshTokenEnc || (installation.refreshTokenExpiresAt && new Date(installation.refreshTokenExpiresAt).getTime() <= Date.now())) {
      throw new Error(`The Shopify authorization for ${shop} expired. Ask the store to open ${SHOPIFY_INSTALL_PATH}?shop=${shop} again.`);
    }
    const refreshToken = this.options.cipher.decrypt(installation.refreshTokenEnc, shop);
    const tokens = await this.requestTokens(shop, { grant_type: "refresh_token", refresh_token: refreshToken });
    // Shopify rotates refresh tokens; persist the new pair before using the access token.
    this.saveTokens(shop, { ...tokens, scope: tokens.scope || installation.scope });
    return tokens.accessToken;
  }

  private async requestTokens(shop: string, grant: Record<string, string>): Promise<TokenSet> {
    const response = await this.fetchImpl(`${this.adminOrigin(shop)}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: this.options.clientId, client_secret: this.options.clientSecret, ...grant }),
    });
    const payload = await response.json().catch(() => ({})) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new ShopifyOAuthError("token_request_failed", `Shopify token request failed (${response.status}): ${payload.error_description ?? payload.error ?? "unknown error"}`, 502);
    }
    const at = Date.now();
    return {
      accessToken: payload.access_token,
      scope: payload.scope ?? "",
      accessTokenExpiresAt: payload.expires_in ? new Date(at + payload.expires_in * 1_000).toISOString() : null,
      refreshToken: payload.refresh_token ?? null,
      refreshTokenExpiresAt: payload.refresh_token_expires_in ? new Date(at + payload.refresh_token_expires_in * 1_000).toISOString() : null,
    };
  }

  private saveTokens(shop: string, tokens: TokenSet) {
    const { cipher } = this.options;
    this.options.db.saveShopifyInstallation({
      shop,
      scope: tokens.scope,
      accessTokenEnc: cipher.encrypt(tokens.accessToken, shop),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenEnc: tokens.refreshToken ? cipher.encrypt(tokens.refreshToken, shop) : null,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    });
  }
}

export type ShopifyAuthMode = "client_credentials" | "authorization_code";

export function shopifyAuthMode(raw = process.env.SHOPIFY_AUTH_MODE): ShopifyAuthMode {
  const value = raw?.trim().toLowerCase() || "client_credentials";
  if (value !== "client_credentials" && value !== "authorization_code") throw new Error("SHOPIFY_AUTH_MODE must be client_credentials or authorization_code.");
  return value;
}

/** Builds the OAuth service when the instance can receive installs: app credentials, a public base URL and a token encryption key. */
export function shopifyOAuthFromEnvironment(db: SetarehDatabase, baseUrl: string | undefined): ShopifyOAuth | undefined {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  const encryptionKey = process.env.SETAREH_TOKEN_ENCRYPTION_KEY?.trim();
  if (!clientId || !clientSecret || !encryptionKey || !baseUrl) {
    if (shopifyAuthMode() === "authorization_code") {
      throw new Error("SHOPIFY_AUTH_MODE=authorization_code requires SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SETAREH_TOKEN_ENCRYPTION_KEY and SETAREH_BASE_URL.");
    }
    return undefined;
  }
  const origin = baseUrl.replace(/\/+$/, "");
  const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2026-10";
  const oauth: ShopifyOAuth = new ShopifyOAuth({
    db, cipher: new TokenCipher(encryptionKey), clientId, clientSecret, redirectUri: `${origin}${SHOPIFY_CALLBACK_PATH}`,
    onInstalled: async (shop) => {
      const result = await new ShopifyClient(shop, apiVersion, oauth.tokenProvider(shop)).ensureUninstallWebhook(`${origin}${SHOPIFY_UNINSTALLED_WEBHOOK_PATH}`);
      console.error(`app/uninstalled webhook ${result.action} for ${shop}`);
    },
  });
  return oauth;
}

/** Wires the Shopify client for the configured store with the selected authentication mode. */
export function createShopifyRuntime(db: SetarehDatabase, baseUrl: string | undefined) {
  const environment = shopifyEnvironment();
  const mode = shopifyAuthMode();
  if (!isValidShopDomain(environment.storeDomain)) throw new Error("SHOPIFY_STORE_DOMAIN must be a *.myshopify.com domain.");
  const oauth = shopifyOAuthFromEnvironment(db, baseUrl);
  const tokens = mode === "authorization_code"
    ? oauth!.tokenProvider(environment.storeDomain)
    : new ClientCredentialsTokenProvider(environment.storeDomain, environment.clientId, environment.clientSecret);
  return { mode, oauth, client: new ShopifyClient(environment.storeDomain, environment.apiVersion, tokens) };
}
