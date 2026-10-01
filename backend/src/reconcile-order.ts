import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CommerceService } from "./commerce.js";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { ShopifyClient } from "./shopify.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const quoteId = process.argv[2];
if (!quoteId) throw new Error("Usage: npm run reconcile:order -- <quoteId>");

const config = loadConfig();
const database = new SetarehDatabase(config.databasePath);
try {
  const commerce = new CommerceService(config, database, ShopifyClient.fromEnvironment());
  process.stdout.write(`${JSON.stringify(await commerce.reconcilePaidDraftOrder(quoteId), null, 2)}\n`);
} finally {
  database.close();
}
