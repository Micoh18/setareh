import type { HorizonApi } from "./stellar-horizon.js";
import type { SettlementRpc } from "./stellar-settlement.js";

/**
 * The network protocol version this build was tested against. When testnet moves ahead of it (as it did
 * with Protocol 30 on 2026-11-05, which the SDK of the day could not decode), the service says so at
 * start-up, in `doctor` and in /health instead of letting a purchase discover it.
 */
export const KNOWN_PROTOCOL_VERSION = 30;

export type ProtocolCheck = {
  checkedAt: string;
  known: number;
  rpc: { protocolVersion: number | null; error?: string };
  horizon: { protocolVersion: number | null; error?: string };
  /** False when any reader reports a version newer than the one this build was tested with. */
  supported: boolean;
};

let last: ProtocolCheck | undefined;

export function lastProtocolCheck(): ProtocolCheck | undefined {
  return last;
}

export async function checkProtocol(readers: { rpc: Pick<SettlementRpc, "getNetwork">; horizon: Pick<HorizonApi, "protocolVersion"> }, now = new Date()): Promise<ProtocolCheck> {
  const getNetwork = readers.rpc.getNetwork ? readers.rpc.getNetwork.bind(readers.rpc) : () => Promise.reject(new Error("getNetwork is not available on this RPC client"));
  const [fromRpc, fromHorizon] = await Promise.all([
    getNetwork().then((network) => ({ protocolVersion: Number(network.protocolVersion) })).catch((error: unknown) => ({ protocolVersion: null, error: error instanceof Error ? error.message : "rpc failed" })),
    readers.horizon.protocolVersion().then((protocolVersion) => ({ protocolVersion })).catch((error: unknown) => ({ protocolVersion: null, error: error instanceof Error ? error.message : "horizon failed" })),
  ]);
  const versions = [fromRpc.protocolVersion, fromHorizon.protocolVersion].filter((version): version is number => typeof version === "number" && Number.isFinite(version));
  last = { checkedAt: now.toISOString(), known: KNOWN_PROTOCOL_VERSION, rpc: fromRpc, horizon: fromHorizon, supported: versions.every((version) => version <= KNOWN_PROTOCOL_VERSION) };
  return last;
}
