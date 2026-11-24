import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { issueAgentKey } from "./agent-keys.js";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createHttpApp } from "./http.js";
import { createRecipientChecker, type RecipientChecker } from "./merchant-setup.js";
import { SHOPIFY_REQUIRED_SCOPES, ShopifyOAuth, TokenCipher, queryHmacMessage, shopifyAppsFromEnvironment } from "./shopify-oauth.js";

/** A second store installs with its own Shopify app and configures its own payout address and caps. */

const PILOT_SHOP = "tienda-piloto.myshopify.com";
const NEW_SHOP = "segunda-tienda.myshopify.com";
const defaultApp = { clientId: "default-client-id", clientSecret: "default-client-secret" };
const newShopApp = { clientId: "second-client-id", clientSecret: "second-client-secret" };

function sign(params: URLSearchParams, secret: string) {
  params.set("hmac", createHmac("sha256", secret).update(queryHmacMessage(params)).digest("hex"));
  return params;
}

async function harness(checkRecipient: RecipientChecker) {
  const directory = mkdtempSync(join(tmpdir(), "setareh-setup-"));
  const db = new SetarehDatabase(join(directory, "setareh.db"));
  const tokenCalls: Array<Record<string, string>> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
    tokenCalls.push({ url: String(url), ...body });
    const expected = String(url).includes(NEW_SHOP) ? newShopApp : defaultApp;
    if (body.client_id !== expected.clientId || body.client_secret !== expected.clientSecret) return new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
    return new Response(JSON.stringify({ access_token: "access-1", scope: SHOPIFY_REQUIRED_SCOPES.join(","), expires_in: 3600, refresh_token: "refresh-1", refresh_token_expires_in: 7_776_000 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const oauth = new ShopifyOAuth({ db, cipher: new TokenCipher(randomBytes(32).toString("base64")), ...defaultApp, apps: { [NEW_SHOP]: newShopApp }, redirectUri: "https://api.setareh.example/shopify/oauth/callback", fetch: fetchImpl });
  const pilotAddress = Keypair.random().publicKey();
  const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantName: "Tienda piloto", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: pilotAddress, facilitatorUrl: "http://127.0.0.1:9", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  const variant = { id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: null, price: "5000", inventoryQuantity: 5, inventoryPolicy: "DENY", availableForSale: true, product: { id: "gid://shopify/Product/1", title: "Producto", handle: "producto", status: "ACTIVE" } };
  const client = (domain: string) => ({ domain, searchVariants: async () => [variant], getVariant: async () => variant });
  const service = new CommerceService(config, db, { environmentStore: client(PILOT_SHOP) as any, clientFor: (merchant) => client(merchant.shopDomain) as any });
  const server = createHttpApp(service, { shopifyOAuth: oauth, checkRecipient }).listen(0, "127.0.0.1");
  const base = await new Promise<string>((resolve) => server.on("listening", () => { const address = server.address(); assert.ok(address && typeof address !== "string"); resolve(`http://127.0.0.1:${address.port}`); }));

  /** Walks the install up to the redirect that carries the setup link. */
  async function install(shop: string, secret: string) {
    const begin = await fetch(`${base}/shopify/install?${sign(new URLSearchParams({ shop, timestamp: "1" }), secret)}`, { redirect: "manual" });
    assert.equal(begin.status, 302);
    const authorize = new URL(begin.headers.get("location")!);
    const callback = await fetch(`${base}/shopify/oauth/callback?${sign(new URLSearchParams({ code: "auth-code", shop, state: authorize.searchParams.get("state")!, timestamp: "2" }), secret)}`, { redirect: "manual" });
    return { authorize, callback };
  }
  const submit = (token: string, fields: Record<string, string>) => fetch(`${base}/shopify/setup`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token, ...fields }) });
  const close = async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); rmSync(directory, { recursive: true, force: true }); };
  return { base, db, service, tokenCalls, pilotAddress, install, submit, close };
}

