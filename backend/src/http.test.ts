import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createHttpApp } from "./http.js";

const merchantAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("a payable quote exposes a Stellar x402 402 challenge", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-http-"));
  const facilitator = createServer((request, response) => {
    if (request.url === "/supported") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: {} }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const facilitatorUrl = await listen(facilitator);
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: merchantAddress, facilitatorUrl, maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  const service = new CommerceService(config, database, { domain: "micohstore.myshopify.com" } as any);
  const quote = database.createQuote({ id: "320e4b70-a3f7-4ecd-bf59-bbc26d9cefe6", merchantId: "micohstore", status: "quoted", currencyShopify: "CLP", totalShopify: "10000.00", currencyPayment: "USDC", totalUsdc: "10.000000", fxRate: "0.001", expiresAt: new Date(Date.now() + 60_000).toISOString(), shippingAddressJson: "{}", lineItemsJson: "[]", email: "buyer@example.com", shopifyDraftOrderId: "gid://shopify/DraftOrder/1", idempotencyKey: "quote:http" });
  const appServer = createHttpApp(service).listen(0, "127.0.0.1");
  const appUrl = await new Promise<string>((resolve) => appServer.on("listening", () => { const address = appServer.address(); assert.ok(address && typeof address !== "string"); resolve(`http://127.0.0.1:${address.port}`); }));
  try {
    const response = await fetch(`${appUrl}/v1/quotes/${quote.id}/pay-and-place`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userConfirmed: true }) });
    assert.equal(response.status, 402);
    const requirement = response.headers.get("payment-required");
    assert.ok(requirement, "x402 must provide machine-readable payment requirements");
    const challenge = Buffer.from(requirement, "base64url").toString("utf8");
    assert.match(challenge, /stellar:testnet/);
    assert.match(challenge, /100000000/);
    assert.equal(database.getQuote(quote.id)?.status, "payment_required");
  } finally {
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => facilitator.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a settled x402 payment creates one Shopify order and records its receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-payment-"));
  let settleCalls = 0;
  const facilitator = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/supported") return response.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: {} }));
    if (request.url === "/verify") return response.end(JSON.stringify({ isValid: true, payer: "GBUYER" }));
    if (request.url === "/settle") { settleCalls += 1; return response.end(JSON.stringify({ success: true, payer: "GBUYER", transaction: "stellar-testnet-hash", network: "stellar:testnet", amount: "100000000" })); }
    response.statusCode = 404;
    response.end();
  });
  const facilitatorUrl = await listen(facilitator);
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: merchantAddress, facilitatorUrl, maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  let paymentEvidence: { quoteId: string; network: string; asset: string; transactionHash?: string } | undefined;
  const shopify = {
    domain: "micohstore.myshopify.com",
    getVariant: async () => ({ id: "gid://shopify/ProductVariant/1", inventoryQuantity: 1, inventoryPolicy: "DENY", availableForSale: true, product: { id: "gid://shopify/Product/1", title: "Gato mago", handle: "gato-mago", status: "ACTIVE" } }),
    completeDraftOrder: async () => ({ id: "gid://shopify/Order/1", name: "#1001" }),
    attachPaymentEvidence: async (_orderId: string, evidence: { quoteId: string; network: string; asset: string; transactionHash?: string }) => { paymentEvidence = evidence; },
  };
  const service = new CommerceService(config, database, shopify as any);
  const quote = database.createQuote({ id: "4a802682-dde8-4a6b-bd23-522403c5b4ec", merchantId: "micohstore", status: "quoted", currencyShopify: "CLP", totalShopify: "10000.00", currencyPayment: "USDC", totalUsdc: "10.000000", fxRate: "0.001", expiresAt: new Date(Date.now() + 60_000).toISOString(), shippingAddressJson: "{}", lineItemsJson: JSON.stringify([{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }]), email: "buyer@example.com", shopifyDraftOrderId: "gid://shopify/DraftOrder/1", idempotencyKey: "quote:payment" });
  const appServer = createHttpApp(service).listen(0, "127.0.0.1");
  const appUrl = await new Promise<string>((resolve) => appServer.on("listening", () => { const address = appServer.address(); assert.ok(address && typeof address !== "string"); resolve(`http://127.0.0.1:${address.port}`); }));
  const endpoint = `${appUrl}/v1/quotes/${quote.id}/pay-and-place`;
  try {
    const unpaid = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userConfirmed: true }) });
    const challenge = JSON.parse(Buffer.from(String(unpaid.headers.get("payment-required")), "base64url").toString("utf8"));
    const signedPayload = { x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: { signedAuthorization: "test-only" } };
    const paid = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(signedPayload)).toString("base64url") }, body: JSON.stringify({ userConfirmed: true }) });
    assert.equal(paid.status, 200);
    const body = await paid.json() as { shopifyOrder: { name: string }; payment: { transactionHash: string } };
    assert.equal(body.shopifyOrder.name, "#1001");
    assert.equal(body.payment.transactionHash, "stellar-testnet-hash");
    assert.deepEqual(paymentEvidence, { quoteId: quote.id, network: "stellar:testnet", asset: "USDC", transactionHash: "stellar-testnet-hash" });
    assert.equal(settleCalls, 1);
    assert.equal(database.getQuote(quote.id)?.status, "created");
    const retry = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(signedPayload)).toString("base64url") }, body: JSON.stringify({ userConfirmed: true }) });
    assert.notEqual(retry.status, 200);
    assert.equal(settleCalls, 1);
  } finally {
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => facilitator.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a facilitator settlement failure marks the submitted quote as payment_failed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-settlement-failure-"));
  const facilitator = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/supported") return response.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: {} }));
    if (request.url === "/verify") return response.end(JSON.stringify({ isValid: true, payer: "GBUYER" }));
    if (request.url === "/settle") return response.end(JSON.stringify({ success: false, errorReason: "settlement_unavailable", errorMessage: "test facilitator failure" }));
    response.statusCode = 404;
    response.end();
  });
  const facilitatorUrl = await listen(facilitator);
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: merchantAddress, facilitatorUrl, maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  let completeCalls = 0;
  const service = new CommerceService(config, database, { domain: "micohstore.myshopify.com", completeDraftOrder: async () => { completeCalls += 1; return { id: "gid://shopify/Order/1", name: "#1001" }; } } as any);
  const quote = database.createQuote({ id: "5b45c7f1-2c2e-4e8d-bd4e-17c4078df3ba", merchantId: "micohstore", status: "quoted", currencyShopify: "CLP", totalShopify: "10000.00", currencyPayment: "USDC", totalUsdc: "10.000000", fxRate: "0.001", expiresAt: new Date(Date.now() + 60_000).toISOString(), shippingAddressJson: "{}", lineItemsJson: "[]", email: "buyer@example.com", shopifyDraftOrderId: "gid://shopify/DraftOrder/1", idempotencyKey: "quote:settlement-failure" });
  const appServer = createHttpApp(service).listen(0, "127.0.0.1");
  const appUrl = await new Promise<string>((resolve) => appServer.on("listening", () => { const address = appServer.address(); assert.ok(address && typeof address !== "string"); resolve(`http://127.0.0.1:${address.port}`); }));
  const endpoint = `${appUrl}/v1/quotes/${quote.id}/pay-and-place`;
  try {
    const unpaid = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userConfirmed: true }) });
    const challenge = JSON.parse(Buffer.from(String(unpaid.headers.get("payment-required")), "base64url").toString("utf8"));
    const signedPayload = { x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: { signedAuthorization: "test-only" } };
    const paid = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(signedPayload)).toString("base64url") }, body: JSON.stringify({ userConfirmed: true }) });
    assert.notEqual(paid.status, 200);
    assert.equal(database.getQuote(quote.id)?.status, "payment_failed");
    assert.equal(completeCalls, 0);
  } finally {
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => facilitator.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
