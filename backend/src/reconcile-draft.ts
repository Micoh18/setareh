import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createShopifyRuntime } from "./shopify-oauth.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const draftOrderId = process.argv[2];
if (!draftOrderId?.startsWith("gid://shopify/DraftOrder/")) {
  throw new Error("Usage: npm run reconcile:draft -- gid://shopify/DraftOrder/<id>");
}

const config = loadConfig();
const database = new SetarehDatabase(config.databasePath);
try {
  const draft = await createShopifyRuntime(database, config.baseUrl).client.getDraftStatus(draftOrderId);
  process.stdout.write(`${JSON.stringify(draft, null, 2)}\n`);
} finally {
  database.close();
}
