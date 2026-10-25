import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Account, Address, Keypair, Networks, Operation, StrKey, TransactionBuilder, authorizeInvocation, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { FacilitatorTimeoutError, SettleError } from "@x402/core/types";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase, type PaymentAttemptRecord } from "./db.js";
import { classifySettlementFailure, createHttpApp } from "./http.js";
import { reconcileUnknownPayment } from "./payment-reconciliation.js";
import { describeSignedTransfer, type SettlementRpc } from "./stellar-settlement.js";

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

type ChainTransfer = { hash: string; ledger: number; from: string; to: string; amount: bigint; succeeded?: boolean };

/** An RPC double that answers getTransaction and getEvents from a list of USDC transfers. */
function chain(transfers: ChainTransfer[], latestLedger: number, oldestLedger = 1): SettlementRpc {
  const topics = (transfer: ChainTransfer) => [nativeToScVal("transfer", { type: "symbol" }), nativeToScVal(transfer.from, { type: "address" }), nativeToScVal(transfer.to, { type: "address" }), nativeToScVal(`USDC:${merchant}`)];
  return {
    getHealth: async () => ({ status: "healthy", latestLedger, oldestLedger, ledgerRetentionWindow: latestLedger - oldestLedger }),
    getTransaction: async (hash: string) => {
      const transfer = transfers.find((candidate) => candidate.hash === hash);
      if (!transfer) return { status: rpc.Api.GetTransactionStatus.NOT_FOUND, txHash: hash } as any;
      if (transfer.succeeded === false) return { status: rpc.Api.GetTransactionStatus.FAILED, txHash: hash, ledger: transfer.ledger } as any;
      const event = { contractId: { toXdrObject: () => StrKey.decodeContract(USDC_TESTNET_ADDRESS) }, body: { type: "v0", v0: { topics: topics(transfer), data: nativeToScVal(transfer.amount, { type: "i128" }) } } };
      return { status: rpc.Api.GetTransactionStatus.SUCCESS, txHash: hash, ledger: transfer.ledger, events: { transactionEventsXdr: [], contractEventsXdr: [[event]] } } as any;
    },
    getEvents: async (request: any) => {
      const events = transfers
        .filter((transfer) => transfer.succeeded !== false && transfer.ledger >= request.startLedger && transfer.ledger < request.endLedger)
        .map((transfer) => ({ txHash: transfer.hash, ledger: transfer.ledger, topic: topics(transfer), value: nativeToScVal(transfer.amount, { type: "i128" }) }))
        // Mirrors the RPC topic filter on payer and merchant.
        .filter((event) => request.filters[0].topics[0].slice(1, 3).every((wanted: string, index: number) => event.topic[index + 1].toXdr("base64") === wanted));
      return { events, cursor: "", latestLedger, oldestLedger } as any;
    },
  } as unknown as SettlementRpc;
}

function unknownAttempt(overrides: Partial<PaymentAttemptRecord> = {}): PaymentAttemptRecord {
  return { id: "attempt", quoteId: "q", outcome: "unknown", errorReason: "facilitator_timeout", facilitatorTransaction: null, payer: buyer.publicKey(), amount: quoteUnits.toString(), payTo: merchant, signatureExpirationLedger: 1_010, createdAt: new Date(Date.now() - 60_000).toISOString(), ...overrides };
}

const quote = { ...quoteFixture("q"), status: "payment_unknown" as const, fxSource: "configured_demo_rate", createdAt: new Date().toISOString() };
const reconcile = (server: SettlementRpc, attempt: PaymentAttemptRecord, extra: { operatorTransaction?: string; claimed?: string[] } = {}) =>
  reconcileUnknownPayment(server, { quote, attempt, asset: USDC_TESTNET_ADDRESS, payTo: merchant, operatorTransaction: extra.operatorTransaction, claimedElsewhere: (hash) => (extra.claimed ?? []).includes(hash) });

test("reconciliation confirms the facilitator's transaction when it carries the quoted transfer", async () => {
  const hash = "aa".repeat(32);
  const verdict = await reconcile(chain([{ hash, ledger: 1_002, from: buyer.publicKey(), to: merchant, amount: quoteUnits }], 1_020), unknownAttempt({ facilitatorTransaction: hash }));
  assert.deepEqual(verdict, { verdict: "paid", transactionHash: hash, ledger: 1_002, source: "facilitator_transaction" });
});

