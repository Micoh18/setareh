import { Address, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative, type Transaction, type xdr } from "@stellar/stellar-sdk";

type OperationRecord = Transaction["operations"][number];

/** The transfer a buyer authorized, read from the signed x402 payload. Never persist the payload itself. */
export type SignedTransfer = { asset: string; from: string; to: string; amount: bigint; signatureExpirationLedger: number };

/** Converts a fixed 7-decimal USDC string to the integer units Stellar settles. */
export function usdcUnits(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(`${whole}${fraction.padEnd(7, "0").slice(0, 7)}`);
}

function transferCall(op: OperationRecord): { asset: string; from: string; to: string; amount: bigint } | undefined {
  if (op.type !== "invokeHostFunction" || op.func.type !== "hostFunctionTypeInvokeContract") return undefined;
  const call = op.func.invokeContract;
  if (call.functionName.toString() !== "transfer") return undefined;
  const [from, to, amount] = call.args.map((arg) => scValToNative(arg));
  if (typeof from !== "string" || typeof to !== "string" || typeof amount !== "bigint") return undefined;
  return { asset: Address.fromScAddress(call.contractAddress).toString(), from, to, amount };
}

/** The ledger after which the buyer's signed authorization can no longer be submitted. */
function signatureExpirationLedger(op: OperationRecord): number | undefined {
  if (op.type !== "invokeHostFunction") return undefined;
  const credentials = op.auth?.[0]?.credentials;
  if (credentials?.type === "sorobanCredentialsAddress") return credentials.address.signatureExpirationLedger;
  if (credentials?.type === "sorobanCredentialsAddressV2") return credentials.addressV2.signatureExpirationLedger;
  if (credentials?.type === "sorobanCredentialsAddressWithDelegates") return credentials.addressWithDelegates.addressCredentials.signatureExpirationLedger;
  return undefined;
}

/** Reads the authorized transfer from an x402 Stellar payment payload; undefined when it is not one. */
export function describeSignedTransfer(paymentPayload: unknown): SignedTransfer | undefined {
  const transaction = (paymentPayload as { payload?: { transaction?: unknown } } | undefined)?.payload?.transaction;
  if (typeof transaction !== "string") return undefined;
  try {
    const tx = TransactionBuilder.fromXDR(transaction, Networks.TESTNET) as Transaction;
    const op = tx.operations[0];
    const transfer = op ? transferCall(op) : undefined;
    const expiration = op ? signatureExpirationLedger(op) : undefined;
    if (!transfer || expiration === undefined) return undefined;
    return { ...transfer, signatureExpirationLedger: expiration };
  } catch {
    return undefined;
  }
}

export type ExpectedSettlement = { asset: string; payTo: string; amount: bigint; payer?: string };

export type SettlementLookup =
  | { found: true; transactionHash: string; ledger: number }
  | { found: false; reason: "transaction_failed" | "not_found" | "mismatch" };

export type SettlementRpc = Pick<rpc.Server, "getTransaction" | "getEvents" | "getHealth">;

/** Reads a SEP-41 transfer from an event's topics and data; undefined when the event is not one. */
function transferFromEvent(topics: xdr.ScVal[], data: xdr.ScVal): { from: string; to: string; amount: bigint } | undefined {
  const [name, from, to] = topics.map((topic) => scValToNative(topic));
  if (name !== "transfer" || typeof from !== "string" || typeof to !== "string") return undefined;
  const value = scValToNative(data);
  // CAP-67 transfer events may carry { amount, to_muxed_id } instead of a bare i128.
  const amount = typeof value === "bigint" ? value : typeof (value as { amount?: unknown } | null)?.amount === "bigint" ? (value as { amount: bigint }).amount : undefined;
  return amount === undefined ? undefined : { from, to, amount };
}

function matches(transfer: { from: string; to: string; amount: bigint }, expected: ExpectedSettlement) {
  return transfer.to === expected.payTo && transfer.amount === expected.amount && (!expected.payer || transfer.from === expected.payer);
}

/**
 * Checks a specific transaction hash on-chain: it must have succeeded and emitted a USDC transfer of
 * exactly the expected amount to the merchant. Events, not the envelope, are the source of truth, so a
 * fee-bumped or contract-routed transfer is judged the same way as the event search below.
 */
export async function lookupTransaction(server: SettlementRpc, hash: string, expected: ExpectedSettlement): Promise<SettlementLookup> {
  const result = await server.getTransaction(hash);
  if (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) return { found: false, reason: "not_found" };
  if (result.status === rpc.Api.GetTransactionStatus.FAILED) return { found: false, reason: "transaction_failed" };
  const paid = result.events.contractEventsXdr.flat().some((event) => {
    if (!event.contractId || event.body.type !== "v0") return false;
    if (Address.contract(event.contractId.toXdrObject()).toString() !== expected.asset) return false;
    const transfer = transferFromEvent(event.body.v0.topics, event.body.v0.data);
    return transfer !== undefined && matches(transfer, expected);
  });
  return paid ? { found: true, transactionHash: hash, ledger: result.ledger } : { found: false, reason: "mismatch" };
}

/** Upper bound on event pages per search; reaching it is reported, never treated as "not found". */
const MAX_EVENT_PAGES = 50;

/**
 * Searches USDC transfer events from the payer to the merchant between two ledgers (inclusive).
 * Returns every matching transaction so the caller can refuse to guess when more than one fits.
 */
export async function searchTransfers(server: SettlementRpc, expected: ExpectedSettlement & { payer: string }, fromLedger: number, toLedger: number) {
  const topic = [nativeToScVal("transfer", { type: "symbol" }), nativeToScVal(expected.payer, { type: "address" }), nativeToScVal(expected.payTo, { type: "address" })].map((value) => value.toXdr("base64"));
  const filters = [{ type: "contract" as const, contractIds: [expected.asset], topics: [[...topic, "**"]] }];
  const found = new Map<string, number>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const response = cursor ? await server.getEvents({ filters, cursor, limit: 100 }) : await server.getEvents({ filters, startLedger: fromLedger, endLedger: toLedger + 1, limit: 100 });
    for (const event of response.events) {
      if (event.ledger > toLedger) return [...found].map(([transactionHash, ledger]) => ({ transactionHash, ledger }));
      const transfer = transferFromEvent(event.topic, event.value);
      if (transfer && matches(transfer, expected)) found.set(event.txHash, event.ledger);
    }
    if (response.events.length < 100 || !response.cursor) return [...found].map(([transactionHash, ledger]) => ({ transactionHash, ledger }));
    cursor = response.cursor;
  }
  throw new Error(`Event search exceeded ${MAX_EVENT_PAGES} pages; narrow the window or pass --tx.`);
}
