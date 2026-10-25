import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Account, Address, Keypair, Networks, Operation, TransactionBuilder, authorizeInvocation, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { FacilitatorTimeoutError, SettleError } from "@x402/core/types";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { classifySettlementFailure, createHttpApp } from "./http.js";
import { describeSignedTransfer } from "./stellar-settlement.js";

const merchant = Keypair.random().publicKey();
const buyer = Keypair.random();
const quoteUnits = 100_000_000n; // 10 USDC

/** Builds the payload an x402 Stellar client sends: a transfer invocation with the buyer's signed auth entry. */
async function signedPayload(options: { amount?: bigint; payTo?: string; expirationLedger?: number } = {}) {
  const args = [nativeToScVal(buyer.publicKey(), { type: "address" }), nativeToScVal(options.payTo ?? merchant, { type: "address" }), nativeToScVal(options.amount ?? quoteUnits, { type: "i128" })];
  const invocation = new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: new Address(USDC_TESTNET_ADDRESS).toScAddress(), functionName: "transfer", args })), subInvocations: [] });
  const auth = await authorizeInvocation({ signer: buyer, validUntilLedgerSeq: options.expirationLedger ?? 1_000, invocation, networkPassphrase: Networks.TESTNET });
  const tx = new TransactionBuilder(new Account(buyer.publicKey(), "0"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeContractFunction({ contract: USDC_TESTNET_ADDRESS, function: "transfer", args, auth: [auth] })).setTimeout(60).build();
  return { transaction: tx.toXDR() };
}

