import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CommerceService } from "./commerce.js";
import { SetarehDatabase } from "./db.js";
import { ShopifyClient } from "./shopify.js";

const variant = { id: "gid://shopify/ProductVariant/1", title: "Única", sku: null, price: "15000", inventoryQuantity: 1, inventoryPolicy: "DENY", availableForSale: true, product: { id: "gid://shopify/Product/1", title: "Souvenir", handle: "souvenir", status: "ACTIVE" } };
const tokens = { mode: "test", getAccessToken: async () => "test-token" };

/** A scripted Shopify Admin API: each entry answers one call, in order. */
async function shopifyDouble(script: Array<(request: IncomingMessage, response: ServerResponse) => void>) {
  let calls = 0;
  const server = createServer((request, response) => {
    const step = script[Math.min(calls, script.length - 1)];
    calls += 1;
    step(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new ShopifyClient("micohstore.myshopify.com", "2026-10", tokens, { baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 300 });
  return { client, calls: () => calls, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};
const variantOk = (_request: IncomingMessage, response: ServerResponse) => json(response, 200, { data: { productVariant: variant } });

test("F12: throttled reads back off and succeed within the retry budget", async () => {
  const startedAt = Date.now();
  const shopify = await shopifyDouble([
    (_request, response) => json(response, 429, { errors: "Throttled" }, { "Retry-After": "0" }),
    (_request, response) => json(response, 200, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }, { "Retry-After": "0" }),
    variantOk,
  ]);
  try {
    assert.deepEqual(await shopify.client.getVariant(variant.id), variant);
    assert.equal(shopify.calls(), 3);
    assert.ok(Date.now() - startedAt < 2_000, "Retry-After: 0 must not wait for the default backoff");
  } finally { await shopify.close(); }
});

test("a read that keeps failing gives up after its retries with the transient error", async () => {
  const shopify = await shopifyDouble([(_request, response) => json(response, 503, { errors: "Service unavailable" }, { "Retry-After": "0" })]);
  try {
    await assert.rejects(shopify.client.getVariant(variant.id), /Shopify Admin API error \(503\)/);
    assert.equal(shopify.calls(), 3, "one attempt plus two retries");
  } finally { await shopify.close(); }
});

test("a hung Admin API call times out instead of holding the request open", async () => {
  const pending: ServerResponse[] = [];
  const shopify = await shopifyDouble([(_request, response) => { pending.push(response); }]);
  try {
    await assert.rejects(shopify.client.getVariant(variant.id), /timed out after 300 ms/);
    assert.equal(shopify.calls(), 3);
  } finally { for (const response of pending) response.destroy(); await shopify.close(); }
});

test("draft creation and completion are never retried, even on a 5xx", async () => {
  const shopify = await shopifyDouble([(_request, response) => json(response, 502, { errors: "Bad gateway" }, { "Retry-After": "0" })]);
  try {
    await assert.rejects(shopify.client.completeDraftOrder("gid://shopify/DraftOrder/1"), /502/);
    assert.equal(shopify.calls(), 1);
    await assert.rejects(shopify.client.createDraftOrder({ items: [], email: "x@example.com", shippingAddress: { address1: "a", city: "b", country: "CL", zip: "1", firstName: "f", lastName: "l" }, quoteId: "q" }), /502/);
    assert.equal(shopify.calls(), 2);
  } finally { await shopify.close(); }
});

test("attaching payment evidence retries once because the metafield write is idempotent", async () => {
  const shopify = await shopifyDouble([
    (_request, response) => json(response, 500, { errors: "boom" }, { "Retry-After": "0" }),
    (_request, response) => json(response, 200, { data: { orderUpdate: { order: { id: "gid://shopify/Order/1" }, userErrors: [] } } }),
  ]);
  try {
    await shopify.client.attachPaymentEvidence("gid://shopify/Order/1", { quoteId: "q", network: "stellar:testnet", asset: "USDC", transactionHash: "ab".repeat(32) });
    assert.equal(shopify.calls(), 2);
  } finally { await shopify.close(); }
});

test("user errors and auth failures are final: no retry", async () => {
  const shopify = await shopifyDouble([(_request, response) => json(response, 401, { errors: "Unauthorized" })]);
  try {
    await assert.rejects(shopify.client.getVariant(variant.id), /401/);
    assert.equal(shopify.calls(), 1);
  } finally { await shopify.close(); }
});

function paidQuote() {
  const directory = mkdtempSync(join(tmpdir(), "setareh-matrix-"));
  const database = new SetarehDatabase(join(directory, "test.db"));
  database.upsertMerchant({ id: "micohstore", name: "Micohstore", shopDomain: "micohstore.myshopify.com", stellarRecipient: "GTEST" });
  const quote = database.createQuote({ id: "paid", merchantId: "micohstore", status: "quoted", currencyShopify: "CLP", totalShopify: "15000.00", currencyPayment: "USDC", totalUsdc: "15.0000000", fxRate: "0.001", expiresAt: new Date(Date.now() + 60_000).toISOString(), shippingAddressJson: "{}", lineItemsJson: JSON.stringify([{ variantId: variant.id, quantity: 1 }]), email: "buyer@example.com", shopifyDraftOrderId: "gid://shopify/DraftOrder/1", idempotencyKey: "quote:paid" });
  database.recordPaymentSettled({ quoteId: quote.id, network: "stellar:testnet", asset: "USDC", amount: "15.0000000", payTo: "GTEST", paymentPayloadHash: "payload", transactionHash: "cd".repeat(32), receipt: {} });
  const config = { databasePath: join(directory, "test.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet" as const, stellarAsset: "USDC", stellarMerchantAddress: "GTEST", facilitatorUrl: "https://example.test", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  return { database, quote, config, cleanup: () => { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("F7: Shopify failing to complete the draft after payment leaves manual_review with the payment intact and no order row", async () => {
  const run = paidQuote();
  try {
    let completions = 0;
    const service = new CommerceService(run.config, run.database, { domain: "micohstore.myshopify.com", getVariant: async () => variant, completeDraftOrder: async () => { completions += 1; throw new Error("Shopify Admin API error (503): Service Unavailable"); } } as any);
    await assert.rejects(service.placePaidOrder(run.quote.id, true), /503/);
    assert.equal(completions, 1);
    assert.equal(run.database.getQuote(run.quote.id)?.status, "manual_review");
    assert.equal(run.database.getOrderByQuote(run.quote.id), undefined);
    assert.equal(run.database.getPayment(run.quote.id)?.stellar_transaction_hash, "cd".repeat(32));
    // A retry must not try Shopify again until an operator reconciles.
    await assert.rejects(service.placePaidOrder(run.quote.id, true), /not payable in status manual_review/);
    assert.equal(completions, 1);
  } finally { run.cleanup(); }
});

test("F10: stock gone between payment and order ends in out_of_stock without touching Shopify", async () => {
  const run = paidQuote();
  try {
    let completions = 0;
    const service = new CommerceService(run.config, run.database, { domain: "micohstore.myshopify.com", getVariant: async () => ({ ...variant, inventoryQuantity: 0, availableForSale: false }), completeDraftOrder: async () => { completions += 1; return { id: "gid://shopify/Order/1", name: "#1001" }; } } as any);
    await assert.rejects(service.placePaidOrder(run.quote.id, true), /Inventory changed after payment/);
    assert.equal(completions, 0);
    assert.equal(run.database.getQuote(run.quote.id)?.status, "out_of_stock");
    assert.equal(run.database.getPayment(run.quote.id)?.stellar_transaction_hash, "cd".repeat(32));
    assert.deepEqual(run.database.getQuoteEvents(run.quote.id).map((event) => event.to), ["quoted", "payment_settled", "creating_shopify_order", "out_of_stock"]);
  } finally { run.cleanup(); }
});
