import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { CommerceService } from "./commerce.js";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createHttpApp } from "./http.js";
import { createMcpServer } from "./mcp.js";
import { resolveTransport } from "./runtime.js";
import { createShopifyRuntime } from "./shopify-oauth.js";
import { startSettlementWorker } from "./settlement-worker.js";
import { checkProtocol } from "./stellar-preflight.js";
import { log } from "./log.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const config = loadConfig();
const database = new SetarehDatabase(config.databasePath);
const shopify = createShopifyRuntime(database, config.baseUrl);
const commerce = new CommerceService(config, database, shopify.directory);
const server = createMcpServer(commerce, config);
const transport = resolveTransport(process.env.SETAREH_TRANSPORT, config.port);

if (transport === "http" || transport === "both") {
  const app = createHttpApp(commerce, { shopifyOAuth: shopify.oauth });
  const host = config.httpHost ?? "127.0.0.1";
  app.listen(config.port!, host, () => log("info", "server.listening", { url: config.baseUrl ?? `http://${host}:${config.port}`, authMode: shopify.mode, oauthRoutes: shopify.oauth ? "enabled" : "disabled" }));
  if (config.agentAuth === "off") log("warn", "server.agent_auth", { status: "off", reason: "SETAREH_AGENT_AUTH=off serves /v1 without agent keys; never use it on a public address" });
  // Protocol preflight: say so at start-up when the network moved past the version this build was tested with.
  void checkProtocol(commerce.chain).then((check) => log(check.supported ? "info" : "warn", "stellar.protocol", { status: check.supported ? "known" : "newer_than_tested", amount: check.rpc.protocolVersion ?? check.horizon.protocolVersion ?? undefined, reason: check.rpc.error ?? check.horizon.error }));
  const worker = config.settlementWorker ?? { enabled: true, intervalMs: 30_000, maxUnknownMs: 5 * 60_000, maxVerificationMs: 5 * 60_000 };
  if (worker.enabled) {
    const retention = config.retention?.auto ? config.retention : undefined;
    startSettlementWorker({ db: database, commerce, options: { maxUnknownMs: worker.maxUnknownMs, maxVerificationMs: worker.maxVerificationMs, retention } }, worker.intervalMs);
  } else {
    log("warn", "settlement.worker", { action: "disabled" });
  }
}

if (transport === "stdio" || transport === "both") {
  log("info", "server.started", { transport: "stdio" });
  void serveStdio(() => server);
} else {
  log("info", "server.started", { transport: "http" });
}
