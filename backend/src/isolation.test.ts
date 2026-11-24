import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { issueAgentKey } from "./agent-keys.js";
import { confirmingChain } from "./chain-double.test-support.js";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createHttpApp } from "./http.js";
import { captureLogs } from "./log.js";

/**
 * D2 acceptance: two stores in one deployment, each with its own payout address, caps and agent keys.
 * The six isolation tests the addendum commits to are named I1 to I6; the rest cover what they rest on
 * (keys stored as hashes, limits that survive a restart, the migration of the pilot store).
 */

const SHOP_A = "tienda-a.myshopify.com";
const SHOP_B = "tienda-b.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/1";
const PRICE_CLP = 12_000; // 12 USDC at the configured rate
const supported = { kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: {} };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function storeDouble(domain: string) {
  const calls = { createDraftOrder: 0, completeDraftOrder: 0 };
  const variant = { id: VARIANT, title: "Default Title", sku: null, price: String(PRICE_CLP), inventoryQuantity: 50, inventoryPolicy: "DENY", availableForSale: true, product: { id: "gid://shopify/Product/1", title: `Producto de ${domain}`, handle: "producto", status: "ACTIVE" } };
  const client = {
    domain,
    searchVariants: async () => [variant],
    getVariant: async () => variant,
    createDraftOrder: async (input: { items: Array<{ quantity: number }> }) => {
      calls.createDraftOrder += 1;
      const total = input.items.reduce((sum, item) => sum + item.quantity * PRICE_CLP, 0);
      return { id: `gid://shopify/DraftOrder/${domain}-${calls.createDraftOrder}`, name: `#D${calls.createDraftOrder}`, invoiceUrl: null, status: "OPEN", totalPrice: total.toFixed(2), currencyCode: "CLP" };
    },
    completeDraftOrder: async () => { calls.completeDraftOrder += 1; return { id: `gid://shopify/Order/${domain}-${calls.completeDraftOrder}`, name: `#10${calls.completeDraftOrder}` }; },
    attachPaymentEvidence: async () => undefined,
  };
  return { calls, client };
}

