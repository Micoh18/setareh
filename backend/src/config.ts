import { resolve } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import { DEFAULT_TESTNET_HORIZON_URL, DEFAULT_TESTNET_RPC_URL } from "@x402/stellar";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function decimal(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (!raw && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function nonNegativeDecimal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number.`);
  return value;
}

/**
 * `merchantName`, `stellarMerchantAddress`, `maxQuoteUsdc` and `maxDayUsdc` describe the one store this
 * instance can define from its environment (SHOPIFY_STORE_DOMAIN). Stores that install through OAuth
 * bring their own payout address and caps from their setup page and never read these values.
 */
export type SetarehConfig = {
  databasePath: string;
  merchantName: string;
  shopifyCredentialsRef?: string;
  stellarNetwork: "stellar:testnet";
  stellarAsset: string;
  stellarMerchantAddress: string;
  facilitatorUrl: string;
  baseUrl?: string;
  /** Per-order USDC cap of the environment store. */
  maxQuoteUsdc: number;
  /** Per-day (UTC) USDC cap of the environment store; five times the per-order cap when unset. */
  maxDayUsdc?: number;
  /** "required": every /v1 route needs an agent key. "off" is for local development and tests only. */
  agentAuth?: "required" | "off";
  /** Wrong or missing keys tolerated per client address and hour before answering 429. */
  authFailuresPerHour?: number;
  quoteTtlMinutes: number;
  usdcPerClp: number;
  fxSource?: string;
  shippingFlatClp?: number;
  shippingTitle?: string;
  port?: number;
  httpHost?: string;
  quoteRateLimits?: { perClientPerHour: number; globalPerHour: number };
  /** Independent readers of the network used to verify every settlement before an order is created. */
  stellarRpcUrl?: string;
  stellarHorizonUrl?: string;
  /** In-request verification: how many times to re-read the network before answering 202 and leaving it to the worker. */
  verification?: { attempts: number; delayMs: number };
  /** Background settlement worker: reconciles payment_unknown, verifies payment_settled, resumes interrupted orders, purges. */
  settlementWorker?: { enabled: boolean; intervalMs: number; maxUnknownMs: number; maxVerificationMs: number };
  retention?: { auto: boolean; expiredAfterDays: number; orderedAfterDays: number; everyMs: number };
};

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function agentAuthMode(): "required" | "off" {
  const value = (process.env.SETAREH_AGENT_AUTH ?? "required").trim().toLowerCase();
  if (value !== "required" && value !== "off") throw new Error("SETAREH_AGENT_AUTH must be required or off.");
  return value;
}

export function loadConfig(): SetarehConfig {
  const network = process.env.STELLAR_NETWORK ?? "stellar:testnet";
  if (network !== "stellar:testnet") {
    throw new Error("Only stellar:testnet is supported by the hackathon payment flow.");
  }

  const stellarAsset = process.env.STELLAR_PAYMENT_ASSET ?? "USDC";
  if (stellarAsset !== "USDC") throw new Error("Only USDC is supported by the hackathon payment flow.");
  const stellarMerchantAddress = required("STELLAR_MERCHANT_ADDRESS");
  if (!StrKey.isValidEd25519PublicKey(stellarMerchantAddress)) {
    throw new Error("STELLAR_MERCHANT_ADDRESS must be a valid Stellar public account address.");
  }
  const baseUrl = process.env.SETAREH_BASE_URL?.trim();
  if (baseUrl) {
    try { new URL(baseUrl); } catch { throw new Error("SETAREH_BASE_URL must be an absolute URL."); }
  }
  const port = process.env.PORT ? Number(process.env.PORT) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return {
    databasePath: resolve(process.cwd(), process.env.SETAREH_DATABASE_PATH ?? "setareh.db"),
    merchantName: process.env.SETAREH_MERCHANT_NAME ?? "Micohstore",
    shopifyCredentialsRef: process.env.SHOPIFY_CREDENTIALS_REF ?? "env:SHOPIFY_CLIENT_ID",
    stellarNetwork: network,
    stellarAsset,
    stellarMerchantAddress,
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    baseUrl,
    maxQuoteUsdc: decimal("SETAREH_MAX_QUOTE_USDC", 30),
    maxDayUsdc: process.env.SETAREH_MAX_DAY_USDC ? decimal("SETAREH_MAX_DAY_USDC") : undefined,
    agentAuth: agentAuthMode(),
    authFailuresPerHour: positiveInteger("SETAREH_AUTH_FAILURES_PER_HOUR", 30),
    quoteTtlMinutes: decimal("QUOTE_TTL_MINUTES", 10),
    usdcPerClp: decimal("SETAREH_USDC_PER_CLP"),
    fxSource: process.env.SETAREH_FX_SOURCE ?? "configured_demo_rate",
    shippingFlatClp: nonNegativeDecimal("SETAREH_FLAT_SHIPPING_CLP", 0),
    shippingTitle: process.env.SETAREH_SHIPPING_TITLE ?? "Despacho Setareh",
    port,
    httpHost: process.env.SETAREH_HTTP_HOST ?? "127.0.0.1",
    quoteRateLimits: { perClientPerHour: positiveInteger("SETAREH_QUOTES_PER_CLIENT_PER_HOUR", 10), globalPerHour: positiveInteger("SETAREH_QUOTES_PER_HOUR", 60) },
    stellarRpcUrl: process.env.STELLAR_RPC_URL?.trim() || DEFAULT_TESTNET_RPC_URL,
    stellarHorizonUrl: process.env.STELLAR_HORIZON_URL?.trim() || DEFAULT_TESTNET_HORIZON_URL,
    verification: { attempts: positiveInteger("SETAREH_VERIFY_ATTEMPTS", 4), delayMs: positiveInteger("SETAREH_VERIFY_DELAY_MS", 2_000) },
    settlementWorker: {
      enabled: (process.env.SETAREH_SETTLEMENT_WORKER ?? "on") !== "off",
      intervalMs: positiveInteger("SETAREH_SETTLEMENT_WORKER_INTERVAL_MS", 30_000),
      // The addendum commits to a decision on every payment_unknown quote within five minutes, with no operator.
      maxUnknownMs: positiveInteger("SETAREH_SETTLEMENT_MAX_UNKNOWN_MS", 5 * 60_000),
      maxVerificationMs: positiveInteger("SETAREH_SETTLEMENT_MAX_VERIFICATION_MS", 5 * 60_000),
    },
    retention: { auto: (process.env.SETAREH_RETENTION_AUTO ?? "on") !== "off", expiredAfterDays: positiveInteger("SETAREH_RETENTION_EXPIRED_DAYS", 30), orderedAfterDays: positiveInteger("SETAREH_RETENTION_ORDERED_DAYS", 90), everyMs: positiveInteger("SETAREH_RETENTION_EVERY_MS", 24 * 60 * 60_000) },
  };
}
