import { Address, Networks, TransactionBuilder, scValToNative, type Transaction } from "@stellar/stellar-sdk";

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