async function harness(options: { settleDelayMs?: number; limitsA?: { maxOrderUsdc: number; maxDayUsdc: number } } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "setareh-isolation-"));
  const settle = { calls: 0 };
  const facilitator = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/supported") return response.end(JSON.stringify(supported));
    if (request.url === "/settle") { settle.calls += 1; if (options.settleDelayMs) await sleep(options.settleDelayMs); }
    response.end(JSON.stringify({ success: true, payer: "GBUYER", transaction: "a1".repeat(32), network: "stellar:testnet", amount: "120000000" }));
  });
  await new Promise<void>((resolve) => facilitator.listen(0, "127.0.0.1", resolve));
  const facilitatorAddress = facilitator.address();
  assert.ok(facilitatorAddress && typeof facilitatorAddress !== "string");

  const addressA = Keypair.random().publicKey();
  const addressB = Keypair.random().publicKey();
  const dbPath = join(directory, "setareh.db");
  const database = new SetarehDatabase(dbPath);
  // Both stores arrive the way real ones do: OAuth registers them, their own setup gives address and caps.
  database.registerInstalledMerchant(SHOP_A);
  database.registerInstalledMerchant(SHOP_B);
  database.completeMerchantSetup({ shopDomain: SHOP_A, name: "Tienda A", stellarRecipient: addressA, ...(options.limitsA ?? { maxOrderUsdc: 20, maxDayUsdc: 30 }) });
  database.completeMerchantSetup({ shopDomain: SHOP_B, name: "Tienda B", stellarRecipient: addressB, maxOrderUsdc: 20, maxDayUsdc: 100 });
  const stores = { "tienda-a": storeDouble(SHOP_A), "tienda-b": storeDouble(SHOP_B) };
  const config: SetarehConfig = { databasePath: dbPath, merchantName: "unused", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: addressA, facilitatorUrl: `http://127.0.0.1:${facilitatorAddress.port}`, maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001, verification: { attempts: 2, delayMs: 10 } };
  const directoryOfStores = { clientFor: (merchant: { id: string }) => stores[merchant.id as keyof typeof stores].client as any };
  const service = new CommerceService(config, database, directoryOfStores, confirmingChain(addressA, 120_000_000n));
  const keyA = issueAgentKey(database, { merchantId: "tienda-a", label: "agente de prueba A" });
  const keyB = issueAgentKey(database, { merchantId: "tienda-b", label: "agente de prueba B" });

  const appServer = createHttpApp(service).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.on("listening", resolve));
  const appAddress = appServer.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  const base = `http://127.0.0.1:${appAddress.port}`;

  const auth = (key?: string): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {});
  const quoteBody = (quantity = 1, merchantId?: string) => JSON.stringify({ ...(merchantId ? { merchantId } : {}), items: [{ variantId: VARIANT, quantity }], email: "buyer@example.com", shippingAddress: { address1: "Calle 1", city: "Temuco", country: "CL", zip: "4780000", firstName: "Ana", lastName: "Díaz" }, userConfirmed: true });
  const quote = (key: string | undefined, quantity = 1, merchantId?: string) => fetch(`${base}/v1/quotes`, { method: "POST", headers: { "Content-Type": "application/json", ...auth(key) }, body: quoteBody(quantity, merchantId) });
  const payEndpoint = (quoteId: string) => `${base}/v1/quotes/${quoteId}/pay-and-place`;
  const unpaid = (key: string | undefined, quoteId: string) => fetch(payEndpoint(quoteId), { method: "POST", headers: { "Content-Type": "application/json", ...auth(key) }, body: JSON.stringify({ userConfirmed: true }) });
  const challengeOf = (response: Response) => JSON.parse(Buffer.from(String(response.headers.get("payment-required")), "base64url").toString("utf8")) as { resource: unknown; accepts: Array<{ payTo: string; amount: string }> };
  const pay = (key: string, quoteId: string, challenge: { resource: unknown; accepts: unknown[] }, signature: string) => {
    const payload = { x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: { signedAuthorization: signature } };
    return fetch(payEndpoint(quoteId), { method: "POST", headers: { "Content-Type": "application/json", ...auth(key), "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64url") }, body: JSON.stringify({ userConfirmed: true }) });
  };
  const close = async () => {
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => facilitator.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return { base, dbPath, database, service, stores, settle, addressA, addressB, keyA: keyA.key, keyB: keyB.key, keyRecordA: keyA.record, auth, quote, unpaid, challengeOf, pay, close };
}

const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

test("I1: a key of one store cannot quote in another (401)", async () => {
  const run = await harness();
  try {
    const crossed = await run.quote(run.keyA, 1, "tienda-b");
    assert.equal(crossed.status, 401);
    assert.equal(await errorCode(crossed), "agent_key_wrong_merchant");
    assert.equal(run.stores["tienda-b"].calls.createDraftOrder, 0, "nothing was created in the other store");

    const catalog = await fetch(`${run.base}/v1/catalog?merchantId=tienda-b`, { headers: run.auth(run.keyA) });
    assert.equal(catalog.status, 401, "nor read its catalog");

    const own = await run.quote(run.keyA);
    assert.equal(own.status, 201);
    assert.equal(((await own.json()) as { merchantId: string }).merchantId, "tienda-a", "without naming a store, the key's store is used");

    const anonymous = await run.quote(undefined);
    assert.equal(anonymous.status, 401);
    assert.equal(await errorCode(anonymous), "invalid_agent_key");
    assert.equal((await run.quote("sak_00000000_" + "A".repeat(43))).status, 401, "a well-formed key nobody issued");

    run.database.revokeAgentKey(run.keyRecordA.prefix);
    assert.equal((await run.quote(run.keyA)).status, 401, "a revoked key stops working at once");
    assert.equal((await run.quote(run.keyB)).status, 201, "the other store's key is unaffected");
  } finally { await run.close(); }
});

