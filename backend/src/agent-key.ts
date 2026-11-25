import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { issueAgentKey } from "./agent-keys.js";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

/**
 * Operator command for agent keys.
 *   npm run agent-key -- create --merchant <merchantId> --label "<who holds it>"
 *   npm run agent-key -- list [--merchant <merchantId>]
 *   npm run agent-key -- revoke <keyId | prefix>
 * `create` prints the key once; it cannot be recovered afterwards, only revoked and replaced.
 */
const USAGE = 'Usage: npm run agent-key -- create --merchant <merchantId> --label "<who holds it>" | list [--merchant <merchantId>] | revoke <keyId|prefix>';

const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : undefined; };

const database = new SetarehDatabase(loadConfig().databasePath);
try {
  if (command === "create") {
    const merchantId = option("merchant");
    const label = option("label");
    if (!merchantId || !label) throw new Error(USAGE);
    const { key, record } = issueAgentKey(database, { merchantId, label });
    process.stdout.write(`${JSON.stringify({ created: true, id: record.id, prefix: record.prefix, merchantId: record.merchantId, label: record.label, key, notice: "This key is shown only once. Send it over a private channel; it goes into the buyer's agent.env as SETAREH_AGENT_KEY." }, null, 2)}\n`);
  } else if (command === "list") {
    const keys = database.listAgentKeys(option("merchant"));
    process.stdout.write(`${JSON.stringify({ keys: keys.map((key) => ({ id: key.id, prefix: key.prefix, merchantId: key.merchantId, label: key.label, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt, revokedAt: key.revokedAt })) }, null, 2)}\n`);
  } else if (command === "revoke") {
    const target = rest.find((value) => !value.startsWith("--"));
    if (!target) throw new Error(USAGE);
    const revoked = database.revokeAgentKey(target);
    process.stdout.write(`${JSON.stringify({ revoked, target }, null, 2)}\n`);
    if (revoked === 0) process.exitCode = 2;
  } else {
    throw new Error(USAGE);
  }
} finally {
  database.close();
}
