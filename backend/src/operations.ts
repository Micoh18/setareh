import type { QuoteStatus, SetarehDatabase } from "./db.js";

/** A quote should leave an intermediate status within the facilitator's 60 s settle window plus Shopify's deadline. */
export const STUCK_AFTER_MS = 5 * 60_000;

export type StuckQuote = { quoteId: string; status: QuoteStatus; since: string; ageMinutes: number; action: string };

const STUCK_ACTIONS: Record<string, string> = {
  payment_submitted: "The process was interrupted during settlement. --apply moves it to payment_unknown; then run reconcile:payment.",
  payment_settled: "Paid but no order attempt is in progress. --apply places the order again through the idempotent path.",
  creating_shopify_order: "An order attempt was interrupted. --apply adopts the Shopify order if the draft completed, otherwise retries once.",
};

export function findStuckQuotes(db: SetarehDatabase, now = new Date()): StuckQuote[] {
  const threshold = new Date(now.getTime() - STUCK_AFTER_MS).toISOString();
  return db.listStuckQuotes(threshold).map((row) => ({ ...row, ageMinutes: Math.round((now.getTime() - new Date(row.since).getTime()) / 60_000), action: STUCK_ACTIONS[row.status] ?? "" }));
}
