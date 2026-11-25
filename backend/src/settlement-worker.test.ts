import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Account, Address, Keypair, Networks, Operation, TransactionBuilder, authorizeInvocation, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { chainFrom, confirmingChain, type ChainTransfer } from "./chain-double.test-support.js";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createHttpApp } from "./http.js";
import { captureLogs } from "./log.js";
import { computeMetrics } from "./operations.js";
import { runSettlementTick } from "./settlement-worker.js";
import { verifySettlement } from "./settlement-verification.js";
import { lookupTransactionOnHorizon } from "./stellar-horizon.js";
import { checkProtocol } from "./stellar-preflight.js";

/**
 * D1 · Liquidación sin operador. F14–F17 from the November addendum, run against the real HTTP app with
 * a scripted facilitator and doubles of the two network readers (Stellar RPC and Horizon).
 */

const merchant = Keypair.random().publicKey();
const buyer = Keypair.random();
const quoteUnits = 100_000_000n; // 10 USDC
const minute = 60_000;

async function signedPayload(expirationLedger = 1_010) {
  const args = [nativeToScVal(buyer.publicKey(), { type: "address" }), nativeToScVal(merchant, { type: "address" }), nativeToScVal(quoteUnits, { type: "i128" })];
  const invocation = new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: new Address(USDC_TESTNET_ADDRESS).toScAddress(), functionName: "transfer", args })), subInvocations: [] });
  const auth = await authorizeInvocation({ signer: buyer, validUntilLedgerSeq: expirationLedger, invocation, networkPassphrase: Networks.TESTNET });
  const tx = new TransactionBuilder(new Account(buyer.publicKey(), "0"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeContractFunction({ contract: USDC_TESTNET_ADDRESS, function: "transfer", args, auth: [auth] })).setTimeout(60).build();
  return { transaction: tx.toXDR() };
}

function quoteFixture(id: string) {
  return { id, merchantId: "micohstore", status: "quoted" as const, currencyShopify: "CLP", totalShopify: "10000.00", currencyPayment: "USDC", totalUsdc: "10.0000000", fxRate: "0.001", expiresAt: new Date(Date.now() + 10 * minute).toISOString(), shippingAddressJson: "{}", lineItemsJson: JSON.stringify([{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }]), email: "buyer@example.com", shopifyDraftOrderId: "gid://shopify/DraftOrder/1", idempotencyKey: `quote:${id}` };
}

function shopifyDouble() {
  const calls = { completeDraftOrder: 0 };
  return { calls, client: { domain: "micohstore.myshopify.com", getVariant: async () => ({ id: "gid://shopify/ProductVariant/1", inventoryQuantity: 5, inventoryPolicy: "DENY", availableForSale: true, product: {} }), completeDraftOrder: async () => { calls.completeDraftOrder += 1; return { id: "gid://shopify/Order/1", name: "#1001" }; }, attachPaymentEvidence: async () => undefined, getDraftOrder: async () => ({ order: null }) } };
}

type Settle = (response: import("node:http").ServerResponse) => void;

