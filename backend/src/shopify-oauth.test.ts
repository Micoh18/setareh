import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createHttpApp } from "./http.js";
import { SHOPIFY_REQUIRED_SCOPES, ShopifyOAuth, TokenCipher, isValidShopDomain, queryHmacMessage, verifyQueryHmac, verifyWebhookHmac } from "./shopify-oauth.js";

const clientId = "test-client-id";
const clientSecret = "test-client-secret";
const shop = "artesano-piloto.myshopify.com";
const merchantAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function sign(params: URLSearchParams, secret = clientSecret) {
  params.set("hmac", createHmac("sha256", secret).update(queryHmacMessage(params)).digest("hex"));
  return params;
}

type TokenCall = Record<string, string>;

/** Fake of Shopify's token endpoint; every grant hands out a fresh rotating pair. */
function fakeShopify(options: { scope?: string; expiresIn?: number } = {}) {
  const calls: TokenCall[] = [];
  let issued = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    assert.equal(String(url), `https://${shop}/admin/oauth/access_token`);
    const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
    calls.push(body);
    if (body.client_secret !== clientSecret) return new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
    issued += 1;
    return new Response(JSON.stringify({ access_token: `access-${issued}`, scope: options.scope ?? SHOPIFY_REQUIRED_SCOPES.join(","), expires_in: options.expiresIn ?? 3600, refresh_token: `refresh-${issued}`, refresh_token_expires_in: 7_776_000 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function setup(fetchOptions: { scope?: string; expiresIn?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "setareh-oauth-"));
  const dbPath = join(directory, "setareh.db");
  const db = new SetarehDatabase(dbPath);
  const shopify = fakeShopify(fetchOptions);
  const oauth = new ShopifyOAuth({ db, cipher: new TokenCipher(randomBytes(32).toString("base64")), clientId, clientSecret, redirectUri: "https://api.setareh.example/shopify/oauth/callback", fetch: shopify.fetchImpl });
  const cleanup = () => { db.close(); rmSync(directory, { recursive: true, force: true }); };
  return { db, dbPath, oauth, shopify, cleanup };
}

function callbackFor(authorizeUrl: string, overrides: Record<string, string> = {}) {
  const state = new URL(authorizeUrl).searchParams.get("state")!;
  return sign(new URLSearchParams({ code: "auth-code", shop, state, timestamp: String(Math.floor(Date.now() / 1000)), ...overrides }));
}

test("accepts only anchored *.myshopify.com shop domains", () => {
  assert.ok(isValidShopDomain(shop));
  for (const bad of ["artesano.myshopify.com.attacker.example", "https://artesano.myshopify.com", "-bad.myshopify.com", "artesano.example.com", "", undefined, null]) {
    assert.equal(isValidShopDomain(bad), false, String(bad));
  }
});

test("verifies Shopify query signatures and rejects tampering", () => {
  const params = sign(new URLSearchParams({ shop, timestamp: "1700000000", code: "abc", state: "xyz" }));
  assert.ok(verifyQueryHmac(params, clientSecret));
  assert.equal(verifyQueryHmac(params, "other-secret"), false);
  const tampered = new URLSearchParams(params);
  tampered.set("shop", "otra.myshopify.com");
  assert.equal(verifyQueryHmac(tampered, clientSecret), false);
  const duplicated = new URLSearchParams(params);
  duplicated.append("code", "abc");
  assert.equal(verifyQueryHmac(duplicated, clientSecret), false);
  const unsigned = new URLSearchParams(params);
  unsigned.delete("hmac");
  assert.equal(verifyQueryHmac(unsigned, clientSecret), false);
});

test("verifies webhook signatures over the raw body", () => {
  const body = Buffer.from(JSON.stringify({ domain: shop }));
  const header = createHmac("sha256", clientSecret).update(body).digest("base64");
  assert.ok(verifyWebhookHmac(body, header, clientSecret));
  assert.equal(verifyWebhookHmac(Buffer.from("{}"), header, clientSecret), false);
  assert.equal(verifyWebhookHmac(body, undefined, clientSecret), false);
});

test("token cipher round-trips and binds ciphertext to its shop", () => {
  const cipher = new TokenCipher(randomBytes(32).toString("base64"));
  const sealed = cipher.encrypt("shpat_secret", shop);
  assert.ok(!sealed.includes("shpat_secret"));
  assert.equal(cipher.decrypt(sealed, shop), "shpat_secret");
  assert.throws(() => cipher.decrypt(sealed, "otra.myshopify.com"));
  const raw = Buffer.from(sealed.slice(3), "base64url");
  raw[raw.length - 1] ^= 1;
  assert.throws(() => cipher.decrypt(`v1:${raw.toString("base64url")}`, shop));
  assert.throws(() => new TokenCipher(randomBytes(16).toString("base64")));
});

test("completes an install once and stores only encrypted tokens", async () => {
  const { dbPath, oauth, shopify, cleanup } = setup();
  try {
    const authorizeUrl = oauth.beginInstall(shop);
    const authorize = new URL(authorizeUrl);
    assert.equal(authorize.origin, `https://${shop}`);
    assert.equal(authorize.pathname, "/admin/oauth/authorize");
    assert.equal(authorize.searchParams.get("client_id"), clientId);
    assert.equal(authorize.searchParams.get("scope"), SHOPIFY_REQUIRED_SCOPES.join(","));
    assert.equal(authorize.searchParams.get("redirect_uri"), "https://api.setareh.example/shopify/oauth/callback");

    const callback = callbackFor(authorizeUrl);
    const result = await oauth.completeInstall(callback);
    assert.equal(result.shop, shop);
    assert.equal(shopify.calls[0].code, "auth-code");
    assert.equal(shopify.calls[0].expiring, "1", "Shopify requires expiring offline tokens");
    assert.equal(await oauth.getAccessToken(shop), "access-1");

    const raw = new DatabaseSync(dbPath);
    const stored = JSON.stringify(raw.prepare("SELECT * FROM shopify_installation").all());
    raw.close();
    assert.ok(!stored.includes("access-1") && !stored.includes("refresh-1"), "tokens must be encrypted at rest");

    await assert.rejects(oauth.completeInstall(callback), /state/i, "a callback cannot be replayed");
    assert.equal(shopify.calls.length, 1);
  } finally { cleanup(); }
});

test("rejects callbacks with a forged signature, unknown state or another shop", async () => {
  const { oauth, shopify, cleanup } = setup();
  try {
    const forged = callbackFor(oauth.beginInstall(shop));
    forged.set("code", "attacker-code");
    await assert.rejects(oauth.completeInstall(forged), /signature/i);

    await assert.rejects(oauth.completeInstall(sign(new URLSearchParams({ code: "c", shop, state: "never-issued", timestamp: "1" }))), /state/i);

    const otherShopState = new URL(oauth.beginInstall("otra.myshopify.com")).searchParams.get("state")!;
    await assert.rejects(oauth.completeInstall(sign(new URLSearchParams({ code: "c", shop, state: otherShopState, timestamp: "1" }))), /state/i);
    assert.equal(shopify.calls.length, 0, "no code exchange happens for rejected callbacks");
  } finally { cleanup(); }
});

test("refuses an install that lacks required scopes", async () => {
  const { oauth, cleanup } = setup({ scope: "read_products,read_inventory" });
  try {
    await assert.rejects(oauth.completeInstall(callbackFor(oauth.beginInstall(shop))), /write_draft_orders/);
    assert.equal(oauth.installationStatus(shop).installed, false);
  } finally { cleanup(); }
});

test("refreshes an expiring token once for concurrent callers and stores the rotated pair", async () => {
  const { oauth, shopify, cleanup } = setup({ expiresIn: 60 });
  try {
    await oauth.completeInstall(callbackFor(oauth.beginInstall(shop)));
    const tokens = await Promise.all([oauth.getAccessToken(shop), oauth.getAccessToken(shop), oauth.getAccessToken(shop)]);
    assert.deepEqual(tokens, ["access-2", "access-2", "access-2"]);
    const refreshCalls = shopify.calls.filter((call) => call.grant_type === "refresh_token");
    assert.equal(refreshCalls.length, 1);
    assert.equal(refreshCalls[0].refresh_token, "refresh-1");
    await oauth.getAccessToken(shop);
    assert.equal(shopify.calls.filter((call) => call.grant_type === "refresh_token").at(-1)?.refresh_token, "refresh-2", "the rotated refresh token is persisted");
  } finally { cleanup(); }
});

test("an uninstalled shop has no usable tokens", async () => {
  const { oauth, cleanup } = setup();
  try {
    await oauth.completeInstall(callbackFor(oauth.beginInstall(shop)));
    assert.ok(oauth.revoke(shop));
    assert.equal(oauth.installationStatus(shop).installed, false);
    await assert.rejects(oauth.getAccessToken(shop), /not installed/);
  } finally { cleanup(); }
});

test("HTTP install, callback and uninstall webhook routes", async () => {
  const { db, oauth, cleanup } = setup();
  const config: SetarehConfig = { databasePath: ":memory:", merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: merchantAddress, facilitatorUrl: "http://127.0.0.1:9", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  const service = new CommerceService(config, db, { domain: shop } as any);
  const server = createHttpApp(service, { shopifyOAuth: oauth }).listen(0, "127.0.0.1");
  const base = await new Promise<string>((resolve) => server.on("listening", () => { const address = server.address(); assert.ok(address && typeof address !== "string"); resolve(`http://127.0.0.1:${address.port}`); }));
  try {
    assert.equal((await fetch(`${base}/shopify/install?shop=evil.example.com`, { redirect: "manual" })).status, 400);
    const forgedLaunch = await fetch(`${base}/shopify/install?shop=${shop}&timestamp=1&hmac=${"0".repeat(64)}`, { redirect: "manual" });
    assert.equal(forgedLaunch.status, 401);

    const install = await fetch(`${base}/shopify/install?${sign(new URLSearchParams({ shop, timestamp: "1" }))}`, { redirect: "manual" });
    assert.equal(install.status, 302);
    const location = install.headers.get("location")!;
    assert.ok(location.startsWith(`https://${shop}/admin/oauth/authorize?`));

    const callback = await fetch(`${base}/shopify/oauth/callback?${callbackFor(location)}`);
    assert.equal(callback.status, 200);
    assert.match(await callback.text(), /quedó conectado/);
    assert.equal(oauth.installationStatus(shop).installed, true);

    const replay = await fetch(`${base}/shopify/oauth/callback?${callbackFor(location)}`);
    assert.equal(replay.status, 401);

    const body = JSON.stringify({ domain: shop });
    const unsigned = await fetch(`${base}/shopify/webhooks/app-uninstalled`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Shop-Domain": shop, "X-Shopify-Hmac-Sha256": "invalid" }, body });
    assert.equal(unsigned.status, 401);
    assert.equal(oauth.installationStatus(shop).installed, true);

    const webhook = await fetch(`${base}/shopify/webhooks/app-uninstalled`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Shop-Domain": shop, "X-Shopify-Hmac-Sha256": createHmac("sha256", clientSecret).update(body).digest("base64") }, body });
    assert.equal(webhook.status, 200);
    assert.equal(oauth.installationStatus(shop).installed, false);

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200, "JSON routes keep working after the raw webhook route");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanup();
  }
});
