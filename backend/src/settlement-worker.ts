import { randomUUID } from "node:crypto";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import type { CommerceService } from "./commerce.js";
import type { QuoteStatus, SetarehDatabase } from "./db.js";
import { errorMessage, log, withCorrelation } from "./log.js";
import { STUCK_AFTER_MS } from "./operations.js";
import { reconcileUnknownPayment } from "./payment-reconciliation.js";

/**
 * The settlement worker is what makes "liquidación sin operador" true: every quote that is waiting on
 * the network is re-read periodically and moved to a final state within a bounded time. It never
 * guesses. A payment is completed only when Stellar RPC and Horizon both confirm it; anything the
 * network contradicts, or cannot settle within the deadline, goes to manual_review with its evidence.
 *
 * Per tick, oldest first:
 *   payment_submitted  older than the stuck threshold  -> payment_unknown (the process died mid-settlement)
 *   payment_unknown    -> reconcile against the network -> paid: verify both readers and place the order;
 *                         unpaid: payment_failed; ambiguous/operator: manual_review; pending past the
 *                         deadline: manual_review
 *   payment_settled    unverified -> verify both readers -> order, or manual_review on disagreement or deadline;
 *                      verified but orderless -> place the order (idempotent)
 *   creating_shopify_order older than the stuck threshold -> adopt or retry the Shopify order
 *   once a day         -> purge personal data per the retention policy
 */

export type SettlementWorkerOptions = {
  /** A payment_unknown quote gets a decision within this time, or is escalated. */
  maxUnknownMs: number;
  /** A settled-but-unverified payment is escalated after this time without both confirmations. */
  maxVerificationMs: number;
  stuckAfterMs?: number;
  retention?: { expiredAfterDays: number; orderedAfterDays: number; everyMs: number };
};

export type SettlementWorkerDeps = { db: SetarehDatabase; commerce: CommerceService; options: SettlementWorkerOptions };

export type TickAction = { quoteId: string; from: QuoteStatus; action: string; to?: QuoteStatus; transactionHash?: string; error?: string };
export type TickReport = { at: string; actions: TickAction[]; purged?: number };

const age = (since: string, now: Date) => now.getTime() - new Date(since).getTime();

/** One pass over everything waiting on the network. Pure in its inputs: `now` is injectable for tests. */
export async function runSettlementTick(deps: SettlementWorkerDeps, now = new Date(), state: { lastPurgeAt?: number } = {}): Promise<TickReport> {
  const { db, commerce, options } = deps;
  const stuckAfterMs = options.stuckAfterMs ?? STUCK_AFTER_MS;
  const actions: TickAction[] = [];
  const record = (action: TickAction) => { actions.push(action); log(action.error ? "error" : "info", "settlement.worker", { quoteId: action.quoteId, from: action.from, to: action.to, action: action.action, transactionHash: action.transactionHash, message: action.error }); };

  for (const quote of db.listQuotesInStatuses(["payment_submitted", "payment_unknown", "payment_settled", "creating_shopify_order"])) {
    await withCorrelation(`worker-${randomUUID()}`, async () => {
      try {
        if (quote.status === "payment_submitted") {
          if (age(quote.since, now) < stuckAfterMs) return;
          commerce.markInterruptedSettlement(quote.quoteId);
          record({ quoteId: quote.quoteId, from: quote.status, to: "payment_unknown", action: "interrupted_settlement" });
          return;
        }
        if (quote.status === "payment_unknown") return reconcileUnknown(deps, quote, now, record);
        if (quote.status === "payment_settled") return verifyAndPlace(deps, quote, now, record);
        if (quote.status === "creating_shopify_order") {
          if (age(quote.since, now) < stuckAfterMs) return;
          const order = await commerce.resumeInterruptedOrder(quote.quoteId);
          record({ quoteId: quote.quoteId, from: quote.status, to: db.getQuote(quote.quoteId)?.status, action: "resumed_order", transactionHash: order.payment?.transactionHash as string | undefined });
        }
      } catch (error) {
        record({ quoteId: quote.quoteId, from: quote.status, to: db.getQuote(quote.quoteId)?.status, action: "error", error: errorMessage(error) });
      }
    });
  }

  let purged: number | undefined;
  if (options.retention && (state.lastPurgeAt === undefined || now.getTime() - state.lastPurgeAt >= options.retention.everyMs)) {
    const results = db.purgePersonalData({ expiredAfterDays: options.retention.expiredAfterDays, orderedAfterDays: options.retention.orderedAfterDays, now, apply: true });
    purged = results.length;
    state.lastPurgeAt = now.getTime();
    log("info", "retention.purged", { amount: purged, reason: `expired>${options.retention.expiredAfterDays}d,ordered>${options.retention.orderedAfterDays}d` });
  }
  return { at: now.toISOString(), actions, purged };
}

