import { loadAgentEnv, payQuote, redactSecret } from "./agent-wallet.js";

const env = loadAgentEnv();
const quoteId = process.argv[2];
const apiUrl = env.apiUrl ?? "http://127.0.0.1:4020";
const maxUsdc = Number(env.maxUsdc ?? "30");

if (!quoteId) throw new Error("Usage: npm run demo:pay -- <quoteId>");
if (!env.secret) throw new Error("AGENT_STELLAR_PRIVATE_KEY is required in agent.env.");
if (!Number.isFinite(maxUsdc) || maxUsdc <= 0) throw new Error("AGENT_MAX_USDC must be positive.");

async function main(secret: string) {
  const result = await payQuote({ apiUrl, quoteId, secret, maxUsdc });
  switch (result.outcome) {
    case "created": process.stdout.write(`${JSON.stringify(result.order, null, 2)}\n`); return;
    case "refused_locally": throw new Error(result.message);
    case "rejected_before_payment": throw new Error(`Expected 402 before payment, received ${result.httpStatus}: ${result.message}`);
    case "failed_after_payment_attempt": throw new Error(`Payment/order request failed (${result.httpStatus}): ${result.message}`);
  }
}

main(env.secret).catch((error: unknown) => {
  console.error(redactSecret(error instanceof Error ? error.message : String(error), env.secret));
  process.exitCode = 1;
});