test("a second store installs with its own app, sets its payout address and caps, and only then sells", async () => {
  const goodAddress = Keypair.random().publicKey();
  const untrusted = Keypair.random().publicKey();
  const run = await harness(async (address) => (address === goodAddress ? { ok: true } : address === untrusted ? { ok: false, reason: "no_usdc_trustline" } : { ok: false, reason: "invalid_address" }));
  try {
    const { authorize, callback } = await run.install(NEW_SHOP, newShopApp.clientSecret);
    assert.equal(authorize.searchParams.get("client_id"), newShopApp.clientId, "the store is sent to its own app");
    assert.equal(callback.status, 303);
    assert.equal(run.tokenCalls.at(-1)?.client_secret, newShopApp.clientSecret);
    const location = callback.headers.get("location")!;
    const token = new URL(location, run.base).searchParams.get("token")!;

    const registered = run.db.getMerchant("segunda-tienda");
    assert.equal(registered?.status, "pending_setup");
    assert.equal(registered?.stellarRecipient, "", "nobody typed a payout address for the store");

    // Until the store finishes its setup an agent key exists but buys nothing.
    const { key } = issueAgentKey(run.db, { merchantId: "segunda-tienda", label: "evaluadora" });
    const early = await fetch(`${run.base}/v1/catalog`, { headers: { Authorization: `Bearer ${key}` } });
    assert.equal(early.status, 409);
    assert.equal(((await early.json()) as { error: { code: string } }).error.code, "merchant_not_enabled");

    const form = await fetch(new URL(location, run.base));
    assert.equal(form.status, 200);
    assert.equal(form.headers.get("cache-control"), "no-store");
    assert.equal(form.headers.get("referrer-policy"), "no-referrer");
    const html = await form.text();
    assert.match(html, /segunda-tienda\.myshopify\.com/);
    assert.match(html, /name="stellarRecipient"/);

    const secretKey = Keypair.random().secret();
    const pastedSecret = await run.submit(token, { name: "Segunda Tienda", stellarRecipient: secretKey, maxOrderUsdc: "40", maxDayUsdc: "120" });
    assert.equal(pastedSecret.status, 422);
    assert.ok(!(await pastedSecret.text()).includes(secretKey.slice(8)), "a secret key pasted by mistake is rejected");
    assert.equal(run.db.getMerchant("segunda-tienda")?.status, "pending_setup");

    const noTrustline = await run.submit(token, { name: "Segunda Tienda", stellarRecipient: untrusted, maxOrderUsdc: "40", maxDayUsdc: "120" });
    assert.equal(noTrustline.status, 422);
    assert.match(await noTrustline.text(), /trustline/);

    const inverted = await run.submit(token, { name: "Segunda Tienda", stellarRecipient: goodAddress, maxOrderUsdc: "200", maxDayUsdc: "120" });
    assert.equal(inverted.status, 422, "the daily cap cannot be below the per-order cap");

    const saved = await run.submit(token, { name: "Segunda Tienda", stellarRecipient: goodAddress, maxOrderUsdc: "40", maxDayUsdc: "120" });
    assert.equal(saved.status, 200);
    assert.match(await saved.text(), /quedó activa/);
    const active = run.db.getMerchant("segunda-tienda")!;
    assert.deepEqual({ status: active.status, name: active.name, recipient: active.stellarRecipient, order: active.maxOrderUsdc, day: active.maxDayUsdc, by: active.configuredBy, network: active.network },
      { status: "active", name: "Segunda Tienda", recipient: goodAddress, order: 40, day: 120, by: "owner", network: "stellar:testnet" });

    assert.equal((await run.submit(token, { name: "Otra", stellarRecipient: untrusted, maxOrderUsdc: "1", maxDayUsdc: "1" })).status, 410, "the link works once");
    assert.equal((await fetch(new URL(location, run.base))).status, 410);
    assert.equal(run.db.getMerchant("segunda-tienda")?.stellarRecipient, goodAddress);

    const catalog = await fetch(`${run.base}/v1/catalog`, { headers: { Authorization: `Bearer ${key}` } });
    assert.equal(catalog.status, 200);
    assert.equal(((await catalog.json()) as { merchantId: string; store: string }).store, NEW_SHOP);

    assert.equal(run.db.getMerchant("tienda-piloto")?.stellarRecipient, run.pilotAddress, "the pilot store is untouched");
    assert.equal(run.db.listMerchants().filter((merchant) => merchant.status === "active").length, 2);
  } finally { await run.close(); }
});

