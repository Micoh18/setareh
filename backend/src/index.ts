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
import { log } from "./log.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const config = loadConfig();
const database = new SetarehDatabase(config.databasePath);
const shopify = createShopifyRuntime(database, config.baseUrl);
const commerce = new CommerceService(config, database, shopify.client);
const server = createMcpServer(commerce, config);
const transport = resolveTransport(process.env.SETAREH_TRANSPORT, config.port);

if (transport === "http" || transport === "both") {
  const app = createHttpApp(commerce, { shopifyOAuth: shopify.oauth });
  const host = config.httpHost ?? "127.0.0.1";
  app.listen(config.port!, host, () => log("info", "server.listening", { url: config.baseUrl ?? `http://${host}:${config.port}`, authMode: shopify.mode, oauthRoutes: shopify.oauth ? "enabled" : "disabled" }));
}

if (transport === "stdio" || transport === "both") {
  log("info", "server.started", { transport: "stdio" });
  void serveStdio(() => server);
} else {
  log("info", "server.started", { transport: "http" });
}