function config(directory: string, facilitatorUrl = "https://facilitator.invalid"): SetarehConfig {
  return { databasePath: join(directory, "setareh.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: merchant, facilitatorUrl, maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
}

function quoteFixture(id: string) {
  return { id, merchantId: "micohstore", status: "quoted" as const, currencyShopify: "CLP", totalShopify: "10000.00", currencyPayment: "USDC", totalUsdc: "10.0000000", fxRate: "0.001", expiresAt: new Date(Date.now() + 60_000).toISOString(), shippingAddressJson: "{}", lineItemsJson: JSON.stringify([{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }]), email: "buyer@example.com", shopifyDraftOrderId: "gid://shopify/DraftOrder/1", idempotencyKey: `quote:${id}` };
}

function shopifyDouble() {
  const calls = { completeDraftOrder: 0 };
  return {
    calls,
    client: {
      domain: "micohstore.myshopify.com",
      getVariant: async () => ({ id: "gid://shopify/ProductVariant/1", inventoryQuantity: 5, inventoryPolicy: "DENY", availableForSale: true, product: {} }),
      completeDraftOrder: async () => { calls.completeDraftOrder += 1; return { id: "gid://shopify/Order/1", name: "#1001" }; },
      attachPaymentEvidence: async () => undefined,
    },
  };
}

test("reads payer, merchant, amount and expiry from a signed x402 Stellar payload", async () => {
  const transfer = describeSignedTransfer({ payload: await signedPayload({ expirationLedger: 4_321 }) });
  assert.deepEqual(transfer, { asset: USDC_TESTNET_ADDRESS, from: buyer.publicKey(), to: merchant, amount: quoteUnits, signatureExpirationLedger: 4_321 });
  assert.equal(describeSignedTransfer({ payload: { transaction: "not-xdr" } }), undefined);
  assert.equal(describeSignedTransfer({ payload: { signedAuthorization: "test-only" } }), undefined);
});

test("only an explicit facilitator rejection without a transaction counts as a definite failure", () => {
  assert.deepEqual(classifySettlementFailure(new SettleError(400, { success: false, errorReason: "invalid_exact_stellar_payload_amount_mismatch", transaction: "", network: "stellar:testnet" })), { definite: true, reason: "invalid_exact_stellar_payload_amount_mismatch", transaction: undefined });
  assert.equal(classifySettlementFailure(new SettleError(500, { success: false, errorReason: "settle_exact_stellar_transaction_failed", transaction: "ab".repeat(32), network: "stellar:testnet" })).definite, false);
  assert.equal(classifySettlementFailure(new SettleError(500, { success: false, errorReason: "unexpected_settle_error", transaction: "", network: "stellar:testnet" })).definite, false);
  assert.equal(classifySettlementFailure(new SettleError(500, { success: false, errorReason: "settlement_pending", transaction: "", network: "stellar:testnet" })).definite, false);
  assert.deepEqual(classifySettlementFailure(new FacilitatorTimeoutError("settle", 90_000)), { definite: false, reason: "facilitator_timeout" });
  assert.equal(classifySettlementFailure(new TypeError("fetch failed")).definite, false);
});

async function payAgainst(settle: (response: import("node:http").ServerResponse) => void) {
  const directory = mkdtempSync(join(tmpdir(), "setareh-unknown-"));
  let settleCalls = 0;
  const facilitator = createServer((request, response) => {
    if (request.url === "/supported") { response.setHeader("Content-Type", "application/json"); return response.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: {} })); }
    if (request.url === "/settle") { settleCalls += 1; return settle(response); }
    response.statusCode = 404; response.end();
  });
  await new Promise<void>((resolve) => facilitator.listen(0, "127.0.0.1", resolve));
  const facilitatorAddress = facilitator.address();
  assert.ok(facilitatorAddress && typeof facilitatorAddress !== "string");
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  const shopify = shopifyDouble();
  const service = new CommerceService(config(directory, `http://127.0.0.1:${facilitatorAddress.port}`), database, shopify.client as any);
  const quote = database.createQuote(quoteFixture("1f7c2d4e-9a31-4b8e-a6f2-0c5d7e8f9a10"));
  const appServer = createHttpApp(service).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.on("listening", resolve));
  const appAddress = appServer.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  const base = `http://127.0.0.1:${appAddress.port}`;
  const endpoint = `${base}/v1/quotes/${quote.id}/pay-and-place`;
  const unpaid = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userConfirmed: true }) });
  const challenge = JSON.parse(Buffer.from(String(unpaid.headers.get("payment-required")), "base64url").toString("utf8"));
  const header = Buffer.from(JSON.stringify({ x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: await signedPayload({ expirationLedger: 777 }) })).toString("base64url");
  const pay = () => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": header }, body: JSON.stringify({ userConfirmed: true }) });
  return {
    database, quote, shopify, base, pay, settleCalls: () => settleCalls,
    close: async () => {
      await new Promise<void>((resolve) => appServer.close(() => resolve()));
      await new Promise<void>((resolve) => facilitator.close(() => resolve()));
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("a facilitator that fails without a definite answer holds the quote as payment_unknown", async () => {
  const run = await payAgainst((response) => { response.statusCode = 502; response.end("<html>Bad gateway</html>"); });
  try {
    const paid = await run.pay();
    assert.notEqual(paid.status, 200);
    assert.equal(run.database.getQuote(run.quote.id)?.status, "payment_unknown");
    const attempt = run.database.getLatestPaymentAttempt(run.quote.id);
    assert.equal(attempt?.outcome, "unknown");
    assert.equal(attempt?.payer, buyer.publicKey());
    assert.equal(attempt?.payTo, merchant);
    assert.equal(attempt?.amount, quoteUnits.toString());
    assert.equal(attempt?.signatureExpirationLedger, 777);
    assert.equal(run.shopify.calls.completeDraftOrder, 0);

    // A retry, even with a freshly signed payment, must not reach the facilitator again.
    const retry = await run.pay();
    assert.notEqual(retry.status, 200);
    assert.equal(run.settleCalls(), 1);
    const status = await (await fetch(`${run.base}/v1/orders/${run.quote.id}`)).json() as { status: string };
    assert.equal(status.status, "payment_unknown");
  } finally { await run.close(); }
});

test("a rejection that reports a submitted transaction keeps its hash for reconciliation", async () => {
  const hash = "cd".repeat(32);
  const run = await payAgainst((response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ success: false, errorReason: "settle_exact_stellar_transaction_failed", transaction: hash, network: "stellar:testnet", payer: buyer.publicKey() })); });
  try {
    assert.notEqual((await run.pay()).status, 200);
    assert.equal(run.database.getQuote(run.quote.id)?.status, "payment_unknown");
    assert.equal(run.database.getLatestPaymentAttempt(run.quote.id)?.facilitatorTransaction, hash);
  } finally { await run.close(); }
});
