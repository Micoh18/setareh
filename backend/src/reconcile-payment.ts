import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rpc } from "@stellar/stellar-sdk";
import { USDC_TESTNET_ADDRESS, getRpcUrl } from "@x402/stellar";
import { CommerceService } from "./commerce.js";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { reconcileUnknownPayment } from "./payment-reconciliation.js";
import { createShopifyRuntime } from "./shopify-oauth.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const args = process.argv.slice(2);
const quoteId = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--tx");
const txIndex = args.indexOf("--tx");
const operatorTransaction = txIndex >= 0 ? args[txIndex + 1] : undefined;
const apply = args.includes("--apply");
if (!quoteId || (txIndex >= 0 && !/^[0-9a-f]{64}$/i.test(operatorTransaction ?? ""))) {
  throw new Error("Usage: npm run reconcile:payment -- <quoteId> [--tx <transactionHash>] [--apply]");
}

const config = loadConfig();
const database = new SetarehDatabase(config.databasePath);
try {
  const quote = database.getQuote(quoteId);
  if (!quote) throw new Error("Quote not found.");
  if (quote.status !== "payment_unknown") throw new Error(`Quote is ${quote.status}; reconcile:payment only resolves payment_unknown quotes.`);
  const attempt = database.getLatestPaymentAttempt(quoteId);
  if (!attempt || attempt.outcome !== "unknown") throw new Error("No unknown settlement attempt is recorded for this quote.");

  // @x402/stellar bundles an older stellar-sdk; build the client from ours so XDR types match.
  const server = new rpc.Server(process.env.STELLAR_RPC_URL?.trim() || getRpcUrl(config.stellarNetwork));
  const verdict = await reconcileUnknownPayment(server, {
    quote, attempt, asset: USDC_TESTNET_ADDRESS, payTo: config.stellarMerchantAddress, operatorTransaction,
    claimedElsewhere: (hash) => { const owner = database.getQuoteIdByTransaction(hash); return owner !== undefined && owner !== quoteId; },
  });
  const report: Record<string, unknown> = { quoteId, attempt: { reason: attempt.errorReason, recordedAt: attempt.createdAt }, ...verdict, applied: false };

  if (apply && (verdict.verdict === "paid" || verdict.verdict === "unpaid")) {
    const commerce = new CommerceService(config, database, createShopifyRuntime(database, config.baseUrl).client);
    if (verdict.verdict === "paid") {
      commerce.recordReconciledSettlement(quoteId, verdict.transactionHash);
      report.order = await commerce.placePaidOrder(quoteId, true);
    } else {
      commerce.markReconciledUnpaid(quoteId);
    }
    report.applied = true;
  }
  report.status = database.getQuote(quoteId)?.status;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (verdict.verdict !== "paid" && verdict.verdict !== "unpaid") process.exitCode = 2;
} finally {
  database.close();
}