test("I2: a key of one store cannot pay another store's quote (401), and each quote pays its own store", async () => {
  const run = await harness();
  try {
    const quoteA = (await (await run.quote(run.keyA)).json()) as { quoteId: string; payment: { payTo: string } };
    const quoteB = (await (await run.quote(run.keyB)).json()) as { quoteId: string; payment: { payTo: string } };
    assert.equal(quoteA.payment.payTo, run.addressA);
    assert.equal(quoteB.payment.payTo, run.addressB);

    const crossed = await run.unpaid(run.keyA, quoteB.quoteId);
    assert.equal(crossed.status, 401);
    assert.equal(crossed.headers.get("payment-required"), null, "no payment challenge is handed to the wrong agent");
    assert.equal(await errorCode(crossed), "agent_key_wrong_merchant");
    assert.equal((await fetch(`${run.base}/v1/orders/${quoteB.quoteId}`, { headers: run.auth(run.keyA) })).status, 401, "nor read its status");
    assert.equal((await run.unpaid(undefined, quoteB.quoteId)).status, 401);

    const challengeA = await run.unpaid(run.keyA, quoteA.quoteId);
    const challengeB = await run.unpaid(run.keyB, quoteB.quoteId);
    assert.equal(challengeA.status, 402);
    assert.equal(challengeB.status, 402);
    assert.equal(run.challengeOf(challengeA).accepts[0].payTo, run.addressA);
    assert.equal(run.challengeOf(challengeB).accepts[0].payTo, run.addressB, "the 402 names the quote's own store as recipient");

    // A signed payment for store B's quote presented with store A's key never reaches the facilitator.
    const stolen = await run.pay(run.keyA, quoteB.quoteId, run.challengeOf(challengeB), "signature");
    assert.equal(stolen.status, 401);
    assert.equal(run.settle.calls, 0);
    assert.equal(run.database.getQuote(quoteB.quoteId)?.status, "payment_required");
  } finally { await run.close(); }
});

test("I3: an order above the store's per-order cap is refused before quoting (402)", async () => {
  const run = await harness();
  try {
    const over = await run.quote(run.keyA, 2); // 24 USDC against a 20 USDC cap
    assert.equal(over.status, 402);
    assert.equal(over.headers.get("payment-required"), null, "a limit is not an x402 challenge");
    const body = (await over.json()) as { error: { code: string; limitUsdc: number; requestedUsdc: number } };
    assert.equal(body.error.code, "order_limit_exceeded");
    assert.equal(body.error.limitUsdc, 20);
    assert.equal(body.error.requestedUsdc, 24);
    assert.equal(run.stores["tienda-a"].calls.createDraftOrder, 0, "refused before anything exists in Shopify");
    assert.equal((await run.quote(run.keyA, 1)).status, 201, "an order under the cap still goes through");
  } finally { await run.close(); }
});

test("I4: orders beyond the store's per-day cap are refused (402), per store and per UTC day", async () => {
  const run = await harness();
  try {
    assert.equal((await run.quote(run.keyA)).status, 201); // 12
    assert.equal((await run.quote(run.keyA)).status, 201); // 24 of 30
    const over = await run.quote(run.keyA);
    assert.equal(over.status, 402);
    assert.equal(over.headers.get("payment-required"), null);
    const body = (await over.json()) as { error: { code: string; limitUsdc: number; committedUsdc: number; resetsAt: string } };
    assert.equal(body.error.code, "daily_limit_exceeded");
    assert.equal(body.error.limitUsdc, 30);
    assert.equal(body.error.committedUsdc, 24);
    assert.match(body.error.resetsAt, /T00:00:00\.000Z$/);
    assert.equal(run.stores["tienda-a"].calls.createDraftOrder, 2, "the refused quote created no draft");
    assert.equal((await run.quote(run.keyB)).status, 201, "the other store has its own daily amount");

    const storeA = run.database.getMerchant("tienda-a")!;
    assert.throws(() => run.service.assertWithinLimits(storeA, 12), /per day/);
    assert.doesNotThrow(() => run.service.assertWithinLimits(storeA, 12, new Date(Date.now() + 24 * 60 * 60_000)), "the count starts again on the next UTC day");
  } finally { await run.close(); }
});

