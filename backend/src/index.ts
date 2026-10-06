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
import { ShopifyClient } from "./shopify.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const config = loadConfig();
const database = new SetarehDatabase(config.databasePath);
const commerce = new CommerceService(config, database, ShopifyClient.fromEnvironment());
const server = createMcpServer(commerce, config);
const transport = resolveTransport(process.env.SETAREH_TRANSPORT, config.port);

if (transport === "http" || transport === "both") {
  const app = createHttpApp(commerce);
  const host = config.httpHost ?? "127.0.0.1";
  app.listen(config.port!, host, () => console.error(`Setareh HTTP listening on ${config.baseUrl ?? `http://${host}:${config.port}`}`));
}

if (transport === "stdio" || transport === "both") {
  console.error("Setareh MCP running on stdio");
  void serveStdio(() => server);
} else {
  console.error("Setareh HTTP-only runtime started");
}