/** Real HTTP app + scripted facilitator + injected network readers; in-request verification retries are fast. */
async function harness(settle: Settle, transfers: ChainTransfer[], options: { latestLedger?: number; horizon?: Parameters<typeof chainFrom>[3] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "setareh-d1-"));
  const facilitator = createServer((request, response) => {
    if (request.url === "/supported") { response.setHeader("Content-Type", "application/json"); return response.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: {} })); }
    if (request.url === "/settle") return settle(response);
    response.statusCode = 404; response.end();
  });
  await new Promise<void>((resolve) => facilitator.listen(0, "127.0.0.1", resolve));
  const facilitatorAddress = facilitator.address();
  assert.ok(facilitatorAddress && typeof facilitatorAddress !== "string");
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  const shopify = shopifyDouble();
  const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantName: "Micohstore", agentAuth: "off", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: merchant, facilitatorUrl: `http://127.0.0.1:${facilitatorAddress.port}`, maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001, verification: { attempts: 2, delayMs: 10 } };
  const chain = chainFrom(transfers, options.latestLedger ?? 1_020, 1, options.horizon);
  const service = new CommerceService(config, database, shopify.client as any, chain);
  const quote = database.createQuote(quoteFixture("1f7c2d4e-9a31-4b8e-a6f2-0c5d7e8f9a10"));
  const appServer = createHttpApp(service).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.on("listening", resolve));
  const appAddress = appServer.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  const base = `http://127.0.0.1:${appAddress.port}`;
  const endpoint = `${base}/v1/quotes/${quote.id}/pay-and-place`;
  const unpaid = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userConfirmed: true }) });
  const challenge = JSON.parse(Buffer.from(String(unpaid.headers.get("payment-required")), "base64url").toString("utf8"));
  const header = Buffer.from(JSON.stringify({ x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: await signedPayload() })).toString("base64url");
  const pay = () => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": header }, body: JSON.stringify({ userConfirmed: true }) });
  const status = async () => (await fetch(`${base}/v1/orders/${quote.id}`)).json() as Promise<{ status: string; order: unknown; payment: { transactionHash?: string; verification?: { verdict: string; verifiedAt: string | null } } | null }>;
  const tick = (now: Date) => runSettlementTick({ db: database, commerce: service, options: { maxUnknownMs: 5 * minute, maxVerificationMs: 5 * minute } }, now);
  return {
    database, service, quote, shopify, pay, status, tick,
    close: async () => {
      await new Promise<void>((resolve) => appServer.close(() => resolve()));
      await new Promise<void>((resolve) => facilitator.close(() => resolve()));
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const onChain = (hash: string, ledger = 1_002, amount = quoteUnits): ChainTransfer => ({ hash, ledger, from: buyer.publicKey(), to: merchant, amount });
const settledResponse = (hash: string, network = "stellar:testnet"): Settle => (response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ success: true, payer: buyer.publicKey(), transaction: hash, network, amount: quoteUnits.toString() })); };

test("F14: the facilitator settles on-chain but answers 504; the worker completes the order from the network alone, within the deadline", async () => {
  const hash = "f1".repeat(32);
  const lines: string[] = [];
  const restore = captureLogs((line) => lines.push(line));
  const run = await harness((response) => { response.statusCode = 504; response.end("<html>Gateway Timeout</html>"); }, [onChain(hash)]);
  try {
    assert.notEqual((await run.pay()).status, 200);
    assert.equal((await run.status()).status, "payment_unknown");
    assert.equal(run.shopify.calls.completeDraftOrder, 0);

    const t0 = Date.now();
    const report = await run.tick(new Date(t0 + 30_000));
    assert.deepEqual(report.actions.map((action) => action.action), ["reconciled:event_search", "verified", "order_placed"]);
    const after = await run.status();
    assert.equal(after.status, "created");
    assert.equal(after.payment?.transactionHash, hash);
    assert.equal(after.payment?.verification?.verdict, "verified");
    assert.ok(after.payment?.verification?.verifiedAt);
    assert.equal(run.shopify.calls.completeDraftOrder, 1);
    assert.deepEqual(run.database.getQuoteEvents(run.quote.id).map((event) => event.to), ["quoted", "payment_required", "payment_submitted", "payment_unknown", "payment_settled", "creating_shopify_order", "created"]);

    // A retry after the automatic completion is refused before anything is signed, like any paid quote.
    assert.equal((await run.pay()).status, 409);
    assert.equal(run.shopify.calls.completeDraftOrder, 1);

    // The redacted log tells the whole story under the worker's correlation ID and carries no buyer data.
    const worker = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.event === "settlement.worker");
    assert.deepEqual(worker.map((entry) => entry.action), ["reconciled:event_search", "verified", "order_placed"]);
    assert.ok(worker.every((entry) => typeof entry.correlationId === "string" && String(entry.correlationId).startsWith("worker-")));
    assert.ok(!lines.some((line) => line.includes("buyer@example.com")));
    const metrics = computeMetrics(run.database);
    assert.deepEqual(metrics.reconciliation, { unknownResolved: 1, unknownEscalated: 0, settledHeld: 0 });
    assert.deepEqual(metrics.verification, { verified: 1, unverified: 0 });
  } finally { restore(); await run.close(); }
});

