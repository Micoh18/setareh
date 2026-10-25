import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createHttpApp } from "./http.js";

const merchantAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const supported = { kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: {} };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type FacilitatorHandler = (url: string, response: ServerResponse, request: IncomingMessage) => Promise<unknown> | unknown;

/** Runs the real HTTP app against a scripted facilitator and an in-memory Shopify double. */
async function harness(options: { quoteTtlMs: number; facilitator: FacilitatorHandler }) {
  const directory = mkdtempSync(join(tmpdir(), "setareh-payment-safety-"));
  const facilitator = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/supported") return response.end(JSON.stringify(supported));
    const result = await options.facilitator(String(request.url), response, request);
    if (!response.writableEnded) response.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => facilitator.listen(0, "127.0.0.1", resolve));
  const facilitatorAddress = facilitator.address();
  assert.ok(facilitatorAddress && typeof facilitatorAddress !== "string");
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: merchantAddress, facilitatorUrl: `http://127.0.0.1:${facilitatorAddress.port}`, maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  const shopifyCalls = { completeDraftOrder: 0 };
  const shopify = {
    domain: "micohstore.myshopify.com",
    getVariant: async () => ({ id: "gid://shopify/ProductVariant/1", inventoryQuantity: 5, inventoryPolicy: "DENY", availableForSale: true, product: { id: "gid://shopify/Product/1", title: "Gato mago", handle: "gato-mago", status: "ACTIVE" } }),
    completeDraftOrder: async () => { shopifyCalls.completeDraftOrder += 1; return { id: "gid://shopify/Order/1", name: "#1001" }; },
    attachPaymentEvidence: async () => undefined,
  };
  const service = new CommerceService(config, database, shopify as any);
  const quote = database.createQuote({ id: "7d0f8a52-5b8e-4c55-9d43-2b8f0f3f6a10", merchantId: "micohstore", status: "quoted", currencyShopify: "CLP", totalShopify: "10000.00", currencyPayment: "USDC", totalUsdc: "10.000000", fxRate: "0.001", expiresAt: new Date(Date.now() + options.quoteTtlMs).toISOString(), shippingAddressJson: "{}", lineItemsJson: JSON.stringify([{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }]), email: "buyer@example.com", shopifyDraftOrderId: "gid://shopify/DraftOrder/1", idempotencyKey: "quote:payment-safety" });
  const appServer = createHttpApp(service).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.on("listening", resolve));
  const appAddress = appServer.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  const endpoint = `http://127.0.0.1:${appAddress.port}/v1/quotes/${quote.id}/pay-and-place`;

  async function challenge() {
    const unpaid = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userConfirmed: true }) });
    assert.equal(unpaid.status, 402);
    return JSON.parse(Buffer.from(String(unpaid.headers.get("payment-required")), "base64url").toString("utf8"));
  }

  /** Each call signs a distinct payload, like an agent that re-signs after a timeout. */
  function pay(accepted: { resource: unknown; accepts: unknown[] }, signature: string) {
    const payload = { x402Version: 2, resource: accepted.resource, accepted: accepted.accepts[0], payload: { signedAuthorization: signature } };
    return fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64url") }, body: JSON.stringify({ userConfirmed: true }) });
  }

  async function close() {
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => facilitator.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }

  return { database, service, quote, shopifyCalls, challenge, pay, close };
}

const settled = { success: true, payer: "GBUYER", transaction: "stellar-testnet-hash", network: "stellar:testnet", amount: "100000000" };

test("two requests that both pass the route guard can claim settlement only once", async () => {
  const run = await harness({ quoteTtlMs: 60_000, facilitator: () => settled });
  try {
    // Both requests read the quote as payable before either reaches the settlement hook.
    run.service.getPayableQuote(run.quote.id);
    run.service.getPayableQuote(run.quote.id);
    run.service.markPaymentSubmitted(run.quote.id);
    assert.throws(() => run.service.markPaymentSubmitted(run.quote.id), /not ready for payment settlement/i);
    assert.equal(run.database.getQuote(run.quote.id)?.status, "payment_submitted");
  } finally { await run.close(); }
});

test("a lost settlement claim stops the facilitator call instead of being logged and ignored", async () => {
  let settleCalls = 0;
  const run = await harness({ quoteTtlMs: 60_000, facilitator: (url) => { if (url === "/settle") settleCalls += 1; return settled; } });
  try {
    const accepted = await run.challenge();
    // Simulates a concurrent request that claimed the quote between the route guard and settlement.
    run.database.claimPaymentSubmission = () => false;
    const paid = await run.pay(accepted, "losing-signature");
    assert.notEqual(paid.status, 200);
    assert.equal(settleCalls, 0);
    assert.equal(run.database.getPayment(run.quote.id), undefined);
    assert.equal(run.shopifyCalls.completeDraftOrder, 0);
  } finally { await run.close(); }
});

test("a paid retry after success neither settles nor orders again", async () => {
  let settleCalls = 0;
  const run = await harness({ quoteTtlMs: 60_000, facilitator: (url) => { if (url === "/settle") settleCalls += 1; return settled; } });
  try {
    const accepted = await run.challenge();
    assert.equal((await run.pay(accepted, "first-signature")).status, 200);
    assert.notEqual((await run.pay(accepted, "second-signature")).status, 200);
    assert.equal(settleCalls, 1);
    assert.equal(run.shopifyCalls.completeDraftOrder, 1);
  } finally { await run.close(); }
});

test("a quote that expires while its settlement is in flight keeps the payment and creates the order", async () => {
  const run = await harness({
    quoteTtlMs: 1_500,
    facilitator: async (url) => {
      if (url === "/settle") { await sleep(2_000); return { ...settled, transaction: "stellar-late-hash" }; }
      return {};
    },
  });
  try {
    const accepted = await run.challenge();
    const paid = await run.pay(accepted, "only-signature");
    assert.equal(paid.status, 200);
    assert.ok(new Date(run.quote.expiresAt).getTime() < Date.now(), "the quote must have expired during settlement");
    assert.equal(run.database.getPayment(run.quote.id)?.stellar_transaction_hash, "stellar-late-hash");
    assert.equal(run.database.getQuote(run.quote.id)?.status, "created");
  } finally { await run.close(); }
});

test("an expired quote cannot be claimed for settlement", async () => {
  const run = await harness({ quoteTtlMs: 200, facilitator: () => settled });
  try {
    run.service.getPayableQuote(run.quote.id);
    await sleep(300);
    assert.equal(run.database.claimPaymentSubmission(run.quote.id), false);
    assert.equal(run.database.getQuote(run.quote.id)?.status, "payment_required");
  } finally { await run.close(); }
});

test("a settlement that cannot be recorded parks the quote in manual review without ordering", async () => {
  const run = await harness({ quoteTtlMs: 60_000, facilitator: () => settled });
  try {
    const accepted = await run.challenge();
    run.service.recordSettlement = () => { throw new Error("simulated database failure"); };
    const paid = await run.pay(accepted, "only-signature");
    assert.notEqual(paid.status, 200);
    assert.equal(run.database.getQuote(run.quote.id)?.status, "manual_review");
    assert.equal(run.shopifyCalls.completeDraftOrder, 0);
  } finally { await run.close(); }
});
