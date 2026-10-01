import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { ShopifyClient } from "./shopify.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const required = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "STELLAR_MERCHANT_ADDRESS", "SETAREH_USDC_PER_CLP"];
const missing = required.filter((name) => !process.env[name]?.trim());

async function main() {
  if (missing.length) {
    process.stdout.write(`${JSON.stringify({ ok: false, missing, message: "Complete backend/.env before the demo. Values are intentionally not displayed." }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

    const config = loadConfig();
  const report: Record<string, unknown> = {
    ok: true,
    merchant: config.merchantId,
    network: config.stellarNetwork,
    paymentAsset: config.stellarAsset,
    merchantAddressConfigured: true,
    quoteMaxUsdc: config.maxQuoteUsdc,
    quoteTtlMinutes: config.quoteTtlMinutes,
    agentEnvironmentFilePresent: existsSync(resolve(process.cwd(), "agent.env")),
    verifyMode: process.argv.includes("--verify"),
  };
  if (process.argv.includes("--verify")) {
    const shopify = ShopifyClient.fromEnvironment();
    const variants = await shopify.searchVariants("", 1);
    const requiredScopes = ["read_products", "read_inventory", "write_draft_orders", "read_orders", "write_orders"];
    const grantedScopes = await shopify.getAccessScopes();
    const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
    if (missingScopes.length) throw new Error(`Shopify app is missing required scopes: ${missingScopes.join(", ")}. Update and reinstall the app before accepting payments.`);
    const facilitatorUrl = new URL(config.facilitatorUrl.endsWith("/") ? "supported" : `${config.facilitatorUrl}/supported`);
    const facilitator = await fetch(facilitatorUrl, { headers: { Accept: "application/json" } });
    if (!facilitator.ok) throw new Error(`Facilitator support check failed (${facilitator.status}).`);
    const capabilities = await facilitator.json() as { kinds?: Array<{ network?: string; scheme?: string }> };
    const supportsStellarTestnet = capabilities.kinds?.some((kind) => kind.network === "stellar:testnet" && kind.scheme === "exact") ?? false;
    if (!supportsStellarTestnet) throw new Error("Facilitator does not advertise exact settlement for stellar:testnet.");
    report.shopify = { connected: true, sampleVariants: variants.length, requiredScopesVerified: true };
    report.facilitator = { connected: true, stellarTestnetExact: true };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Preflight check failed.";
  process.stdout.write(`${JSON.stringify({ ok: false, message }, null, 2)}\n`);
  process.exitCode = 1;
});