test("F14b: a payment_unknown quote whose authorization expired with no transfer is closed as payment_failed, and a stuck one past the deadline is escalated", async () => {
  const run = await harness((response) => { response.statusCode = 502; response.end("Bad gateway"); }, [], { latestLedger: 1_005 });
  try {
    assert.notEqual((await run.pay()).status, 200);
    const t0 = Date.now();
    // Still inside the signature's validity: nothing found, wait.
    assert.deepEqual((await run.tick(new Date(t0 + 30_000))).actions.map((action) => action.action.split(":")[0]), ["waiting"]);
    assert.equal((await run.status()).status, "payment_unknown");
    // Past the five-minute deadline with the authorization still valid: a person decides, never a guess.
    assert.deepEqual((await run.tick(new Date(t0 + 6 * minute))).actions.map((action) => action.action), ["escalated:pending_past_deadline"]);
    assert.equal((await run.status()).status, "manual_review");
    assert.equal(run.shopify.calls.completeDraftOrder, 0);
  } finally { await run.close(); }

  const expired = await harness((response) => { response.statusCode = 502; response.end("Bad gateway"); }, [], { latestLedger: 1_050 });
  try {
    assert.notEqual((await expired.pay()).status, 200);
    assert.deepEqual((await expired.tick(new Date(Date.now() + 30_000))).actions.map((action) => action.action), ["reconciled:authorization_expired"]);
    assert.equal((await expired.status()).status, "payment_failed");
    assert.equal(expired.shopify.calls.completeDraftOrder, 0);
  } finally { await expired.close(); }
});

test("F15: the facilitator answers OK with a hash the network never shows; no order is created and the quote is held after the deadline", async () => {
  const hash = "f5".repeat(32);
  const run = await harness(settledResponse(hash), []);
  try {
    const paid = await run.pay();
    assert.equal(paid.status, 202);
    const body = await paid.json() as { status: string; pending: string };
    assert.equal(body.pending, "verification");
    assert.equal(body.status, "payment_settled");
    assert.equal(run.shopify.calls.completeDraftOrder, 0);
    assert.equal((await run.status()).payment?.verification?.verdict, "pending");

    const t0 = Date.now();
    assert.deepEqual((await run.tick(new Date(t0 + 30_000))).actions.map((action) => action.action), ["waiting:rpc:not_found,horizon:not_found"]);
    assert.equal((await run.status()).status, "payment_settled");
    assert.deepEqual((await run.tick(new Date(t0 + 6 * minute))).actions.map((action) => action.action), ["escalated:unverified_past_deadline"]);
    assert.equal((await run.status()).status, "manual_review");
    assert.equal(run.shopify.calls.completeDraftOrder, 0);
    assert.equal((await run.pay()).status, 409);
  } finally { await run.close(); }
});

test("F15b: a hash that only one reader sees never completes the order until both agree", async () => {
  const hash = "f6".repeat(32);
  // Horizon lags: it has no record yet while the RPC already sees the transfer.
  const run = await harness(settledResponse(hash), [onChain(hash)], { horizon: { horizon: { transaction: async () => undefined } } });
  try {
    assert.equal((await run.pay()).status, 202);
    assert.equal(run.shopify.calls.completeDraftOrder, 0);
    const after = await run.status();
    assert.equal(after.status, "payment_settled");
    assert.equal(after.payment?.verification?.verdict, "pending");
  } finally { await run.close(); }
});

