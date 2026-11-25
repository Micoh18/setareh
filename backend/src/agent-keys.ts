import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AgentKeyRecord, SetarehDatabase } from "./db.js";

/**
 * Agent keys identify a buyer agent to the API and bind it to one store. They are issued by the
 * operator (`npm run agent-key -- create`), shown once and stored only as a SHA-256 hash: a copy of
 * the database does not let anyone call the API. They have nothing to do with the buyer's Stellar
 * wallet, whose secret never reaches Setareh; a key opens the API, the wallet still signs the payment.
 *
 * Format: sak_<8 hex, public prefix>_<43 base64url characters, 256 random bits>.
 */
const AGENT_KEY_PATTERN = /^sak_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

export function hashAgentKey(key: string) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Creates a key for one store. The returned `key` is the only time the secret exists in clear text. */
export function issueAgentKey(db: SetarehDatabase, input: { merchantId: string; label: string }): { key: string; record: AgentKeyRecord } {
  if (!db.getMerchant(input.merchantId)) throw new Error(`Merchant ${input.merchantId} is not registered.`);
  const label = input.label.trim();
  if (!label || label.length > 80) throw new Error("An agent key needs a label of 1 to 80 characters saying who holds it.");
  const prefix = randomBytes(4).toString("hex");
  const key = `sak_${prefix}_${randomBytes(32).toString("base64url")}`;
  const record = db.createAgentKey({ id: randomUUID(), merchantId: input.merchantId, label, prefix, keyHash: hashAgentKey(key) });
  return { key, record };
}

/** Resolves an `Authorization: Bearer sak_…` header to its active key. Malformed, unknown and revoked keys all answer undefined. */
export function authenticateAgentKey(db: SetarehDatabase, authorization: string | undefined): AgentKeyRecord | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  if (!match || !AGENT_KEY_PATTERN.test(match[1])) return undefined;
  const record = db.findAgentKey(hashAgentKey(match[1]));
  if (record) db.touchAgentKey(record.id);
  return record;
}
