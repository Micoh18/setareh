import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { computeMetrics } from "./operations.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

// Usage: npm run metrics [-- --since 2026-10-26T00:00:00Z]
const args = process.argv.slice(2);
const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : undefined;
if (since !== undefined && Number.isNaN(Date.parse(since))) throw new Error("--since must be an ISO-8601 date.");

const config = loadConfig();
const database = new SetarehDatabase(config.databasePath);
try {
  process.stdout.write(`${JSON.stringify(computeMetrics(database, { since: since ? new Date(since).toISOString() : undefined }), null, 2)}\n`);
} finally {
  database.close();
}