async function reconcileUnknown(deps: SettlementWorkerDeps, quote: { quoteId: string; status: QuoteStatus; since: string }, now: Date, record: (action: TickAction) => void) {
  const { db, commerce, options } = deps;
  const full = db.getQuote(quote.quoteId);
  const attempt = db.getLatestPaymentAttempt(quote.quoteId);
  const escalate = (reason: string) => {
    db.markManualReview(quote.quoteId);
    record({ quoteId: quote.quoteId, from: quote.status, to: "manual_review", action: `escalated:${reason}` });
  };
  if (!full || !attempt || attempt.outcome !== "unknown") return escalate("no_unknown_attempt");
  const verdict = await reconcileUnknownPayment(commerce.chain.rpc, {
    quote: full, attempt, asset: USDC_TESTNET_ADDRESS, payTo: commerce.config.stellarMerchantAddress, now,
    claimedElsewhere: (hash) => { const owner = db.getQuoteIdByTransaction(hash); return owner !== undefined && owner !== quote.quoteId; },
  });
  if (verdict.verdict === "paid") {
    commerce.recordReconciledSettlement(quote.quoteId, verdict.transactionHash, "settlement-worker");
    record({ quoteId: quote.quoteId, from: quote.status, to: "payment_settled", action: `reconciled:${verdict.source}`, transactionHash: verdict.transactionHash });
    return verifyAndPlace(deps, { quoteId: quote.quoteId, status: "payment_settled", since: now.toISOString() }, now, record);
  }
  if (verdict.verdict === "unpaid") {
    commerce.markReconciledUnpaid(quote.quoteId);
    return record({ quoteId: quote.quoteId, from: quote.status, to: "payment_failed", action: `reconciled:${verdict.reason}` });
  }
  if (verdict.verdict === "ambiguous" || verdict.verdict === "needs_operator") return escalate(verdict.verdict);
  // pending: the signed authorization can still land; wait, but not forever.
  if (age(quote.since, now) >= options.maxUnknownMs) return escalate("pending_past_deadline");
  record({ quoteId: quote.quoteId, from: quote.status, to: quote.status, action: `waiting:${verdict.reason.split(";")[0].slice(0, 80)}` });
}

async function verifyAndPlace(deps: SettlementWorkerDeps, quote: { quoteId: string; status: QuoteStatus; since: string }, now: Date, record: (action: TickAction) => void) {
  const { db, commerce, options } = deps;
  const payment = db.getPayment(quote.quoteId);
  if (!payment) { db.markManualReview(quote.quoteId); return record({ quoteId: quote.quoteId, from: quote.status, to: "manual_review", action: "escalated:settled_without_payment" }); }
  if (!payment.verified_at) {
    const result = await commerce.verifySettlementOnce(quote.quoteId, now);
    if (result.verdict === "disagree") return record({ quoteId: quote.quoteId, from: quote.status, to: "manual_review", action: `escalated:${result.reason}`, transactionHash: result.transactionHash });
    if (result.verdict === "pending") {
      if (age(quote.since, now) < options.maxVerificationMs) return record({ quoteId: quote.quoteId, from: quote.status, to: quote.status, action: `waiting:${result.reason}`, transactionHash: result.transactionHash });
      db.transitionQuote(quote.quoteId, "payment_settled", "manual_review");
      return record({ quoteId: quote.quoteId, from: quote.status, to: "manual_review", action: "escalated:unverified_past_deadline", transactionHash: result.transactionHash });
    }
    record({ quoteId: quote.quoteId, from: quote.status, to: quote.status, action: "verified", transactionHash: result.transactionHash });
  }
  const order = await commerce.placePaidOrder(quote.quoteId, true);
  record({ quoteId: quote.quoteId, from: quote.status, to: db.getQuote(quote.quoteId)?.status, action: "order_placed", transactionHash: order.payment?.transactionHash as string | undefined });
}

/** Runs ticks on an interval without overlap; the timer never keeps the process alive on its own. */
export function startSettlementWorker(deps: SettlementWorkerDeps, intervalMs: number) {
  const state: { lastPurgeAt?: number } = {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSettlementTick(deps, new Date(), state);
    } catch (error) {
      log("error", "settlement.worker", { action: "tick_failed", message: errorMessage(error) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  void tick();
  log("info", "settlement.worker", { action: "started", durationMs: intervalMs });
  return { stop: () => clearInterval(timer), tick };
}