test("F16: a hash from another network is refused on the spot: no payment is recorded and the quote goes to manual review", async () => {
  const hash = "f7".repeat(32);
  const run = await harness(settledResponse(hash, "stellar:pubnet"), [onChain(hash)]);
  try {
    const paid = await run.pay();
    assert.equal(paid.status, 409);
    const status = await run.status();
    assert.equal(status.status, "manual_review");
    assert.equal(status.payment, null);
    assert.equal(run.database.getLatestPaymentAttempt(run.quote.id)?.errorReason, "network_mismatch:stellar:pubnet");
    assert.equal(run.shopify.calls.completeDraftOrder, 0);
    assert.deepEqual((await run.tick(new Date(Date.now() + 30_000))).actions, [], "nothing is left for the worker to touch");
  } finally { await run.close(); }
});

test("F17: a hash whose transfer carries another amount is contradicted by both readers; the quote is held immediately", async () => {
  const hash = "f8".repeat(32);
  const run = await harness(settledResponse(hash), [onChain(hash, 1_002, quoteUnits - 1n)]);
  try {
    const paid = await run.pay();
    assert.equal(paid.status, 409);
    const status = await run.status();
    assert.equal(status.status, "manual_review");
    assert.equal(status.payment?.transactionHash, hash);
    assert.equal(status.payment?.verification?.verdict, "disagree");
    assert.equal(run.shopify.calls.completeDraftOrder, 0);
    assert.equal(computeMetrics(run.database).reconciliation.settledHeld, 1);
    assert.deepEqual((await run.tick(new Date(Date.now() + 30_000))).actions, []);
  } finally { await run.close(); }
});

test("the happy path verifies on both readers inside the request and creates the order", async () => {
  const hash = "f9".repeat(32);
  const run = await harness(settledResponse(hash), [onChain(hash)]);
  try {
    const paid = await run.pay();
    assert.equal(paid.status, 200);
    const status = await run.status();
    assert.equal(status.status, "created");
    assert.equal(status.payment?.verification?.verdict, "verified");
    assert.equal(run.shopify.calls.completeDraftOrder, 1);
  } finally { await run.close(); }
});

test("verifySettlement: verified only when RPC and Horizon agree; a contradiction wins over a missing record; errors are pending", async () => {
  const hash = "ab".repeat(32);
  const expected = { asset: USDC_TESTNET_ADDRESS, payTo: merchant, amount: quoteUnits };
  const agree = await verifySettlement(chainFrom([onChain(hash)]), hash, expected);
  assert.equal(agree.verdict, "verified");
  assert.equal((await verifySettlement(chainFrom([onChain(hash, 1_002)], 1_020, 1, { horizon: { transaction: async () => ({ successful: true, ledger: 1_003, createdAt: "" }) } }), hash, expected)).verdict, "disagree");
  assert.equal((await verifySettlement(chainFrom([{ ...onChain(hash), succeeded: false }]), hash, expected)).verdict, "disagree");
  const failing = await verifySettlement(chainFrom([onChain(hash)], 1_020, 1, { horizon: { transaction: async () => { throw new Error("503"); } } }), hash, expected);
  assert.equal(failing.verdict, "pending");
  assert.match(failing.reason, /horizon:unavailable/);
  const mismatchOnHorizon = await verifySettlement(chainFrom([onChain(hash)], 1_020, 1, { horizon: { balanceChanges: async () => [] } }), hash, expected);
  assert.equal(mismatchOnHorizon.verdict, "disagree");
  assert.equal(mismatchOnHorizon.reason, "transfer_mismatch");
});