test("a store's install is only accepted when signed by that store's own app", async () => {
  const run = await harness(async () => ({ ok: true }));
  try {
    const begin = await fetch(`${run.base}/shopify/install?shop=${NEW_SHOP}`, { redirect: "manual" });
    const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
    const forged = await fetch(`${run.base}/shopify/oauth/callback?${sign(new URLSearchParams({ code: "auth-code", shop: NEW_SHOP, state, timestamp: "2" }), defaultApp.clientSecret)}`, { redirect: "manual" });
    assert.equal(forged.status, 401, "the default app's secret does not vouch for another app's store");
    assert.equal(run.db.getMerchant("segunda-tienda"), undefined);
    assert.equal(run.tokenCalls.length, 0);

    const pilot = await run.install(PILOT_SHOP, defaultApp.clientSecret);
    assert.equal(pilot.authorize.searchParams.get("client_id"), defaultApp.clientId);
    assert.equal(pilot.callback.status, 303);
    assert.equal(run.db.getMerchant("tienda-piloto")?.status, "active", "re-authorizing an active store keeps it selling");
  } finally { await run.close(); }
});

test("an unknown, malformed or expired setup link shows nothing", async () => {
  const run = await harness(async () => ({ ok: true }));
  try {
    for (const token of ["", "short", "A".repeat(43), "../../etc"]) assert.equal((await fetch(`${run.base}/shopify/setup?token=${encodeURIComponent(token)}`)).status, 410);
    assert.equal((await run.submit("A".repeat(43), { name: "x", stellarRecipient: "y", maxOrderUsdc: "1", maxDayUsdc: "1" })).status, 410);
  } finally { await run.close(); }
});

test("the payout account check asks Horizon whether the account exists and trusts USDC", async () => {
  const address = Keypair.random().publicKey();
  const answer = (status: number, balances?: unknown[]) => createRecipientChecker("https://horizon.example/", (async (url: string | URL) => {
    assert.equal(String(url), `https://horizon.example/accounts/${address}`);
    return new Response(JSON.stringify({ balances }), { status });
  }) as typeof fetch);
  const usdc = { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", balance: "0.0000000" };
  assert.deepEqual(await answer(200, [{ asset_type: "native", balance: "10" }, usdc])(address), { ok: true });
  assert.deepEqual(await answer(200, [{ asset_type: "native", balance: "10" }])(address), { ok: false, reason: "no_usdc_trustline" });
  assert.deepEqual(await answer(200, [{ ...usdc, asset_issuer: Keypair.random().publicKey() }])(address), { ok: false, reason: "no_usdc_trustline" }, "a look-alike asset from another issuer does not count");
  assert.deepEqual(await answer(404)(address), { ok: false, reason: "account_not_found" });
  assert.deepEqual(await answer(503)(address), { ok: false, reason: "horizon_unavailable" });
  assert.deepEqual(await createRecipientChecker("https://horizon.example", (async () => { throw new Error("should not be called"); }) as typeof fetch)("not-an-address"), { ok: false, reason: "invalid_address" });
});

test("SHOPIFY_APPS accepts per-store apps and rejects anything malformed", () => {
  assert.equal(shopifyAppsFromEnvironment(""), undefined);
  assert.deepEqual(shopifyAppsFromEnvironment(JSON.stringify({ "Otra-Tienda.myshopify.com": { clientId: "id", clientSecret: "secret" } })), { "otra-tienda.myshopify.com": { clientId: "id", clientSecret: "secret" } });
  for (const bad of ["not json", "[]", JSON.stringify({ "evil.example.com": { clientId: "id", clientSecret: "secret" } }), JSON.stringify({ "tienda.myshopify.com": { clientId: "id" } })]) {
    assert.throws(() => shopifyAppsFromEnvironment(bad), /SHOPIFY_APPS/);
  }
});
