import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

// Applies the personal-data retention policy (Docs/operaciones/logs-y-retencion.md).
// Usage: npm run purge [-- --apply] [-- --expired-days 30] [-- --ordered-days 90]
// Dry run by default: lists what would be purged and changes nothing.
const args = process.argv.slice(2);
const apply = args.includes("--apply");
function days(flag: string, fallback: number) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} expects a whole number of days.`);
  return value;
}
const expiredAfterDays = days("--expired-days", 30);
const orderedAfterDays = days("--ordered-days", 90);

const config = loadConfig();
const database = new SetarehDatabase(config.databasePath);
try {
  const results = database.purgePersonalData({ expiredAfterDays, orderedAfterDays, apply });
  process.stdout.write(`${JSON.stringify({
    checkedAt: new Date().toISOString(),
    policy: { expiredAfterDays, orderedAfterDays, fields: ["quote.email", "quote.shipping_address_json", "payment.facilitator_receipt_json (ordered only)"] },
    apply,
    candidates: results.length,
    quotes: results,
  }, null, 2)}\n`);
  if (!apply && results.length > 0) process.exitCode = 2;
} finally {
  database.close();
}
