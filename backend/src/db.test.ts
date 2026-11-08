import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { SetarehDatabase } from "./db.js";
import { CommerceService } from "./commerce.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "setareh-db-"));
  const database = new SetarehDatabase(join(directory, "test.db"));
  database.upsertMerchant({ id: "micohstore", name: "Micohstore", shopDomain: "micohstore.myshopify.com", stellarRecipient: "GTEST" });
  return { database, directory };
}

function quote(id: string, expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return { id, merchantId: "micohstore", status: "quoted" as const, currencyShopify: "CLP", totalShopify: "10000.00", currencyPayment: "USDC", totalUsdc: "10.000000", fxRate: "0.001", expiresAt, shippingAddressJson: "{}", lineItemsJson: "[]", email: "buyer@example.com", shopifyDraftOrderId: "gid://shopify/DraftOrder/1", idempotencyKey: `quote:${id}` };
}

test("expires quotes before they can be paid", () => {
  const { database, directory } = fixture();
  try {
    const record = database.createQuote(quote("expired", new Date(Date.now() - 1_000).toISOString()));
    assert.throws(() => database.getUsableQuote(record.id), /expired/i);
    assert.equal(database.getQuote(record.id)?.status, "expired");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("migrates a pre-existing merchant table without persisting Shopify secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-migration-"));
  const path = join(directory, "setareh.db");
  const legacy = new DatabaseSync(path);
  legacy.exec("CREATE TABLE merchant (id TEXT PRIMARY KEY, name TEXT NOT NULL, shop_domain TEXT NOT NULL, stellar_recipient TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1) STRICT;");
  legacy.close();
  const database = new SetarehDatabase(path);
  try {
    database.upsertMerchant({ id: "micohstore", name: "Micohstore", shopDomain: "micohstore.myshopify.com", shopifyCredentialsRef: "vault:shopify/micohstore", stellarRecipient: "GTEST" });
  } finally { database.close(); }
  const inspected = new DatabaseSync(path);
  try {
    const columns = inspected.prepare("PRAGMA table_info(merchant)").all() as Array<{ name: string }>;
    const merchant = inspected.prepare("SELECT shopify_credentials_ref FROM merchant WHERE id = ?").get("micohstore") as { shopify_credentials_ref: string };
    assert.ok(columns.some((column) => column.name === "shopify_credentials_ref"));
    assert.equal(merchant.shopify_credentials_ref, "vault:shopify/micohstore");
  } finally { inspected.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("keeps one Shopify order for a quote across retries", () => {
  const { database, directory } = fixture();
  try {
    const record = database.createQuote(quote("retry"));
    const first = database.createOrder({ quoteId: record.id, shopifyOrderId: "gid://shopify/Order/1", shopifyOrderName: "#1001", status: "created" });
    const second = database.createOrder({ quoteId: record.id, shopifyOrderId: "gid://shopify/Order/2", shopifyOrderName: "#1002", status: "created" });
    assert.equal(first.id, second.id);
    assert.equal(second.shopifyOrderName, "#1001");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("does not expose a settled quote for a second x402 payment", () => {
  const { database, directory } = fixture();
  try {
    const record = database.createQuote(quote("settled"));
    database.recordPaymentSettled({ quoteId: record.id, network: "stellar:testnet", asset: "USDC", amount: "10.000000", payTo: "GTEST", paymentPayloadHash: "payload", receipt: { transactionHash: "abc" } });
    const service = new CommerceService({ databasePath: join(directory, "test.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GTEST", facilitatorUrl: "https://example.test", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 }, database, { domain: "micohstore.myshopify.com" } as any);
    assert.throws(() => service.getPayableQuote(record.id), /cannot be charged again/i);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("rejects a settled payload whose Stellar requirements differ from its quote", () => {
  const { database, directory } = fixture();
  try {
    const record = database.createQuote(quote("tampered-payment"));
    const service = new CommerceService({ databasePath: join(directory, "test.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GTEST", facilitatorUrl: "https://example.test", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 }, database, { domain: "micohstore.myshopify.com" } as any);
    assert.throws(() => service.recordSettlement(record.id, { payload: { accepted: { network: "stellar:testnet", asset: USDC_TESTNET_ADDRESS, amount: "1", payTo: "GTEST" } }, receipt: {} }), /do not match/i);
    assert.equal(database.getPayment(record.id), undefined);
    assert.equal(database.getQuote(record.id)?.status, "quoted");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("keeps settlement evidence and moves to manual review if Shopify fails after payment", async () => {
  const { database, directory } = fixture();
  try {
    const record = database.createQuote({ ...quote("shopify-failure"), lineItemsJson: JSON.stringify([{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }]) });
    database.recordPaymentSettled({ quoteId: record.id, network: "stellar:testnet", asset: "USDC", amount: "10.0000000", payTo: "GTEST", paymentPayloadHash: "payload", transactionHash: "stellar-hash", receipt: { transactionHash: "stellar-hash", signedAuthorization: "must-not-leak" } });
    const service = new CommerceService({ databasePath: join(directory, "test.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GTEST", facilitatorUrl: "https://example.test", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 }, database, {
      domain: "micohstore.myshopify.com",
      getVariant: async () => ({ inventoryQuantity: 1, inventoryPolicy: "DENY", availableForSale: true, product: {} }),
      completeDraftOrder: async () => ({ id: "gid://shopify/Order/1", name: "#1001" }),
      attachPaymentEvidence: async () => { throw new Error("Shopify metafield write failed"); },
    } as any);
    await assert.rejects(service.placePaidOrder(record.id, true), /metafield write failed/i);
    assert.equal(database.getQuote(record.id)?.status, "manual_review");
    assert.equal(database.getPayment(record.id)?.stellar_transaction_hash, "stellar-hash");
    const persistedOrder = database.getOrderByQuote(record.id);
    assert.equal(persistedOrder?.shopifyOrderId, "gid://shopify/Order/1");
    assert.equal(persistedOrder?.status, "manual_review");
    const status = service.getOrderStatus(record.id);
    assert.equal(status.status, "manual_review");
    assert.deepEqual(status.order, { id: "gid://shopify/Order/1", name: "#1001" });
    assert.equal((status.payment as { transactionHash: string }).transactionHash, "stellar-hash");
    assert.ok(!JSON.stringify(status).includes("must-not-leak"));
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("reconciles a completed Shopify draft after a local manual review", async () => {
  const { database, directory } = fixture();
  try {
    const record = database.createQuote(quote("reconcile-completed-draft"));
    database.recordPaymentSettled({ quoteId: record.id, network: "stellar:testnet", asset: "USDC", amount: "10.0000000", payTo: "GTEST", paymentPayloadHash: "payload", transactionHash: "stellar-hash", receipt: {} });
    database.markManualReview(record.id);
    const service = new CommerceService({ databasePath: join(directory, "test.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GTEST", facilitatorUrl: "https://example.test", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 }, database, {
      domain: "micohstore.myshopify.com",
      getDraftOrder: async () => ({ id: "gid://shopify/DraftOrder/1", name: "#D1", status: "COMPLETED", invoiceUrl: null, totalPrice: "10000.00", currencyCode: "CLP", order: { id: "gid://shopify/Order/1", name: "#1001" } }),
      attachPaymentEvidence: async () => undefined,
    } as any);
    const result = await service.reconcilePaidDraftOrder(record.id);
    assert.equal(result.status, "created");
    assert.equal(result.shopifyOrder.id, "gid://shopify/Order/1");
    assert.equal(database.getQuote(record.id)?.status, "created");
    assert.equal(database.getOrderByQuote(record.id)?.status, "created");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("claims Shopify completion once when paid-order retries overlap", async () => {
  const { database, directory } = fixture();
  try {
    const record = database.createQuote({ ...quote("concurrent-order"), lineItemsJson: JSON.stringify([{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }]) });
    database.recordPaymentSettled({ quoteId: record.id, network: "stellar:testnet", asset: "USDC", amount: "10.0000000", payTo: "GTEST", paymentPayloadHash: "payload", receipt: {} });
    let completeCalls = 0;
    let releaseCompletion: (() => void) | undefined;
    const completionStarted = new Promise<void>((resolve) => { releaseCompletion = resolve; });
    let entered: (() => void) | undefined;
    const completionEntered = new Promise<void>((resolve) => { entered = resolve; });
    const service = new CommerceService({ databasePath: join(directory, "test.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GTEST", facilitatorUrl: "https://example.test", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 }, database, {
      domain: "micohstore.myshopify.com",
      getVariant: async () => ({ inventoryQuantity: 1, inventoryPolicy: "DENY", availableForSale: true, product: {} }),
      completeDraftOrder: async () => { completeCalls += 1; entered?.(); await completionStarted; return { id: "gid://shopify/Order/1", name: "#1001" }; },
      attachPaymentEvidence: async () => undefined,
    } as any);
    const first = service.placePaidOrder(record.id, true);
    await completionEntered;
    await assert.rejects(service.placePaidOrder(record.id, true), /already in progress/i);
    releaseCompletion?.();
    await first;
    assert.equal(completeCalls, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("freezes configured demo shipping in the Shopify draft and quote", async () => {
  const { database, directory } = fixture();
  try {
    let shippingLine: unknown;
    const service = new CommerceService({ databasePath: join(directory, "test.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GTEST", facilitatorUrl: "https://example.test", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001, shippingFlatClp: 1500, shippingTitle: "Despacho Santiago" }, database, {
      domain: "micohstore.myshopify.com",
      getVariant: async () => ({ inventoryQuantity: 1, inventoryPolicy: "DENY", availableForSale: true, product: {} }),
      createDraftOrder: async (input: { shippingLine?: unknown }) => { shippingLine = input.shippingLine; return { id: "gid://shopify/DraftOrder/1", name: "#D1001", totalPrice: "11500.00", currencyCode: "CLP" }; },
    } as any);
    const quote = await service.createQuote({ merchantId: "micohstore", items: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }], email: "buyer@example.com", shippingAddress: { address1: "Calle 1", city: "Santiago", country: "Chile", zip: "8320000", firstName: "Ana", lastName: "Díaz" }, userConfirmed: true });
    assert.deepEqual(shippingLine, { title: "Despacho Santiago", price: 1500 });
    assert.deepEqual(quote.shopifyDraftOrder.shipping, { title: "Despacho Santiago", amount: "1500.00" });
    assert.equal(quote.shopifyDraftOrder.total, "11500.00");
    assert.deepEqual(quote.exchangeRate, { shopifyPerUsdc: "0.001", source: "configured_demo_rate" });
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("purges buyer email, address and raw receipt only after the retention window, never for quotes an operator still needs", () => {
  const { database, directory } = fixture();
  try {
    const day = 24 * 60 * 60 * 1000;
    const longAgo = new Date(Date.now() - 40 * day).toISOString();
    const recently = new Date(Date.now() - 10 * day).toISOString();
    database.createQuote(quote("expired-old", longAgo));
    database.createQuote(quote("expired-recent", recently));
    database.createQuote(quote("ordered", new Date(Date.now() + 60_000).toISOString()));
    database.recordPaymentSettled({ quoteId: "ordered", network: "stellar:testnet", asset: "USDC", amount: "10.000000", payTo: "GTEST", paymentPayloadHash: "h", transactionHash: "tx", receipt: { raw: "facilitator receipt" } });
    database.createOrder({ quoteId: "ordered", shopifyOrderId: "gid://shopify/Order/1", shopifyOrderName: "#1001", status: "created" });
    database.createQuote(quote("unknown", longAgo));
    database.updateQuoteStatus("unknown", "payment_unknown");

    const dryRun = database.purgePersonalData({ expiredAfterDays: 30, orderedAfterDays: 90, apply: false });
    assert.deepEqual(dryRun.map((entry) => [entry.quoteId, entry.reason, entry.purged]), [["expired-old", "unpaid", false]]);
    assert.equal(database.getQuote("expired-old")?.email, "buyer@example.com");

    const applied = database.purgePersonalData({ expiredAfterDays: 30, orderedAfterDays: 90, apply: true });
    assert.deepEqual(applied.map((entry) => [entry.quoteId, entry.purged]), [["expired-old", true]]);
    const purged = database.getQuote("expired-old");
    assert.equal(purged?.email, "");
    assert.equal(purged?.shippingAddressJson, "{}");
    assert.equal(purged?.totalUsdc, "10.000000");
    assert.ok(database.personalDataPurgedAt("expired-old"));
    assert.equal(database.getQuote("expired-recent")?.email, "buyer@example.com");
    assert.equal(database.getQuote("unknown")?.email, "buyer@example.com");
    assert.equal(database.getQuote("ordered")?.email, "buyer@example.com");

    // 100 days later the ordered quote crosses its window; the receipt goes with the address, the hash stays.
    const later = database.purgePersonalData({ expiredAfterDays: 30, orderedAfterDays: 90, now: new Date(Date.now() + 100 * day), apply: true });
    // The quote that expired 10 days ago also crosses its 30-day window by then.
    assert.deepEqual(later.map((entry) => [entry.quoteId, entry.reason]), [["expired-recent", "unpaid"], ["ordered", "ordered"]]);
    assert.equal(database.getQuote("ordered")?.email, "");
    const payment = database.getPayment("ordered");
    assert.equal(payment?.facilitator_receipt_json, null);
    assert.equal(payment?.stellar_transaction_hash, "tx");
    assert.equal(database.getQuote("unknown")?.email, "buyer@example.com");
    // Idempotent: nothing left to purge.
    assert.deepEqual(database.purgePersonalData({ expiredAfterDays: 30, orderedAfterDays: 90, now: new Date(Date.now() + 100 * day), apply: true }), []);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
