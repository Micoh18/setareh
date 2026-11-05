import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, Horizon, Keypair, Networks } from "@stellar/stellar-sdk";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer, USDC_TESTNET_ADDRESS } from "@x402/stellar";

/**
 * Buyer-side wallet helpers shared by the reference CLI (`demo:pay`, `demo:check`) and the
 * local MCP server (`agent:mcp`). The secret key is read from `agent.env`, stays in this process
 * and is never included in any value these functions return.
 */

export const HORIZON_TESTNET_URL = "https://horizon-testnet.stellar.org";
export const MIN_NODE_MAJOR = 22;
export const RECOMMENDED_NODE_MAJOR = 24;
export const MIN_XLM_FOR_FEES = 1;

export type AgentEnv = { file: string; apiUrl?: string; maxUsdc?: string; secret?: string };

/** `agent.env` lives next to the backend package unless SETAREH_AGENT_ENV_FILE points elsewhere. */
export function agentEnvPath() {
  const override = process.env.SETAREH_AGENT_ENV_FILE;
  return override ? resolve(process.cwd(), override) : resolve(dirname(fileURLToPath(import.meta.url)), "../agent.env");
}

export function loadAgentEnv(): AgentEnv {
  const file = agentEnvPath();
  dotenv.config({ path: file, quiet: true });
  return { file, apiUrl: process.env.SETAREH_API_URL?.trim() || undefined, maxUsdc: process.env.AGENT_MAX_USDC?.trim() || undefined, secret: process.env.AGENT_STELLAR_PRIVATE_KEY?.trim() || undefined };
}

/** Replaces the secret key with a marker wherever it could have leaked into a message. */
export function redactSecret(message: string, secret?: string) {
  return secret ? message.replaceAll(secret, "[redacted]") : message;
}

export type SetupCheck = { name: string; ok: boolean; detail: string };
export type SetupReport = { ok: boolean; publicKey?: string; checks: SetupCheck[]; next: string };

function usdcBalance(balances: Horizon.HorizonApi.BalanceLine[]) {
  for (const line of balances) {
    if (line.asset_type !== "credit_alphanum4" && line.asset_type !== "credit_alphanum12") continue;
    if (new Asset(line.asset_code, line.asset_issuer).contractId(Networks.TESTNET) === USDC_TESTNET_ADDRESS) return Number(line.balance);
  }
  return undefined;
}

/** Verifies, without signing or paying anything, that this machine can complete the evaluator walkthrough. */
export async function checkSetup(env: AgentEnv, options: { fetchImpl?: typeof fetch; horizonUrl?: string } = {}): Promise<SetupReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const checks: SetupCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("node", nodeMajor >= MIN_NODE_MAJOR, nodeMajor >= RECOMMENDED_NODE_MAJOR ? `Node ${process.versions.node}` : `Node ${process.versions.node}; se recomienda ${RECOMMENDED_NODE_MAJOR} o superior`);
  add("agent.env", existsSync(env.file), existsSync(env.file) ? `Encontrado en ${env.file}` : `No existe ${env.file}`);
  add("SETAREH_API_URL", Boolean(env.apiUrl), env.apiUrl ?? "Falta SETAREH_API_URL");
  const maxUsdc = Number(env.maxUsdc ?? "");
  const maxOk = Number.isFinite(maxUsdc) && maxUsdc > 0;
  add("AGENT_MAX_USDC", maxOk, maxOk ? `Tope local ${maxUsdc} USDC por pago` : "AGENT_MAX_USDC debe ser un número positivo");

  let keypair: Keypair | undefined;
  try {
    if (!env.secret) throw new Error("Falta AGENT_STELLAR_PRIVATE_KEY");
    keypair = Keypair.fromSecret(env.secret);
    add("AGENT_STELLAR_PRIVATE_KEY", true, `Clave válida; cuenta pública ${keypair.publicKey()}`);
  } catch (error) {
    add("AGENT_STELLAR_PRIVATE_KEY", false, env.secret ? "La clave no es una clave secreta Stellar válida (debe empezar con S y tener 56 caracteres)" : (error as Error).message);
  }

  if (env.apiUrl) {
    try {
      const response = await fetchImpl(new URL("/health", env.apiUrl), { signal: AbortSignal.timeout(10_000) });
      add("api", response.ok, response.ok ? `${env.apiUrl} responde ${response.status}` : `${env.apiUrl}/health respondió ${response.status}`);
    } catch (error) {
      add("api", false, `No se pudo contactar ${env.apiUrl}: ${(error as Error).message}`);
    }
  }

  if (keypair) {
    try {
      const account = await new Horizon.Server(options.horizonUrl ?? HORIZON_TESTNET_URL).loadAccount(keypair.publicKey());
      const xlm = Number(account.balances.find((line) => line.asset_type === "native")?.balance ?? "0");
      add("xlm", xlm >= MIN_XLM_FOR_FEES, `${xlm} XLM de testnet (mínimo ${MIN_XLM_FOR_FEES} para comisiones)`);
      const usdc = usdcBalance(account.balances);
      if (usdc === undefined) add("usdc", false, "La cuenta no tiene trustline al USDC de testnet; pide USDC en el faucet de Circle");
      else add("usdc", usdc > 0, `${usdc} USDC de testnet${maxOk && usdc < maxUsdc ? ` (menos que el tope local de ${maxUsdc})` : ""}`);
    } catch (error) {
      const notFound = (error as { response?: { status?: number } }).response?.status === 404;
      add("account", false, notFound ? "La cuenta no existe en testnet todavía; fondéala con Friendbot" : `Horizon testnet no respondió: ${(error as Error).message}`);
    }
  }

  const ok = checks.every((check) => check.ok);
  return { ok, publicKey: keypair?.publicKey(), checks, next: ok ? "Todo listo: puedes crear un quote y pagarlo" : "Corrige los puntos con ok=false antes de crear el quote" };
}