test("I5: retrying a paid quote is refused (409) with one settlement and one order", async () => {
  const run = await harness();
  try {
    const { quoteId } = (await (await run.quote(run.keyA)).json()) as { quoteId: string };
    const challenge = run.challengeOf(await run.unpaid(run.keyA, quoteId));
    const paid = await run.pay(run.keyA, quoteId, challenge, "first-signature");
    assert.equal(paid.status, 200);
    const order = (await paid.json()) as { status: string; payment: { transactionHash: string } };
    assert.equal(order.status, "created");

    assert.equal((await run.pay(run.keyA, quoteId, challenge, "second-signature")).status, 409, "a second signed payment");
    assert.equal((await run.unpaid(run.keyA, quoteId)).status, 409, "and a plain retry");
    assert.equal(run.settle.calls, 1);
    assert.equal(run.stores["tienda-a"].calls.completeDraftOrder, 1);
    assert.equal(run.stores["tienda-b"].calls.completeDraftOrder, 0);
    const status = (await (await fetch(`${run.base}/v1/orders/${quoteId}`, { headers: run.auth(run.keyA) })).json()) as { status: string; merchantId: string; payment: { transactionHash: string } };
    assert.equal(status.status, "created");
    assert.equal(status.merchantId, "tienda-a");
    assert.equal(status.payment.transactionHash, order.payment.transactionHash);
  } finally { await run.close(); }
});

test("I6: two simultaneous payments of the same quote settle once; the other gets 409", async () => {
  const run = await harness({ settleDelayMs: 150 });
  try {
    const { quoteId } = (await (await run.quote(run.keyA)).json()) as { quoteId: string };
    const challenge = run.challengeOf(await run.unpaid(run.keyA, quoteId));
    const responses = await Promise.all([run.pay(run.keyA, quoteId, challenge, "signature-one"), run.pay(run.keyA, quoteId, challenge, "signature-two")]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(run.settle.calls, 1, "the facilitator was asked to settle once");
    assert.equal(run.stores["tienda-a"].calls.completeDraftOrder, 1, "and one order exists");
    assert.equal(run.database.getQuote(quoteId)?.status, "created");
  } finally { await run.close(); }
});

test("agent keys are stored as hashes and never written to the log", async () => {
  const lines: string[] = [];
  const restore = captureLogs((line) => lines.push(line));
  const run = await harness();
  try {
    assert.equal((await run.quote(run.keyA)).status, 201);
    assert.equal((await run.quote(run.keyA, 1, "tienda-b")).status, 401);
    const raw = new DatabaseSync(run.dbPath);
    const stored = JSON.stringify(raw.prepare("SELECT * FROM agent_key").all());
    raw.close();
    const secret = run.keyA.split("_")[2];
    assert.ok(!stored.includes(secret), "the database holds no usable key");
    assert.ok(!lines.join("\n").includes(secret), "no log line carries the key");
    const request = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.event === "http.request" && line.httpStatus === 201);
    assert.equal(request?.merchantId, "tienda-a");
    assert.equal(request?.agentKey, run.keyRecordA.prefix, "requests are attributed by the key's public prefix");
    assert.equal(run.database.getQuote(((run.database as any).db.prepare("SELECT id FROM quote").get() as { id: string }).id)?.agentKeyId, run.keyRecordA.id, "a quote remembers which agent created it");
  } finally { restore(); await run.close(); }
});

test("the quote rate limit is per agent and survives a restart of the service", async () => {
  const run = await harness({ limitsA: { maxOrderUsdc: 20, maxDayUsdc: 1_000 } });
  const second = { server: undefined as ReturnType<ReturnType<typeof createHttpApp>["listen"]> | undefined, database: undefined as SetarehDatabase | undefined };
  try {
    const app = createHttpApp(run.service, { quoteRateLimits: { perClientPerHour: 2, globalPerHour: 50 } }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => app.on("listening", resolve));
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const post = (port: number, key: string) => fetch(`http://127.0.0.1:${port}/v1/quotes`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: "{}" });
    assert.equal((await post(address.port, run.keyA)).status, 400);
    assert.equal((await post(address.port, run.keyA)).status, 400);
    assert.equal((await post(address.port, run.keyA)).status, 429, "the agent used its quota");
    assert.equal((await post(address.port, run.keyB)).status, 400, "another agent has its own");
    await new Promise<void>((resolve) => app.close(() => resolve()));

    // A new process: a second handle on the same database file and a fresh app.
    second.database = new SetarehDatabase(run.dbPath);
    const restarted = new CommerceService(run.service.config, second.database, { clientFor: (merchant: { id: string }) => run.stores[merchant.id as keyof typeof run.stores].client as any }, confirmingChain(run.addressA, 120_000_000n));
    second.server = createHttpApp(restarted, { quoteRateLimits: { perClientPerHour: 2, globalPerHour: 50 } }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => second.server!.on("listening", resolve));
    const restartedAddress = second.server.address();
    assert.ok(restartedAddress && typeof restartedAddress !== "string");
    assert.equal((await post(restartedAddress.port, run.keyA)).status, 429, "the quota was not reset by the restart");
  } finally {
    if (second.server) await new Promise<void>((resolve) => second.server!.close(() => resolve()));
    second.database?.close();
    await run.close();
  }
});

