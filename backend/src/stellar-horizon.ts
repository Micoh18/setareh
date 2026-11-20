import { Asset, Networks } from "@stellar/stellar-sdk";
import { usdcUnits, type ExpectedSettlement, type SettlementLookup } from "./stellar-settlement.js";

/**
 * Horizon is the second, independent view of the network used to verify a settlement. It is read
 * through two public endpoints (no credentials, no SDK client state): the transaction itself and its
 * operations, whose `asset_balance_changes` list the transfers a Soroban invocation produced.
 */

export type HorizonTransaction = { successful: boolean; ledger: number; createdAt: string };
export type HorizonBalanceChange = { assetType: string; assetCode?: string; assetIssuer?: string; type: string; from: string; to: string; amount: string };

export type HorizonApi = {
  /** Undefined when Horizon has no record of the hash (404). Throws on transport errors. */
  transaction(hash: string): Promise<HorizonTransaction | undefined>;
  /** Balance changes across all operations of the transaction; empty when Horizon has none. */
  balanceChanges(hash: string): Promise<HorizonBalanceChange[]>;
  /** Protocol version Horizon reports for the network it follows. */
  protocolVersion(): Promise<number>;
};

type FetchLike = typeof fetch;

export function createHorizonClient(baseUrl: string, fetchImpl: FetchLike = fetch): HorizonApi {
  const base = baseUrl.replace(/\/+$/, "");
  async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetchImpl(`${base}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return { status: 404, body: {} };
    if (!response.ok) throw new Error(`Horizon responded ${response.status} for ${path.split("?")[0]}`);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  return {
    async transaction(hash) {
      const { status, body } = await get(`/transactions/${encodeURIComponent(hash)}`);
      if (status === 404) return undefined;
      return { successful: body.successful === true, ledger: Number(body.ledger), createdAt: String(body.created_at ?? "") };
    },
    async balanceChanges(hash) {
      const { status, body } = await get(`/transactions/${encodeURIComponent(hash)}/operations?limit=200`);
      if (status === 404) return [];
      const records = ((body._embedded as { records?: unknown[] } | undefined)?.records ?? []) as Array<Record<string, unknown>>;
      return records.flatMap((operation) => ((operation.asset_balance_changes as Array<Record<string, unknown>> | undefined) ?? []).map((change) => ({
        assetType: String(change.asset_type ?? ""), assetCode: change.asset_code === undefined ? undefined : String(change.asset_code), assetIssuer: change.asset_issuer === undefined ? undefined : String(change.asset_issuer),
        type: String(change.type ?? ""), from: String(change.from ?? ""), to: String(change.to ?? ""), amount: String(change.amount ?? ""),
      })));
    },
    async protocolVersion() {
      const { body } = await get("/");
      const version = Number(body.current_protocol_version);
      if (!Number.isInteger(version)) throw new Error("Horizon did not report a protocol version.");
      return version;
    },
  };
}

/** The Stellar Asset Contract address of a classic asset, so Horizon's code/issuer can be compared with an x402 asset address. */
function contractAddressOf(change: HorizonBalanceChange): string | undefined {
  if (change.assetType === "native") return Asset.native().contractId(Networks.TESTNET);
  if (!change.assetCode || !change.assetIssuer) return undefined;
  try { return new Asset(change.assetCode, change.assetIssuer).contractId(Networks.TESTNET); } catch { return undefined; }
}

/**
 * Checks a transaction hash on Horizon with the same rule as the RPC lookup: the transaction must have
 * succeeded and moved exactly the expected amount of the expected asset to the merchant.
 */
export async function lookupTransactionOnHorizon(horizon: HorizonApi, hash: string, expected: ExpectedSettlement): Promise<SettlementLookup> {
  const transaction = await horizon.transaction(hash);
  if (!transaction) return { found: false, reason: "not_found" };
  if (!transaction.successful) return { found: false, reason: "transaction_failed" };
  const changes = await horizon.balanceChanges(hash);
  const paid = changes.some((change) => change.type === "transfer" && contractAddressOf(change) === expected.asset && change.to === expected.payTo
    && usdcUnits(change.amount) === expected.amount && (!expected.payer || change.from === expected.payer));
  return paid ? { found: true, transactionHash: hash, ledger: transaction.ledger } : { found: false, reason: "mismatch" };
}