export type PayOutcome =
  | { outcome: "created"; httpStatus: number; order: unknown }
  | { outcome: "refused_locally"; message: string; meaning: string }
  | { outcome: "rejected_before_payment"; httpStatus: number; message: string; meaning: string }
  | { outcome: "failed_after_payment_attempt"; httpStatus: number; message: string; meaning: string };

/**
 * Plain-language reading of a non-created outcome, so the agent that relays it to a non-technical
 * person explains it the same way regardless of how the person phrased the request.
 */
export function describePayOutcome(outcome: "refused_locally" | "rejected_before_payment" | "failed_after_payment_attempt", httpStatus?: number) {
  switch (outcome) {
    case "refused_locally":
      return "La wallet local se negó a firmar: no se movió USDC ni se creó ninguna orden.";
    case "rejected_before_payment":
      return httpStatus === 409
        ? "Setareh rechazó este cobro antes de que la wallet firmara nada: no se movió USDC ni se creó otra orden. Si el quote ya estaba pagado, ese rechazo es exactamente lo esperado y la orden original sigue intacta."
        : "Setareh no aceptó la solicitud antes de que la wallet firmara nada: no se movió USDC ni se creó ninguna orden.";
    case "failed_after_payment_attempt":
      return "La wallet firmó el pago pero Setareh no confirmó la orden. No pidas otro quote: consulta el estado con el mismo quoteId para saber si el cobro ocurrió.";
  }
}

function decodePaymentRequired(response: Response) {
  const encoded = response.headers.get("payment-required");
  if (!encoded) throw new Error("Setareh did not return a PAYMENT-REQUIRED challenge.");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { accepts: Array<{ network: string; asset: string; amount: string; payTo: string }> };
}

/**
 * Pays one quote with the local wallet: asks for the 402 challenge first, verifies network, asset
 * and the local spending limit, and only then signs and retries. Any non-402 answer to the first
 * request means nothing was signed; this is how a repeated quote is rejected (409).
 */
export async function payQuote(input: { apiUrl: string; quoteId: string; secret: string; maxUsdc: number; fetchImpl?: typeof fetch }): Promise<PayOutcome> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = new URL(`/v1/quotes/${input.quoteId}/pay-and-place`, input.apiUrl).toString();
  const request = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userConfirmed: true }) };
  const preview = await fetchImpl(endpoint, request);
  if (preview.status !== 402) return { outcome: "rejected_before_payment", httpStatus: preview.status, message: await preview.text(), meaning: describePayOutcome("rejected_before_payment", preview.status) };
  const requirement = decodePaymentRequired(preview).accepts[0];
  if (!requirement || requirement.network !== "stellar:testnet" || requirement.asset !== USDC_TESTNET_ADDRESS) return { outcome: "refused_locally", message: "Setareh requested an unsupported payment network or asset.", meaning: describePayOutcome("refused_locally") };
  if (BigInt(requirement.amount) > BigInt(Math.round(input.maxUsdc * 10_000_000))) return { outcome: "refused_locally", message: `Quote exceeds the local ${input.maxUsdc} USDC spending limit.`, meaning: describePayOutcome("refused_locally") };

  const signer = createEd25519Signer(input.secret, "stellar:testnet");
  // x402 defaults to a conservative $1 cap. Keep the SDK cap aligned with the explicit local
  // limit checked above rather than disabling its spend controls for the demo wallet.
  const client = x402Client.fromConfig({
    schemes: [{ network: "stellar:testnet", client: new ExactStellarScheme(signer) }],
    spendControls: { maxAmountPerPayment: `$${input.maxUsdc}` },
  });
  const response = await wrapFetchWithPayment(fetchImpl, client)(endpoint, request);
  if (!response.ok) return { outcome: "failed_after_payment_attempt", httpStatus: response.status, message: await response.text(), meaning: describePayOutcome("failed_after_payment_attempt", response.status) };
  return { outcome: "created", httpStatus: response.status, order: await response.json() };
}

/** Public Horizon lookup of a settled transaction; anyone can repeat it without credentials. */
export async function horizonTransaction(hash: string, options: { fetchImpl?: typeof fetch; horizonUrl?: string } = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.horizonUrl ?? HORIZON_TESTNET_URL}/transactions/${encodeURIComponent(hash)}`);
  if (response.status === 404) return { found: false as const, hash };
  if (!response.ok) throw new Error(`Horizon respondió ${response.status}`);
  const record = (await response.json()) as { successful: boolean; ledger: number; created_at: string; source_account: string };
  return { found: true as const, hash, successful: record.successful, ledger: record.ledger, createdAt: record.created_at, sourceAccount: record.source_account, url: `${options.horizonUrl ?? HORIZON_TESTNET_URL}/transactions/${hash}` };
}
