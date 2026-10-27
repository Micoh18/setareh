import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CommerceService } from "./commerce.js";
import { SetarehDatabase } from "./db.js";
import { findStuckQuotes, STUCK_AFTER_MS } from "./operations.js";

const variant = { id: "gid://shopify/ProductVariant/1", inventoryQuantity: 5, inventoryPolicy: "DENY", availableForSale: true, product: {} };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "setareh-ops-"));
  const database = new SetarehDatabase(join(directory, "test.db"));
  database.upsertMerchant({ id: "micohstore", name: "Micohstore", shopDomain: "micohstore.myshopify.com", stellarRecipient: "GTEST" });
  const config = { databasePath: join(directory, "test.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet" as const, stellarAsset: "USDC", stellarMerchantAddress: "GTEST", facilitatorUrl: "https://example.test", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  const quote = (id: string) => database.createQuote({ id, merchantId: "micohstore", status: "quoted", currencyShopify: "CLP", totalShopify: "15000.00", currencyPayment: "USDC", totalUsdc: "15.0000000", fxRate: "0.001", expiresAt: new Date(Date.now() + 60_000).toISOString(), shippingAddressJson: "{}", lineItemsJson: JSON.stringify([{ variantId: variant.id, quantity: 1 }]), email: "buyer@example.com", shopifyDraftOrderId: `gid://shopify/DraftOrder/${id}`, idempotencyKey: `quote:${id}` });
  const settle = (id: string) => database.recordPaymentSettled({ quoteId: id, network: "stellar:testnet", asset: "USDC", amount: "15.0000000", payTo: "GTEST", paymentPayloadHash: "p", transactionHash: id.padEnd(64, "0"), receipt: {} });
  return { database, config, quote, settle, cleanup: () => { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

const later = () => new Date(Date.now() + STUCK_AFTER_MS + 60_000);

test("only quotes that sat in an intermediate status past the threshold are reported as stuck", () => {
  const run = fixture();
  try {
    run.quote("fresh"); run.database.updateQuoteStatus("fresh", "payment_submitted");
    run.quote("done"); run.settle("done"); run.database.createOrder({ quoteId: "done", shopifyOrderId: "gid://shopify/Order/1", shopifyOrderName: "#1", status: "created" });
    run.quote("old-submitted"); run.database.updateQuoteStatus("old-submitted", "payment_submitted");
    run.quote("old-creating"); run.settle("old-creating"); run.database.claimShopifyOrderCreation("old-creating");
    assert.deepEqual(findStuckQuotes(run.database).map((q) => q.quoteId), [], "nothing is stuck right after it happened");
    const stuck = findStuckQuotes(run.database, later());
    assert.deepEqual(stuck.map((q) => [q.quoteId, q.status]).sort(), [["fresh", "payment_submitted"], ["old-creating", "creating_shopify_order"], ["old-submitted", "payment_submitted"]]);
    assert.ok(stuck.every((q) => q.ageMinutes >= 5 && q.action.includes("--apply")));
  } finally { run.cleanup(); }
});

test("F11: a settlement interrupted by a restart becomes payment_unknown with the payer kept for reconciliation", () => {
  const run = fixture();
  try {
    const service = new CommerceService(run.config, run.database, { domain: "micohstore.myshopify.com" } as any);
    run.quote("interrupted");
    service.getPayableQuote("interrupted");
    service.markPaymentSubmitted("interrupted", undefined);
    // Simulates what the HTTP hook stores from the signed payload.
    run.database.recordPaymentAttempt({ quoteId: "interrupted", outcome: "submitted", errorReason: "", facilitatorTransaction: null, payer: "GPAYER", amount: "150000000", payTo: "GTEST", signatureExpirationLedger: 1234 });
    const attempt = service.markInterruptedSettlement("interrupted");
    assert.equal(run.database.getQuote("interrupted")?.status, "payment_unknown");
    assert.equal(attempt.outcome, "unknown");
    assert.equal(attempt.errorReason, "process_interrupted");
    assert.equal(attempt.payer, "GPAYER");
    assert.equal(attempt.signatureExpirationLedger, 1234);
    assert.throws(() => service.getPayableQuote("interrupted"), /not payable/);
  } finally { run.cleanup(); }
});

test("F11: an interrupted order attempt adopts the Shopify order when the draft completed, otherwise retries once", async () => {
  const run = fixture();
  try {
    let completions = 0;
    const shopify = {
      domain: "micohstore.myshopify.com",
      getVariant: async () => variant,
      getDraftOrder: async (id: string) => ({ id, name: "#D", status: "COMPLETED", invoiceUrl: null, totalPrice: "15000.00", currencyCode: "CLP", order: id.endsWith("adopt") ? { id: "gid://shopify/Order/77", name: "#1077" } : null }),
      completeDraftOrder: async () => { completions += 1; return { id: "gid://shopify/Order/88", name: "#1088" }; },
      attachPaymentEvidence: async () => undefined,
    };
    const service = new CommerceService(run.config, run.database, shopify as any);
    run.quote("adopt"); run.settle("adopt"); run.database.claimShopifyOrderCreation("adopt");
    run.quote("retry"); run.settle("retry"); run.database.claimShopifyOrderCreation("retry");

    const adopted = await service.resumeInterruptedOrder("adopt");
    assert.equal(adopted.shopifyOrder.name, "#1077");
    assert.equal(completions, 0, "a completed draft must not be completed again");
    const retried = await service.resumeInterruptedOrder("retry");
    assert.equal(retried.shopifyOrder.name, "#1088");
    assert.equal(completions, 1);
    assert.equal(run.database.getQuote("adopt")?.status, "created");
    assert.equal(run.database.getQuote("retry")?.status, "created");
    assert.deepEqual(findStuckQuotes(run.database, later()), []);
  } finally { run.cleanup(); }
});
