import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CommerceService } from "./commerce.js";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { errorMessage } from "./log.js";
import { findStuckQuotes } from "./operations.js";
import { createShopifyRuntime } from "./shopify-oauth.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

// Usage: npm run reconcile:stuck [-- --apply] [-- --quote <quoteId>]
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args[args.indexOf("--quote") + 1];
const filterQuote = args.includes("--quote") ? only : undefined;

const config = loadConfig();
const database = new SetarehDatabase(config.databasePath);
try {
  const stuck = findStuckQuotes(database).filter((quote) => !filterQuote || quote.quoteId === filterQuote);
  const results: Array<Record<string, unknown>> = [];
  const commerce = apply ? new CommerceService(config, database, createShopifyRuntime(database, config.baseUrl).client) : undefined;
  for (const quote of stuck) {
    const entry: Record<string, unknown> = { ...quote, applied: false };
    if (commerce) {
      try {
        if (quote.status === "payment_submitted") { commerce.markInterruptedSettlement(quote.quoteId); entry.next = "run reconcile:payment"; }
        else if (quote.status === "creating_shopify_order") entry.order = await commerce.resumeInterruptedOrder(quote.quoteId);
        else if (quote.status === "payment_settled") entry.order = await commerce.placePaidOrder(quote.quoteId, true);
        entry.applied = true;
      } catch (error) {
        entry.error = errorMessage(error);
      }
      entry.status = database.getQuote(quote.quoteId)?.status;
    }
    results.push(entry);
  }
  process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), stuck: results, needsReview: database.listQuotesNeedingReview() }, null, 2)}\n`);
  if (results.some((entry) => entry.error) || (!apply && results.length > 0)) process.exitCode = 2;
} finally {
  database.close();
}
