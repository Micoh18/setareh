import { lookupTransactionOnHorizon, type HorizonApi } from "./stellar-horizon.js";
import { lookupTransaction, type ExpectedSettlement, type SettlementLookup, type SettlementRpc } from "./stellar-settlement.js";

/**
 * A settlement is verified only when two independent readers of the network, Stellar RPC and Horizon,
 * both find the transaction and both see the quoted transfer to the merchant in the same ledger. The
 * facilitator's answer is never enough on its own: it reported hashes that were not on the network
 * (F15), hashes from another network (F16) and could report a transfer of another amount (F17).
 */

export type ChainReaders = { rpc: SettlementRpc; horizon: HorizonApi };

export type SourceResult = SettlementLookup | { found: false; reason: "unavailable"; message: string };

export type VerificationResult =
  | { verdict: "verified"; transactionHash: string; ledger: number; rpc: SourceResult; horizon: SourceResult }
  /** Neither source contradicts the payment, but at least one cannot confirm it yet. Safe to retry. */
  | { verdict: "pending"; transactionHash: string; reason: string; rpc: SourceResult; horizon: SourceResult }
  /** A source contradicts the payment. The order must not be completed; a person decides. */
  | { verdict: "disagree"; transactionHash: string; reason: string; rpc: SourceResult; horizon: SourceResult };

async function read(label: "rpc" | "horizon", lookup: () => Promise<SettlementLookup>): Promise<SourceResult> {
  try {
    return await lookup();
  } catch (error) {
    return { found: false, reason: "unavailable", message: `${label}: ${error instanceof Error ? error.message : "request failed"}` };
  }
}

export async function verifySettlement(chain: ChainReaders, transactionHash: string, expected: ExpectedSettlement): Promise<VerificationResult> {
  const [rpc, horizon] = await Promise.all([
    read("rpc", () => lookupTransaction(chain.rpc, transactionHash, expected)),
    read("horizon", () => lookupTransactionOnHorizon(chain.horizon, transactionHash, expected)),
  ]);
  const base = { transactionHash, rpc, horizon };
  const reasons = [rpc, horizon].map((source) => (source.found ? undefined : source.reason));
  if (reasons.includes("mismatch") || reasons.includes("transaction_failed")) {
    const reason = reasons.includes("mismatch") ? "transfer_mismatch" : "transaction_failed";
    return { verdict: "disagree", reason, ...base };
  }
  if (rpc.found && horizon.found) {
    if (rpc.ledger !== horizon.ledger) return { verdict: "disagree", reason: "ledger_mismatch", ...base };
    return { verdict: "verified", ledger: rpc.ledger, ...base };
  }
  const waiting = [rpc.found ? undefined : `rpc:${rpc.reason}`, horizon.found ? undefined : `horizon:${horizon.reason}`].filter(Boolean).join(",");
  return { verdict: "pending", reason: waiting, ...base };
}

/** What gets persisted next to the payment: enough for an auditor, nothing from the signed payload. */
export function verificationEvidence(result: VerificationResult, checkedAt: Date) {
  const source = (value: SourceResult) => (value.found ? { found: true, ledger: value.ledger } : { found: false, reason: value.reason });
  return { verdict: result.verdict, reason: "reason" in result ? result.reason : undefined, ledger: result.verdict === "verified" ? result.ledger : undefined, rpc: source(result.rpc), horizon: source(result.horizon), checkedAt: checkedAt.toISOString() };
}
