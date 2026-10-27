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

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function latency(events: Array<{ quoteId: string; to: QuoteStatus; at: string }>, from: QuoteStatus, to: QuoteStatus) {
  const starts = new Map<string, number>();
  const samples: number[] = [];
  for (const event of events) {
    if (event.to === from) starts.set(event.quoteId, new Date(event.at).getTime());
    if (event.to === to && starts.has(event.quoteId)) { samples.push(new Date(event.at).getTime() - starts.get(event.quoteId)!); starts.delete(event.quoteId); }
  }
  samples.sort((a, b) => a - b);
  return { samples: samples.length, p50Ms: percentile(samples, 50), p95Ms: percentile(samples, 95) };
}

/**
 * Quote -> payment -> order metrics derived from quote_event, so they survive restarts and need no extra
 * infrastructure. Counts are transitions (a quote that reaches a status twice counts twice), which is
 * what the operator wants to see when something loops.
 */
export function computeMetrics(db: SetarehDatabase, options: { since?: string; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const events = db.listQuoteEvents(options.since);
  const reached = (status: QuoteStatus) => new Set(events.filter((event) => event.to === status).map((event) => event.quoteId)).size;
  const quotes = reached("quoted");
  const challenged = reached("payment_required");
  const submitted = reached("payment_submitted");
  const settled = reached("payment_settled");
  const created = reached("created");
  const rate = (n: number, d: number) => (d === 0 ? null : Number((n / d).toFixed(3)));
  return {
    window: { since: options.since ?? "beginning", until: now.toISOString() },
    funnel: { quotes, challenged, submitted, settled, created, quoteToSettled: rate(settled, quotes), settledToCreated: rate(created, settled), quoteToCreated: rate(created, quotes) },
    exceptions: { expired: reached("expired"), paymentFailed: reached("payment_failed"), paymentUnknown: reached("payment_unknown"), outOfStock: reached("out_of_stock"), manualReview: reached("manual_review") },
    latency: {
      submittedToSettled: latency(events, "payment_submitted", "payment_settled"),
      settledToCreated: latency(events, "payment_settled", "created"),
      quotedToCreated: latency(events, "quoted", "created"),
    },
    currentStatuses: db.countQuotesByStatus(options.since),
    alerts: { stuck: findStuckQuotes(db, now), needsReview: db.listQuotesNeedingReview() },
  };
}
