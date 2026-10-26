import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
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
