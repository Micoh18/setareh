import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import * as z from "zod/v4";
import { checkSetup, horizonTransaction, loadAgentEnv, payQuote, redactSecret, type AgentEnv } from "./agent-wallet.js";
import { log } from "./log.js";
import { result, traced } from "./mcp.js";

/**
 * Buyer-side MCP server. It runs on the evaluator's machine next to `agent.env`, talks to the
 * public Setareh API over HTTPS and signs x402 payments with the local wallet. It needs no
 * Shopify credentials and never returns the wallet secret to the agent that drives it.
 */

const addressSchema = z.object({ address1: z.string().min(3), address2: z.string().optional(), city: z.string().min(2), province: z.string().optional(), country: z.string().min(2), zip: z.string().min(3), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional() });
const itemSchema = z.object({ variantId: z.string().startsWith("gid://shopify/ProductVariant/"), quantity: z.number().int().min(1).max(20) });

export type AgentMcpOptions = { env: AgentEnv; merchantId?: string; fetchImpl?: typeof fetch; horizonUrl?: string };

export function createAgentMcpServer(options: AgentMcpOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const merchantId = options.merchantId ?? process.env.SETAREH_MERCHANT_ID ?? "micohstore";
  const apiUrl = () => {
    if (!options.env.apiUrl) throw new Error("SETAREH_API_URL no está definido en agent.env.");
    return options.env.apiUrl;
  };
  /** Returns the parsed body on any status so the agent can read 4xx details such as Retry-After. */
  const api = async (path: string, init?: RequestInit & { requestId?: string }) => {
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set("Content-Type", "application/json");
    if (init?.requestId) headers.set("X-Request-Id", init.requestId);
    const response = await fetchImpl(new URL(path, apiUrl()), { ...init, headers, signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    if (response.ok) return body;
    return { httpStatus: response.status, error: body, retryAfterSeconds: response.headers.get("retry-after") ?? undefined, requestId: response.headers.get("x-request-id") ?? undefined };
  };

  const server = new McpServer({ name: "setareh-agent", version: "0.1.0" });

  server.registerTool("check_setup", {
    title: "Comprobar la wallet y el entorno de prueba",
    description: "Verifica Node, agent.env, que la API de Setareh responde y que la wallet testnet existe y tiene XLM y USDC. No firma ni paga nada y nunca muestra la clave secreta. Ejecútala antes de crear un quote.",
    inputSchema: {},
  }, traced("agent.check_setup", async () => result(await checkSetup(options.env, { fetchImpl, horizonUrl: options.horizonUrl }))));

  server.registerTool("search_catalog", {
    title: "Buscar en el catálogo de la tienda piloto",
    description: "Busca productos por texto en el catálogo público de Setareh. No cobra ni reserva inventario. Devuelve título, variantId, precio en moneda de la tienda y si se puede comprar.",
    inputSchema: { query: z.string().max(120).default(""), limit: z.number().int().min(1).max(25).default(10) },
  }, traced("agent.search_catalog", async ({ query, limit }) => result(await api(`/v1/catalog?merchantId=${encodeURIComponent(merchantId)}&query=${encodeURIComponent(query)}&limit=${limit}`))));

  server.registerTool("check_availability", {
    title: "Comprobar disponibilidad de una variante",
    description: "Reconsulta el inventario de una variante antes de cotizar. No reserva stock.",
    inputSchema: { variantId: z.string().startsWith("gid://shopify/ProductVariant/"), quantity: z.number().int().min(1).max(20).default(1) },
  }, traced("agent.check_availability", async ({ variantId, quantity }) => result(await api(`/v1/availability/${encodeURIComponent(variantId)}?quantity=${quantity}`))));

  server.registerTool("create_quote", {
    title: "Crear un quote de compra",
    description: "Crea un draft order real en Shopify y fija el total en USDC durante 10 minutos. Úsala sólo tras confirmación explícita de la persona. Devuelve quoteId, totales, vencimiento y el requestId que Setareh usa para correlacionar logs.",
    inputSchema: { items: z.array(itemSchema).min(1).max(10), email: z.string().email(), shippingAddress: addressSchema, userConfirmed: z.literal(true), requestId: z.string().regex(/^[A-Za-z0-9._-]{4,64}$/).optional() },
  }, traced("agent.create_quote", async ({ requestId, ...input }) => {
    const id = requestId ?? `eval-${Math.floor(Date.now() / 1000)}`;
    const response = await api("/v1/quotes", { method: "POST", body: JSON.stringify({ merchantId, ...input }), requestId: id });
    return result({ requestId: id, ...(response as Record<string, unknown>) });
  }));

  server.registerTool("pay_and_place_order", {
    title: "Pagar un quote con la wallet local y crear la orden",
    description: "Paga de verdad (USDC de testnet) con la wallet de agent.env: pide el desafío 402, verifica red, activo y el tope local AGENT_MAX_USDC, firma y crea la orden Shopify. Muestra el resumen y obtén confirmación inequívoca antes de llamarla. Si el quote ya fue pagado, Setareh responde 409 antes de que se firme nada; ese rechazo es el resultado esperado del reintento controlado.",
    inputSchema: { quoteId: z.string().uuid(), userConfirmed: z.literal(true) },
  }, traced("agent.pay_and_place_order", async ({ quoteId }) => {
    if (!options.env.secret) throw new Error("AGENT_STELLAR_PRIVATE_KEY no está definida en agent.env.");
    const maxUsdc = Number(options.env.maxUsdc ?? "");
    if (!Number.isFinite(maxUsdc) || maxUsdc <= 0) throw new Error("AGENT_MAX_USDC debe ser un número positivo en agent.env.");
    try {
      return result(await payQuote({ apiUrl: apiUrl(), quoteId, secret: options.env.secret, maxUsdc, fetchImpl }));
    } catch (error) {
      throw new Error(redactSecret(error instanceof Error ? error.message : String(error), options.env.secret));
    }
  }));

  server.registerTool("get_order_status", {
    title: "Consultar el estado de una compra",
    description: "Devuelve el estado público de un quote u orden: status, orden Shopify y hash de la transacción Stellar. Úsala tras pagar y tras el reintento para comprobar que sigue habiendo una sola orden y un solo hash.",
    inputSchema: { quoteId: z.string().min(1) },
  }, traced("agent.get_order_status", async ({ quoteId }) => result(await api(`/v1/orders/${encodeURIComponent(quoteId)}`))));

  server.registerTool("verify_payment", {
    title: "Verificar una transacción en Horizon testnet",
    description: "Consulta públicamente el hash de una transacción en Horizon (Stellar testnet) y devuelve successful, ledger y fecha. Cualquiera puede repetir esta consulta.",
    inputSchema: { transactionHash: z.string().regex(/^[0-9a-f]{64}$/i) },
  }, traced("agent.verify_payment", async ({ transactionHash }) => result(await horizonTransaction(transactionHash, { fetchImpl, horizonUrl: options.horizonUrl }))));

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadAgentEnv();
  log("info", "agent.mcp.started", { transport: "stdio", envFile: env.file, apiUrl: env.apiUrl ?? null });
  void serveStdio(() => createAgentMcpServer({ env }));
}