test("Horizon lookup matches the asset by its contract address and the amount in units", async () => {
  const hash = "cd".repeat(32);
  const chain = chainFrom([onChain(hash)]);
  assert.deepEqual(await lookupTransactionOnHorizon(chain.horizon, hash, { asset: USDC_TESTNET_ADDRESS, payTo: merchant, amount: quoteUnits }), { found: true, transactionHash: hash, ledger: 1_002 });
  assert.deepEqual(await lookupTransactionOnHorizon(chain.horizon, hash, { asset: USDC_TESTNET_ADDRESS, payTo: merchant, amount: quoteUnits + 1n }), { found: false, reason: "mismatch" });
  assert.deepEqual(await lookupTransactionOnHorizon(chain.horizon, hash, { asset: USDC_TESTNET_ADDRESS, payTo: Keypair.random().publicKey(), amount: quoteUnits }), { found: false, reason: "mismatch" });
  assert.deepEqual(await lookupTransactionOnHorizon(chain.horizon, "ef".repeat(32), { asset: USDC_TESTNET_ADDRESS, payTo: merchant, amount: quoteUnits }), { found: false, reason: "not_found" });
});

test("protocol preflight reports both readers and flags a network newer than the tested version", async () => {
  const same = await checkProtocol(chainFrom([], 1_020, 1, { protocolVersion: 30 }));
  assert.equal(same.supported, true);
  assert.deepEqual([same.rpc.protocolVersion, same.horizon.protocolVersion], [30, 30]);
  const newer = await checkProtocol(chainFrom([], 1_020, 1, { protocolVersion: 31 }));
  assert.equal(newer.supported, false);
  const broken = await checkProtocol({ rpc: { getNetwork: async () => { throw new Error("down"); } }, horizon: { protocolVersion: async () => 30 } });
  assert.equal(broken.rpc.error, "down");
  assert.equal(broken.supported, true, "a reader that is down is reported, not treated as a newer protocol");
});

test("the worker resumes interrupted settlements and orders, and purges personal data on its schedule", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-worker-"));
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  try {
    const shopify = shopifyDouble();
    const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantName: "Micohstore", agentAuth: "off", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: merchant, facilitatorUrl: "https://facilitator.invalid", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
    const service = new CommerceService(config, database, shopify.client as any, confirmingChain(merchant, quoteUnits));
    const deps = { db: database, commerce: service, options: { maxUnknownMs: 5 * minute, maxVerificationMs: 5 * minute, retention: { expiredAfterDays: 30, orderedAfterDays: 90, everyMs: 24 * 60 * minute } } };

    // A settlement the process died in the middle of: after the stuck threshold it becomes payment_unknown.
    database.createQuote(quoteFixture("interrupted"));
    service.getPayableQuote("interrupted");
    service.markPaymentSubmitted("interrupted", undefined);
    // A verified settlement whose order attempt never happened (e.g. a restart right after settling).
    database.createQuote(quoteFixture("settled"));
    database.recordPaymentSettled({ quoteId: "settled", network: "stellar:testnet", asset: "USDC", amount: "10.0000000", payTo: merchant, paymentPayloadHash: "p", transactionHash: "ab".repeat(32), receipt: {} });
    // An old unpaid quote whose personal data is due for purge.
    database.createQuote({ ...quoteFixture("old"), status: "expired", expiresAt: new Date(Date.now() - 40 * 24 * 60 * minute).toISOString() });

    const fresh = await runSettlementTick(deps, new Date(), {});
    assert.deepEqual(fresh.actions.map((action) => [action.quoteId, action.action]), [["settled", "verified"], ["settled", "order_placed"]]);
    assert.equal(fresh.purged, 1);
    assert.equal(database.getQuote("old")?.email, "");
    assert.equal(database.getQuote("interrupted")?.status, "payment_submitted", "a fresh in-flight settlement is left alone");

    const state = { lastPurgeAt: Date.now() };
    const later = await runSettlementTick(deps, new Date(Date.now() + 6 * minute), state);
    assert.deepEqual(later.actions.map((action) => [action.quoteId, action.action]), [["interrupted", "interrupted_settlement"]]);
    assert.equal(later.purged, undefined, "purge runs once per period");
    assert.equal(database.getQuote("interrupted")?.status, "payment_unknown");
    assert.equal(database.getLatestPaymentAttempt("interrupted")?.outcome, "unknown");
    assert.equal(shopify.calls.completeDraftOrder, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
