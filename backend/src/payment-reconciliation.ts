import type { PaymentAttemptRecord, QuoteRecord } from "./db.js";
import { lookupTransaction, searchTransfers, usdcUnits, type ExpectedSettlement, type SettlementRpc } from "./stellar-settlement.js";

/** Stellar closes a ledger roughly every five seconds; used only to bound the event search window. */
const LEDGER_SECONDS = 5;
/** Extra ledgers searched before the failed attempt, to absorb clock skew and settlement latency. */
const SEARCH_MARGIN_LEDGERS = 120;

export type ReconciliationVerdict =
  | { verdict: "paid"; transactionHash: string; ledger: number; source: "facilitator_transaction" | "operator_transaction" | "event_search" }
  | { verdict: "unpaid"; reason: "authorization_expired"; expiredAtLedger: number; latestLedger: number }
  | { verdict: "pending"; reason: string; retryAfterLedger?: number; latestLedger: number }
  | { verdict: "ambiguous"; candidates: Array<{ transactionHash: string; ledger: number }> }
  | { verdict: "needs_operator"; reason: string };

export type ReconciliationInput = {
  quote: QuoteRecord;
  attempt: PaymentAttemptRecord;
  asset: string;
  payTo: string;
  /** A hash the operator found independently (for example in a block explorer). */
  operatorTransaction?: string;
  /** True when another quote already owns this transaction; one transfer settles one quote. */
  claimedElsewhere: (transactionHash: string) => boolean;
  now?: Date;
};

/**
 * Decides, from the network alone, whether a payment_unknown quote was paid. It never guesses:
 * "unpaid" requires the buyer's signed authorization to have expired with no matching transfer, and
 * more than one matching transfer is reported as ambiguous for an operator to resolve.
 */
export async function reconcileUnknownPayment(server: SettlementRpc, input: ReconciliationInput): Promise<ReconciliationVerdict> {
  const { quote, attempt } = input;
  const amount = usdcUnits(quote.totalUsdc);
  if (attempt.amount !== null && BigInt(attempt.amount) !== amount) return { verdict: "needs_operator", reason: "The signed authorization amount differs from the quote." };
  if (attempt.payTo !== null && attempt.payTo !== input.payTo) return { verdict: "needs_operator", reason: "The signed authorization pays a different account." };
  const expected: ExpectedSettlement = { asset: input.asset, payTo: input.payTo, amount, payer: attempt.payer ?? undefined };

  const hash = input.operatorTransaction ?? attempt.facilitatorTransaction ?? undefined;
  if (hash) {
    if (input.claimedElsewhere(hash)) return { verdict: "needs_operator", reason: `Transaction ${hash} already settles another quote.` };
    const lookup = await lookupTransaction(server, hash, expected);
    if (lookup.found) return { verdict: "paid", transactionHash: hash, ledger: lookup.ledger, source: input.operatorTransaction ? "operator_transaction" : "facilitator_transaction" };
    if (lookup.reason === "mismatch") return { verdict: "needs_operator", reason: `Transaction ${hash} does not transfer the quoted amount to the merchant.` };
    if (input.operatorTransaction) return { verdict: "needs_operator", reason: `Transaction ${hash} is ${lookup.reason === "not_found" ? "not visible to the RPC" : "a failed transaction"}.` };
    // A failed or not-yet-visible facilitator transaction does not consume the authorization; keep searching.
  }

  if (!expected.payer) return { verdict: "needs_operator", reason: "The payer could not be read from the signed payload; pass --tx with the transaction hash." };
  const health = await server.getHealth();
  const now = input.now ?? new Date();
  const elapsedLedgers = Math.ceil((now.getTime() - new Date(attempt.createdAt).getTime()) / 1000 / LEDGER_SECONDS);
  const fromLedger = health.latestLedger - elapsedLedgers - SEARCH_MARGIN_LEDGERS;
  if (fromLedger < health.oldestLedger) return { verdict: "needs_operator", reason: `The attempt is older than the RPC event retention (oldest ledger ${health.oldestLedger}); find the transaction and pass --tx.` };
  const expiration = attempt.signatureExpirationLedger;
  const toLedger = expiration === null ? health.latestLedger : Math.min(expiration, health.latestLedger);

  const candidates = (await searchTransfers(server, { ...expected, payer: expected.payer }, fromLedger, toLedger))
    .filter((candidate) => !input.claimedElsewhere(candidate.transactionHash));
  if (candidates.length === 1) return { verdict: "paid", ...candidates[0], source: "event_search" };
  if (candidates.length > 1) return { verdict: "ambiguous", candidates };

  if (expiration !== null && health.latestLedger > expiration) return { verdict: "unpaid", reason: "authorization_expired", expiredAtLedger: expiration, latestLedger: health.latestLedger };
  return expiration === null
    ? { verdict: "pending", reason: "No transfer found and the authorization expiry is unknown; pass --tx once found, or review manually.", latestLedger: health.latestLedger }
    : { verdict: "pending", reason: "No transfer found yet, but the signed authorization can still be submitted.", retryAfterLedger: expiration + 1, latestLedger: health.latestLedger };
}