test("repeated requests without a valid key are throttled per address", async () => {
  const run = await harness();
  try {
    const app = createHttpApp(new CommerceService({ ...run.service.config, authFailuresPerHour: 3 }, run.database, { clientFor: (merchant: { id: string }) => run.stores[merchant.id as keyof typeof run.stores].client as any }), {}).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => app.on("listening", resolve));
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const guess = () => fetch(`http://127.0.0.1:${address.port}/v1/catalog`, { headers: { Authorization: `Bearer sak_00000000_${"B".repeat(43)}`, "Fly-Client-IP": "203.0.113.9" } });
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await guess()).status, 401);
      assert.equal((await guess()).status, 429);
      assert.equal((await fetch(`http://127.0.0.1:${address.port}/v1/catalog`, { headers: { Authorization: `Bearer ${run.keyA}`, "Fly-Client-IP": "203.0.113.9" } })).status, 200, "a valid key from the same address still works");
    } finally { await new Promise<void>((resolve) => app.close(() => resolve())); }
  } finally { await run.close(); }
});

test("migration: the pilot store's legacy id becomes its Shopify handle and no history is lost", () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-migration-"));
  const path = join(directory, "setareh.db");
  try {
    // The schema and data shape of the deployed pilot before D2: one store whose id is the old default.
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE merchant (id TEXT PRIMARY KEY, name TEXT NOT NULL, shop_domain TEXT NOT NULL, shopify_credentials_ref TEXT NOT NULL DEFAULT 'env:SHOPIFY_CLIENT_ID', stellar_recipient TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1) STRICT;
      CREATE TABLE quote (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, status TEXT NOT NULL, currency_shopify TEXT NOT NULL, total_shopify TEXT NOT NULL, currency_payment TEXT NOT NULL, total_usdc TEXT NOT NULL, fx_rate TEXT NOT NULL, fx_source TEXT NOT NULL DEFAULT 'configured_demo_rate', expires_at TEXT NOT NULL, shipping_address_json TEXT NOT NULL, line_items_json TEXT NOT NULL, email TEXT NOT NULL, shopify_draft_order_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, personal_data_purged_at TEXT, FOREIGN KEY (merchant_id) REFERENCES merchant(id)) STRICT;
      CREATE TABLE payment (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL UNIQUE, network TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL, pay_to TEXT NOT NULL, payment_payload_hash TEXT, stellar_transaction_hash TEXT, facilitator_receipt_json TEXT, status TEXT NOT NULL, settled_at TEXT, verified_at TEXT, verification_json TEXT, FOREIGN KEY (quote_id) REFERENCES quote(id)) STRICT;
      CREATE TABLE orders (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL UNIQUE, shopify_order_id TEXT NOT NULL, shopify_order_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (quote_id) REFERENCES quote(id)) STRICT;
      INSERT INTO merchant (id, name, shop_domain, stellar_recipient) VALUES ('micohstore', 'Tienda piloto', 'tienda-piloto-1a.myshopify.com', 'GPILOT');
    `);
    const insertQuote = legacy.prepare("INSERT INTO quote (id, merchant_id, status, currency_shopify, total_shopify, currency_payment, total_usdc, fx_rate, expires_at, shipping_address_json, line_items_json, email, shopify_draft_order_id, idempotency_key, created_at) VALUES (?, 'micohstore', ?, 'CLP', '10000.00', 'USDC', '10.0000000', '0.001', '2026-11-22T19:20:00.000Z', '{}', '[]', '', ?, ?, '2026-11-22T19:08:00.000Z')");
    for (const [id, status] of [["q-1006", "created"], ["q-1009", "created"], ["q-1010", "created"], ["q-expired", "expired"]]) insertQuote.run(id, status, `draft-${id}`, `quote:${id}`);
    legacy.prepare("INSERT INTO payment (id, quote_id, network, asset, amount, pay_to, stellar_transaction_hash, status, settled_at, verified_at) VALUES ('p-1010', 'q-1010', 'stellar:testnet', 'USDC', '10.0000000', 'GPILOT', ?, 'settled', '2026-11-22T19:08:30.000Z', '2026-11-22T19:08:31.000Z')").run("5d".repeat(32));
    legacy.prepare("INSERT INTO orders (id, quote_id, shopify_order_id, shopify_order_name, status, created_at) VALUES ('o-1010', 'q-1010', 'gid://shopify/Order/1010', '#1010', 'created', '2026-11-22T19:08:32.000Z')").run();
    legacy.close();

    const database = new SetarehDatabase(path);
    try {
      assert.equal(database.getMerchant("micohstore"), undefined, "the misleading id is gone");
      const pilot = database.getMerchant("tienda-piloto-1a");
      assert.ok(pilot);
      assert.equal(pilot.status, "active", "a store that was selling keeps selling");
      assert.equal(pilot.stellarRecipient, "GPILOT");
      assert.equal(pilot.network, "stellar:testnet");
      for (const id of ["q-1006", "q-1009", "q-1010", "q-expired"]) assert.equal(database.getQuote(id)?.merchantId, "tienda-piloto-1a");
      assert.equal(database.getQuote("q-1010")?.status, "created");
      assert.equal(database.getPayment("q-1010")?.stellar_transaction_hash, "5d".repeat(32));
      assert.equal(database.getOrderByQuote("q-1010")?.shopifyOrderName, "#1010");

      // The service then gives the environment store its caps, exactly as at start-up.
      const config: SetarehConfig = { databasePath: path, merchantName: "Tienda piloto", agentAuth: "off", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GPILOT", facilitatorUrl: "https://example.test", maxQuoteUsdc: 600, maxDayUsdc: 1_500, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
      const service = new CommerceService(config, database, { domain: "tienda-piloto-1a.myshopify.com" } as any);
      assert.equal(service.environmentMerchantId, "tienda-piloto-1a");
      const configured = service.sellingMerchant("tienda-piloto-1a");
      assert.equal(configured.maxOrderUsdc, 600);
      assert.equal(configured.maxDayUsdc, 1_500);
    } finally { database.close(); }

    const reopened = new SetarehDatabase(path);
    try {
      assert.equal(reopened.listMerchants().length, 1, "running the migration again changes nothing");
      const raw = new DatabaseSync(path);
      assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM quote").get() as { n: number }).n, 4);
      assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM quote WHERE merchant_id = 'tienda-piloto-1a'").get() as { n: number }).n, 4);
      assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
      raw.close();
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a store that set its own payout address is never overwritten by the environment", () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-owner-"));
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  try {
    const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantName: "Desde el entorno", agentAuth: "off", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GENV", facilitatorUrl: "https://example.test", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
    new CommerceService(config, database, { domain: SHOP_A } as any);
    assert.equal(database.getMerchant("tienda-a")?.stellarRecipient, "GENV");
    assert.equal(database.getMerchant("tienda-a")?.maxDayUsdc, 150, "five times the per-order cap when no daily cap is configured");
    database.completeMerchantSetup({ shopDomain: SHOP_A, name: "Desde la dueña", stellarRecipient: "GOWNER", maxOrderUsdc: 80, maxDayUsdc: 200 });
    new CommerceService({ ...config, stellarMerchantAddress: "GOTHER", maxQuoteUsdc: 5 }, database, { domain: SHOP_A } as any);
    const store = database.getMerchant("tienda-a")!;
    assert.equal(store.stellarRecipient, "GOWNER");
    assert.equal(store.maxOrderUsdc, 80);
    assert.equal(store.name, "Desde la dueña");
    assert.equal(store.configuredBy, "owner");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
