import { resolve } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";

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

export type SetarehConfig = {
  databasePath: string;
  merchantId: string;
  merchantName: string;
  shopifyCredentialsRef?: string;
  stellarNetwork: "stellar:testnet";
  stellarAsset: string;
  stellarMerchantAddress: string;
  facilitatorUrl: string;
  baseUrl?: string;
  maxQuoteUsdc: number;
  quoteTtlMinutes: number;
  usdcPerClp: number;
  fxSource?: string;
  shippingFlatClp?: number;
  shippingTitle?: string;
  port?: number;
  httpHost?: string;
};

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
    merchantId: process.env.SETAREH_MERCHANT_ID ?? "micohstore",
    merchantName: process.env.SETAREH_MERCHANT_NAME ?? "Micohstore",
    shopifyCredentialsRef: process.env.SHOPIFY_CREDENTIALS_REF ?? "env:SHOPIFY_CLIENT_ID",
    stellarNetwork: network,
    stellarAsset,
    stellarMerchantAddress,
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    baseUrl,
    maxQuoteUsdc: decimal("SETAREH_MAX_QUOTE_USDC", 30),
    quoteTtlMinutes: decimal("QUOTE_TTL_MINUTES", 10),
    usdcPerClp: decimal("SETAREH_USDC_PER_CLP"),
    fxSource: process.env.SETAREH_FX_SOURCE ?? "configured_demo_rate",
    shippingFlatClp: nonNegativeDecimal("SETAREH_FLAT_SHIPPING_CLP", 0),
    shippingTitle: process.env.SETAREH_SHIPPING_TITLE ?? "Despacho Setareh",
    port,
    httpHost: process.env.SETAREH_HTTP_HOST ?? "127.0.0.1",
  };
}
