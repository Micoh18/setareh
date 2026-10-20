import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { SHOPIFY_UNINSTALLED_WEBHOOK_PATH, createShopifyRuntime } from "./shopify-oauth.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

// Registers the app/uninstalled webhook for the configured store with whatever auth mode is active.
const config = loadConfig();
if (!config.baseUrl) throw new Error("SETAREH_BASE_URL is required to register the webhook callback.");
const database = new SetarehDatabase(config.databasePath);
try {
  const runtime = createShopifyRuntime(database, config.baseUrl);
  const result = await runtime.client.ensureUninstallWebhook(`${config.baseUrl.replace(/\/+$/, "")}${SHOPIFY_UNINSTALLED_WEBHOOK_PATH}`);
  process.stdout.write(`${JSON.stringify({ ok: true, shop: runtime.client.domain, authMode: runtime.mode, webhook: result }, null, 2)}\n`);
} finally {
  database.close();
}
