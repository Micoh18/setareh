import dotenv from "dotenv";
import { resolve } from "node:path";
import { x402Client } from "@x402/fetch";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer, USDC_TESTNET_ADDRESS } from "@x402/stellar";

dotenv.config({ path: resolve(process.cwd(), process.env.SETAREH_AGENT_ENV_FILE ?? "agent.env"), quiet: true });

const quoteId = process.argv[2];
const privateKey = process.env.AGENT_STELLAR_PRIVATE_KEY;
const apiUrl = process.env.SETAREH_API_URL ?? "http://127.0.0.1:4020";
const maxUsdc = Number(process.env.AGENT_MAX_USDC ?? "30");

if (!quoteId) throw new Error("Usage: npm run demo:pay -- <quoteId>");
const agentPrivateKey = privateKey;
if (!agentPrivateKey) throw new Error("AGENT_STELLAR_PRIVATE_KEY is required in agent.env.");
if (!Number.isFinite(maxUsdc) || maxUsdc <= 0) throw new Error("AGENT_MAX_USDC must be positive.");

function decodePaymentRequired(response: Response) {
  const encoded = response.headers.get("payment-required");
  if (!encoded) throw new Error("Setareh did not return a PAYMENT-REQUIRED challenge.");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { accepts: Array<{ network: string; asset: string; amount: string; payTo: string }> };
}

async function main(walletSecret: string) {
  const endpoint = new URL(`/v1/quotes/${quoteId}/pay-and-place`, apiUrl).toString();
  const request = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userConfirmed: true }) };
  const preview = await fetch(endpoint, request);
  if (preview.status !== 402) throw new Error(`Expected 402 before payment, received ${preview.status}: ${await preview.text()}`);
  const requirement = decodePaymentRequired(preview).accepts[0];
  if (!requirement || requirement.network !== "stellar:testnet" || requirement.asset !== USDC_TESTNET_ADDRESS) throw new Error("Setareh requested an unsupported payment network or asset.");
  const maximumAtomic = BigInt(Math.round(maxUsdc * 10_000_000));
  if (BigInt(requirement.amount) > maximumAtomic) throw new Error(`Quote exceeds the local ${maxUsdc} USDC spending limit.`);

  const signer = createEd25519Signer(walletSecret, "stellar:testnet");
  // x402 defaults to a conservative $1 cap. Keep the SDK cap aligned with the
  // explicit local limit that was checked above, rather than disabling its
  // spend controls for the demo wallet.
  const client = x402Client.fromConfig({
    schemes: [{ network: "stellar:testnet", client: new ExactStellarScheme(signer) }],
    spendControls: { maxAmountPerPayment: `$${maxUsdc}` },
  });
  const paidFetch = wrapFetchWithPayment(fetch, client);
  const response = await paidFetch(endpoint, request);
  if (!response.ok) throw new Error(`Payment/order request failed (${response.status}): ${await response.text()}`);
  process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
}

main(agentPrivateKey).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage = privateKey ? message.replaceAll(privateKey, "[redacted]") : message;
  console.error(safeMessage);
  process.exitCode = 1;
});
