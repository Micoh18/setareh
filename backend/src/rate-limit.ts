/** Where a limiter keeps its hits. The database implements it so limits survive a restart; without one they live in memory. */
export type RateHitStore = { allowRateHit(bucket: string, limit: number, windowMs: number, at?: number): boolean };

/**
 * Sliding window limiter. Given a store (the service database) its counts are persistent and shared by
 * everything that opens that database; without one it keeps them in memory, which is enough for a
 * single test or script but resets on every restart.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(readonly limit: number, readonly windowMs: number, private readonly store?: RateHitStore, private readonly namespace = "") {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer.");
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("Rate limit window must be positive.");
  }

  /** Records the attempt when allowed and returns false once the key reached its limit inside the window. */
  allow(key: string, at = Date.now()) {
    if (this.store) return this.store.allowRateHit(`${this.namespace}:${key}`, this.limit, this.windowMs, at);
    const since = at - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > since);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(at);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(since);
    return true;
  }

  private prune(since: number) {
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((timestamp) => timestamp > since);
      if (recent.length) this.hits.set(key, recent); else this.hits.delete(key);
    }
  }
}

export type QuoteRateLimits = { perClientPerHour: number; globalPerHour: number };

export const DEFAULT_QUOTE_RATE_LIMITS: QuoteRateLimits = { perClientPerHour: 10, globalPerHour: 60 };

/** The Fly proxy sets Fly-Client-IP; local runs fall back to the socket address. */
export function clientKey(request: { get(name: string): string | undefined; ip?: string }) {
  return request.get("fly-client-ip")?.trim() || request.ip || "unknown";
}
