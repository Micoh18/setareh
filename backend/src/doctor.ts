import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { CommerceService } from "./commerce.js";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { rpc } from "@stellar/stellar-sdk";
import { DEFAULT_TESTNET_HORIZON_URL, DEFAULT_TESTNET_RPC_URL } from "@x402/stellar";
import { SHOPIFY_REQUIRED_SCOPES, createShopifyRuntime, shopifyAuthMode } from "./shopify-oauth.js";
import { createRecipientChecker } from "./merchant-setup.js";
import { createHorizonClient } from "./stellar-horizon.js";
import { checkProtocol } from "./stellar-preflight.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const authMode = shopifyAuthMode();
const required = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "STELLAR_MERCHANT_ADDRESS", "SETAREH_USDC_PER_CLP", ...(authMode === "authorization_code" ? ["SETAREH_TOKEN_ENCRYPTION_KEY", "SETAREH_BASE_URL"] : [])];
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
    network: config.stellarNetwork,
    paymentAsset: config.stellarAsset,
    merchantAddressConfigured: true,
    shopifyAuthMode: authMode,
    agentAuth: config.agentAuth ?? "required",
    quoteTtlMinutes: config.quoteTtlMinutes,
    agentEnvironmentFilePresent: existsSync(resolve(process.cwd(), "agent.env")),
    verifyMode: process.argv.includes("--verify"),
  };
  if (config.agentAuth === "off") report.warning = "SETAREH_AGENT_AUTH=off: /v1 is served without agent keys. Use it only on a local address.";
  if (process.argv.includes("--verify")) {
    const database = new SetarehDatabase(config.databasePath);
    const runtime = createShopifyRuntime(database, config.baseUrl);
    // Registers the environment store exactly as the service does at start-up, so the list below is what the service serves.
    new CommerceService(config, database, runtime.directory);
    if (runtime.oauth) report.shopifyInstallation = runtime.oauth.installationStatus(runtime.client.domain);
    const checkRecipient = createRecipientChecker(config.stellarHorizonUrl ?? DEFAULT_TESTNET_HORIZON_URL);
    const stores: Array<Record<string, unknown>> = [];
    let failedStores = 0;
    for (const merchant of database.listMerchants()) {
      // One line per store: who it is, whether it can sell, and what was actually verified. Never the payout address itself.
      const entry: Record<string, unknown> = { merchant: merchant.id, name: merchant.name, shopDomain: merchant.shopDomain, status: merchant.status, network: merchant.network, configuredBy: merchant.configuredBy, maxOrderUsdc: merchant.maxOrderUsdc, maxDayUsdc: merchant.maxDayUsdc, agentKeys: database.listAgentKeys(merchant.id).filter((key) => !key.revokedAt).length };
      if (merchant.status === "active") {
        try {
          const client = runtime.directory.clientFor(merchant);
          const sample = await client.searchVariants("", 1);
          const scopes = await client.getAccessScopes();
          const missing = SHOPIFY_REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
          if (missing.length) throw new Error(`missing Shopify scopes: ${missing.join(", ")}`);
          const recipient = await checkRecipient(merchant.stellarRecipient);
          if (!recipient.ok) throw new Error(`payout account: ${recipient.reason}`);
          if (merchant.maxOrderUsdc === null || merchant.maxDayUsdc === null) throw new Error("caps are not set");
          entry.verified = { shopify: true, sampleVariants: sample.length, requiredScopes: true, payoutAccountTrustsUsdc: true, capsSet: true };
        } catch (error) {
          failedStores += 1;
          entry.verified = false;
          entry.error = error instanceof Error ? error.message : "verification failed";
        }
      }
      stores.push(entry);
    }
    report.stores = stores;
    report.activeStores = stores.filter((store) => store.status === "active").length;
    if (failedStores > 0) throw new Error(`${failedStores} active store(s) failed verification: ${stores.filter((store) => store.error).map((store) => `${store.merchant} (${store.error})`).join("; ")}`);
    const shopify = runtime.client;
    const variants = await shopify.searchVariants("", 1);
    const facilitatorUrl = new URL(config.facilitatorUrl.endsWith("/") ? "supported" : `${config.facilitatorUrl}/supported`);
    const facilitator = await fetch(facilitatorUrl, { headers: { Accept: "application/json" } });
    if (!facilitator.ok) throw new Error(`Facilitator support check failed (${facilitator.status}).`);
    const capabilities = await facilitator.json() as { kinds?: Array<{ network?: string; scheme?: string }> };
    const supportsStellarTestnet = capabilities.kinds?.some((kind) => kind.network === "stellar:testnet" && kind.scheme === "exact") ?? false;
    if (!supportsStellarTestnet) throw new Error("Facilitator does not advertise exact settlement for stellar:testnet.");
    report.shopify = { connected: true, sampleVariants: variants.length, requiredScopesVerified: true };
    report.facilitator = { connected: true, stellarTestnetExact: true };
    // Both network readers must answer: every order needs the hash confirmed by Stellar RPC and Horizon.
    const readers = { rpc: new rpc.Server(config.stellarRpcUrl ?? DEFAULT_TESTNET_RPC_URL), horizon: createHorizonClient(config.stellarHorizonUrl ?? DEFAULT_TESTNET_HORIZON_URL) };
    const protocol = await checkProtocol(readers);
    if (protocol.rpc.error) throw new Error(`Stellar RPC is not answering: ${protocol.rpc.error}`);
    if (protocol.horizon.error) throw new Error(`Horizon is not answering: ${protocol.horizon.error}`);
    report.stellar = { rpc: { connected: true, protocolVersion: protocol.rpc.protocolVersion }, horizon: { connected: true, protocolVersion: protocol.horizon.protocolVersion }, knownProtocolVersion: protocol.known, protocolSupported: protocol.supported, settlementWorker: config.settlementWorker?.enabled === false ? "off" : "on" };
    if (!protocol.supported) report.warning = `The network runs a protocol newer than ${protocol.known}, the version this build was tested with. Run a smoke purchase before accepting payments.`;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Preflight check failed.";
  process.stdout.write(`${JSON.stringify({ ok: false, message }, null, 2)}\n`);
  process.exitCode = 1;
});
