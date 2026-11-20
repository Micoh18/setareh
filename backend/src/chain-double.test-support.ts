import { StrKey, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import type { ChainReaders } from "./settlement-verification.js";
import type { HorizonApi, HorizonBalanceChange } from "./stellar-horizon.js";
import type { SettlementRpc } from "./stellar-settlement.js";

/** Test-only doubles of the two network readers. Excluded from the production build. */

export type ChainTransfer = { hash: string; ledger: number; from: string; to: string; amount: bigint; succeeded?: boolean };

/** Issuer of testnet USDC; its Stellar Asset Contract is USDC_TESTNET_ADDRESS. */
export const USDC_TESTNET_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Fixtures use placeholder accounts such as "GTEST"; those travel as plain strings, real keys as addresses. */
const addressVal = (value: string) => (StrKey.isValidEd25519PublicKey(value) ? nativeToScVal(value, { type: "address" }) : nativeToScVal(value, { type: "string" }));

/** An RPC double that answers getTransaction and getEvents from a list of USDC transfers. */
export function rpcFrom(transfers: ChainTransfer[], latestLedger: number, oldestLedger = 1, protocolVersion = 30): SettlementRpc {
  const topics = (transfer: ChainTransfer) => [nativeToScVal("transfer", { type: "symbol" }), addressVal(transfer.from), addressVal(transfer.to), nativeToScVal(`USDC:${USDC_TESTNET_ISSUER}`)];
  return {
    getHealth: async () => ({ status: "healthy", latestLedger, oldestLedger, ledgerRetentionWindow: latestLedger - oldestLedger }),
    getNetwork: async () => ({ passphrase: "Test SDF Network ; September 2015", protocolVersion: String(protocolVersion) }),
    getTransaction: async (hash: string) => {
      const transfer = transfers.find((candidate) => candidate.hash === hash);
      if (!transfer) return { status: rpc.Api.GetTransactionStatus.NOT_FOUND, txHash: hash } as any;
      if (transfer.succeeded === false) return { status: rpc.Api.GetTransactionStatus.FAILED, txHash: hash, ledger: transfer.ledger } as any;
      const event = { contractId: { toXdrObject: () => StrKey.decodeContract(USDC_TESTNET_ADDRESS) }, body: { type: "v0", v0: { topics: topics(transfer), data: nativeToScVal(transfer.amount, { type: "i128" }) } } };
      return { status: rpc.Api.GetTransactionStatus.SUCCESS, txHash: hash, ledger: transfer.ledger, events: { transactionEventsXdr: [], contractEventsXdr: [[event]] } } as any;
    },
    getEvents: async (request: any) => {
      const events = transfers
        .filter((transfer) => transfer.succeeded !== false && transfer.ledger >= request.startLedger && transfer.ledger < request.endLedger)
        .map((transfer) => ({ txHash: transfer.hash, ledger: transfer.ledger, topic: topics(transfer), value: nativeToScVal(transfer.amount, { type: "i128" }) }))
        // Mirrors the RPC topic filter on payer and merchant.
        .filter((event) => request.filters[0].topics[0].slice(1, 3).every((wanted: string, index: number) => event.topic[index + 1].toXdr("base64") === wanted));
      return { events, cursor: "", latestLedger, oldestLedger } as any;
    },
  } as unknown as SettlementRpc;
}

function units(amount: bigint) {
  const text = amount.toString().padStart(8, "0");
  return `${text.slice(0, -7)}.${text.slice(-7)}`;
}

/** A Horizon double that answers from the same transfer list, so both readers agree unless told otherwise. */
export function horizonFrom(transfers: ChainTransfer[], options: { protocolVersion?: number; overrides?: Partial<HorizonApi> } = {}): HorizonApi {
  return {
    transaction: async (hash) => {
      const transfer = transfers.find((candidate) => candidate.hash === hash);
      return transfer ? { successful: transfer.succeeded !== false, ledger: transfer.ledger, createdAt: "2026-11-20T00:00:00Z" } : undefined;
    },
    balanceChanges: async (hash) => {
      const transfer = transfers.find((candidate) => candidate.hash === hash);
      if (!transfer || transfer.succeeded === false) return [];
      const change: HorizonBalanceChange = { assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: USDC_TESTNET_ISSUER, type: "transfer", from: transfer.from, to: transfer.to, amount: units(transfer.amount) };
      return [change];
    },
    protocolVersion: async () => options.protocolVersion ?? 30,
    ...options.overrides,
  };
}

export function chainFrom(transfers: ChainTransfer[], latestLedger = 1_020, oldestLedger = 1, options: { horizon?: Partial<HorizonApi>; protocolVersion?: number } = {}): ChainReaders {
  return { rpc: rpcFrom(transfers, latestLedger, oldestLedger, options.protocolVersion), horizon: horizonFrom(transfers, { protocolVersion: options.protocolVersion, overrides: options.horizon }) };
}

/**
 * Readers that confirm any hash as the expected transfer to the merchant. For tests about what happens
 * after a payment is settled (Shopify failures, retries, logs), where the network is not the subject.
 */
export function confirmingChain(payTo: string, amount: bigint, options: { from?: string; ledger?: number } = {}): ChainReaders {
  const from = options.from ?? "GBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYER";
  const ledger = options.ledger ?? 1_002;
  const transferFor = (hash: string): ChainTransfer => ({ hash, ledger, from, to: payTo, amount });
  const rpcReader = (hash: string) => rpcFrom([transferFor(hash)], ledger + 20);
  return {
    rpc: {
      getHealth: async () => ({ status: "healthy", latestLedger: ledger + 20, oldestLedger: 1, ledgerRetentionWindow: ledger + 19 }),
      getNetwork: async () => ({ passphrase: "Test SDF Network ; September 2015", protocolVersion: "30" }),
      getTransaction: (hash: string) => rpcReader(hash).getTransaction(hash),
      getEvents: async () => ({ events: [], cursor: "", latestLedger: ledger + 20, oldestLedger: 1 }) as any,
    } as unknown as SettlementRpc,
    horizon: {
      transaction: async () => ({ successful: true, ledger, createdAt: "2026-11-20T00:00:00Z" }),
      balanceChanges: async () => [{ assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: USDC_TESTNET_ISSUER, type: "transfer", from, to: payTo, amount: units(amount) }],
      protocolVersion: async () => 30,
    },
  };
}