test("reconciliation finds an unreported settlement by its transfer event", async () => {
  const transfers = [
    { hash: "bb".repeat(32), ledger: 1_003, from: buyer.publicKey(), to: merchant, amount: quoteUnits },
    { hash: "cc".repeat(32), ledger: 1_004, from: buyer.publicKey(), to: merchant, amount: quoteUnits + 1n },
    { hash: "dd".repeat(32), ledger: 1_005, from: Keypair.random().publicKey(), to: merchant, amount: quoteUnits },
  ];
  assert.deepEqual(await reconcile(chain(transfers, 1_020), unknownAttempt()), { verdict: "paid", transactionHash: "bb".repeat(32), ledger: 1_003, source: "event_search" });
});

test("reconciliation refuses to pick between two matching transfers or reuse another quote's", async () => {
  const transfers = [
    { hash: "ee".repeat(32), ledger: 1_003, from: buyer.publicKey(), to: merchant, amount: quoteUnits },
    { hash: "ff".repeat(32), ledger: 1_006, from: buyer.publicKey(), to: merchant, amount: quoteUnits },
  ];
  assert.equal((await reconcile(chain(transfers, 1_020), unknownAttempt())).verdict, "ambiguous");
  assert.deepEqual(await reconcile(chain(transfers, 1_020), unknownAttempt(), { claimed: ["ee".repeat(32)] }), { verdict: "paid", transactionHash: "ff".repeat(32), ledger: 1_006, source: "event_search" });
});

test("reconciliation declares a quote unpaid only after the buyer's authorization expired", async () => {
  const failedHash = "12".repeat(32);
  const failed = [{ hash: failedHash, ledger: 1_002, from: buyer.publicKey(), to: merchant, amount: quoteUnits, succeeded: false }];
  const stillValid = await reconcile(chain(failed, 1_008), unknownAttempt({ facilitatorTransaction: failedHash }));
  assert.equal(stillValid.verdict, "pending");
  assert.deepEqual(await reconcile(chain(failed, 1_011), unknownAttempt({ facilitatorTransaction: failedHash })), { verdict: "unpaid", reason: "authorization_expired", expiredAtLedger: 1_010, latestLedger: 1_011 });
  assert.equal((await reconcile(chain([], 1_011), unknownAttempt({ signatureExpirationLedger: null }))).verdict, "pending");
});

test("reconciliation sends inconsistent or unverifiable cases to an operator", async () => {
  const server = chain([], 1_020);
  assert.equal((await reconcile(server, unknownAttempt({ amount: "1" }))).verdict, "needs_operator");
  assert.equal((await reconcile(server, unknownAttempt({ payTo: Keypair.random().publicKey() }))).verdict, "needs_operator");
  assert.equal((await reconcile(server, unknownAttempt({ payer: null }))).verdict, "needs_operator");
  assert.equal((await reconcile(server, unknownAttempt(), { operatorTransaction: "34".repeat(32) })).verdict, "needs_operator");
  assert.equal((await reconcile(chain([], 1_020, 1_000), unknownAttempt({ createdAt: new Date(Date.now() - 86_400_000).toISOString() }))).verdict, "needs_operator");
  const mismatched = "56".repeat(32);
  assert.equal((await reconcile(chain([{ hash: mismatched, ledger: 1_002, from: buyer.publicKey(), to: merchant, amount: 5n }], 1_020), unknownAttempt({ facilitatorTransaction: mismatched }))).verdict, "needs_operator");
});

test("a reconciled settlement completes the order once; an unpaid verdict frees nothing to charge", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-reconciled-"));
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  try {
    const shopify = shopifyDouble();
    const service = new CommerceService(config(directory), database, shopify.client as any);
    const paid = database.createQuote({ ...quoteFixture("paid"), status: "payment_unknown" });
    const unpaid = database.createQuote({ ...quoteFixture("unpaid"), status: "payment_unknown" });
    service.recordReconciledSettlement(paid.id, "ab".repeat(32));
    const order = await service.placePaidOrder(paid.id, true);
    assert.equal(order.status, "created");
    assert.equal(order.payment?.transactionHash, "ab".repeat(32));
    assert.equal(shopify.calls.completeDraftOrder, 1);
    assert.throws(() => service.recordReconciledSettlement(unpaid.id, "ab".repeat(32)), /already settles quote paid/);
    service.markReconciledUnpaid(unpaid.id);
    assert.equal(database.getQuote(unpaid.id)?.status, "payment_failed");
    assert.throws(() => service.getPayableQuote(unpaid.id), /not payable/);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
