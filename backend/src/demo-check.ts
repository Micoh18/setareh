import dotenv from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Asset, Horizon, Keypair, Networks } from "@stellar/stellar-sdk";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";

/**
 * Pre-flight for the reference agent. Verifies, without signing or paying anything,
 * that this machine can complete the evaluator walkthrough: Node version, agent.env,
 * API reachability, the testnet account, XLM for fees and the USDC trustline/balance.
 * It never prints the secret key.
 */
const envFile = resolve(process.cwd(), process.env.SETAREH_AGENT_ENV_FILE ?? "agent.env");
dotenv.config({ path: envFile, quiet: true });

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const MIN_NODE_MAJOR = 22;
const RECOMMENDED_NODE_MAJOR = 24;
const MIN_XLM_FOR_FEES = 1;

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

function usdcBalance(balances: Horizon.HorizonApi.BalanceLine[]) {
  for (const line of balances) {
    if (line.asset_type !== "credit_alphanum4" && line.asset_type !== "credit_alphanum12") continue;
    const contractId = new Asset(line.asset_code, line.asset_issuer).contractId(Networks.TESTNET);
    if (contractId === USDC_TESTNET_ADDRESS) return Number(line.balance);
  }
  return undefined;
}

async function main() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("node", nodeMajor >= MIN_NODE_MAJOR, nodeMajor >= RECOMMENDED_NODE_MAJOR ? `Node ${process.versions.node}` : `Node ${process.versions.node}; se recomienda ${RECOMMENDED_NODE_MAJOR} o superior`);

  add("agent.env", existsSync(envFile), existsSync(envFile) ? `Encontrado en ${envFile}` : `No existe ${envFile}`);

  const apiUrl = process.env.SETAREH_API_URL?.trim();
  const maxUsdc = Number(process.env.AGENT_MAX_USDC ?? "");
  const secret = process.env.AGENT_STELLAR_PRIVATE_KEY?.trim();
  add("SETAREH_API_URL", Boolean(apiUrl), apiUrl ?? "Falta SETAREH_API_URL");
  add("AGENT_MAX_USDC", Number.isFinite(maxUsdc) && maxUsdc > 0, Number.isFinite(maxUsdc) && maxUsdc > 0 ? `Tope local ${maxUsdc} USDC por pago` : "AGENT_MAX_USDC debe ser un número positivo");

  let keypair: Keypair | undefined;
  try {
    if (!secret) throw new Error("Falta AGENT_STELLAR_PRIVATE_KEY");
    keypair = Keypair.fromSecret(secret);
    add("AGENT_STELLAR_PRIVATE_KEY", true, `Clave válida; cuenta pública ${keypair.publicKey()}`);
  } catch (error) {
    add("AGENT_STELLAR_PRIVATE_KEY", false, secret ? "La clave no es una clave secreta Stellar válida (debe empezar con S y tener 56 caracteres)" : (error as Error).message);
  }

  if (apiUrl) {
    try {
      const response = await fetch(new URL("/health", apiUrl), { signal: AbortSignal.timeout(10_000) });
      add("api", response.ok, response.ok ? `${apiUrl} responde ${response.status}` : `${apiUrl}/health respondió ${response.status}`);
    } catch (error) {
      add("api", false, `No se pudo contactar ${apiUrl}: ${(error as Error).message}`);
    }
  }

  if (keypair) {
    try {
      const account = await new Horizon.Server(HORIZON_TESTNET).loadAccount(keypair.publicKey());
      const xlm = Number(account.balances.find((line) => line.asset_type === "native")?.balance ?? "0");
      add("xlm", xlm >= MIN_XLM_FOR_FEES, `${xlm} XLM de testnet (mínimo ${MIN_XLM_FOR_FEES} para comisiones)`);
      const usdc = usdcBalance(account.balances);
      if (usdc === undefined) add("usdc", false, "La cuenta no tiene trustline al USDC de testnet; pide USDC en el faucet de Circle");
      else add("usdc", usdc > 0, `${usdc} USDC de testnet${Number.isFinite(maxUsdc) && usdc < maxUsdc ? ` (menos que el tope local de ${maxUsdc})` : ""}`);
    } catch (error) {
      const notFound = (error as { response?: { status?: number } }).response?.status === 404;
      add("account", false, notFound ? "La cuenta no existe en testnet todavía; fondéala con Friendbot" : `Horizon testnet no respondió: ${(error as Error).message}`);
    }
  }

  const ok = checks.every((check) => check.ok);
  process.stdout.write(`${JSON.stringify({ ok, checks, next: ok ? "Puedes crear el quote y ejecutar npm run demo:pay -- <quoteId>" : "Corrige los puntos con ok=false antes de crear el quote" }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const secret = process.env.AGENT_STELLAR_PRIVATE_KEY;
  console.error(secret ? message.replaceAll(secret, "[redacted]") : message);
  process.exitCode = 1;
});
