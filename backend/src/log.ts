import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Structured, redacted logging. One JSON object per line on stderr (stdout carries the MCP stdio
 * protocol). Only fields listed in ALLOWED_FIELDS are written and every string value is scrubbed, so
 * a log line can be shared for diagnosis without exposing buyer data, keys or signed payments.
 */

type Level = "info" | "warn" | "error";
type Context = { correlationId: string };

const context = new AsyncLocalStorage<Context>();

/** Accepts caller-supplied request IDs only when they are short, opaque tokens. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function correlationIdFrom(header: unknown): string {
  return typeof header === "string" && REQUEST_ID.test(header) ? header : randomUUID();
}

export function withCorrelation<T>(correlationId: string, run: () => T): T {
  return context.run({ correlationId }, run);
}

export function currentCorrelationId(): string | undefined {
  return context.getStore()?.correlationId;
}

/** Operational fields that never carry personal data or secrets. Anything else is dropped. */
const ALLOWED_FIELDS = new Set([
  "quoteId", "orderId", "shopifyOrderName", "from", "to", "status", "outcome", "verdict", "reason", "errorCode", "message",
  "transactionHash", "network", "amount", "method", "route", "httpStatus", "durationMs", "operation", "attempt",
  "tool", "shop", "action", "transport", "url", "authMode", "oauthRoutes",
]);

const SCRUBBERS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // Stellar secret seeds (S…, 56 chars) and Shopify access/refresh tokens.
  [/\bS[A-Z2-7]{55}\b/g, "[stellar-secret]"],
  [/\bshp(?:at|rt|ca|pa|ss)_[A-Za-z0-9]+/g, "[shopify-token]"],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[credential]"],
  // Signed payments, XDR envelopes and other long encoded blobs.
  [/[A-Za-z0-9+/_-]{120,}={0,2}/g, "[blob]"],
];

const MAX_STRING = 300;

export function scrub(value: string): string {
  let result = value;
  for (const [pattern, replacement] of SCRUBBERS) result = result.replace(pattern, replacement);
  return result.length > MAX_STRING ? `${result.slice(0, MAX_STRING)}…` : result;
}

function clean(value: unknown): unknown {
  if (typeof value === "string") return scrub(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "bigint") return value.toString();
  return undefined;
}

type Sink = (line: string) => void;
let sink: Sink = (line) => process.stderr.write(`${line}\n`);

/** Test hook: capture log lines instead of writing them to stderr. Returns a restore function. */
export function captureLogs(collect: Sink): () => void {
  const previous = sink;
  sink = collect;
  return () => { sink = previous; };
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, event };
  const correlationId = currentCorrelationId();
  if (correlationId) entry.correlationId = correlationId;
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    const cleaned = clean(value);
    if (cleaned !== undefined) entry[key] = cleaned;
  }
  sink(JSON.stringify(entry));
}

/** Reduces an unknown error to a scrubbed message; never logs stacks or attached payloads. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
}
