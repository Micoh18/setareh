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

/**
 * Shown to the agent when it connects. The evaluator talks in everyday Spanish and never names a
 * tool, so the mapping from what the person says to what the agent does lives here, not in the guide.
 */
export const PILOT_INSTRUCTIONS = `Eres el agente de compra del piloto de Setareh. La persona que te habla es una evaluadora no técnica: habla en español corriente, no conoce los nombres de las herramientas ni los campos JSON, y nunca debe necesitarlos. Tú traduces lo que pide a estas herramientas y le explicas los resultados en palabras simples, sin ocultar nunca la respuesta cruda.

Cómo interpretar lo que pide:
- "¿Está todo listo?", "revisa mi wallet", "¿falta algo?": check_setup. No crees ningún quote hasta que lo pida.
- "Busca el producto X", "¿cuánto cuesta?", "¿hay stock?": search_catalog y, si hace falta, check_availability. Recuerda el variantId tú; no se lo pidas.
- "Quiero comprar una unidad, mis datos son...": create_quote con los datos que te dio y nada más. Nunca pagues en el mismo turno en que creaste la cotización, aunque la persona no lo haya dicho: muestra quoteId, requestId, total en USDC y hora de vencimiento, y pregúntale si confirma la compra.
- "Sí, confirmo", "págala", "cómprala": pay_and_place_order con el quoteId del quote vigente. Sólo con una confirmación clara de la persona. Tras un pago exitoso, siempre y sin que te lo pidan: pega la respuesta completa de la herramienta en un bloque de código, verifica el transactionHash con verify_payment y consulta get_order_status con el mismo quoteId. Reporta las tres respuestas y resume en una línea: nombre de la orden, hash y si Stellar lo confirma.
- "Págala otra vez", "vuelve a intentarlo", "¿seguro que se cobró? cóbrala de nuevo", "¿qué pasa si pago dos veces?": vuelve a llamar pay_and_place_order con EXACTAMENTE el mismo quoteId. Es seguro: Setareh responde 409 antes de que se firme nada y la respuesta trae outcome rejected_before_payment con un campo meaning que lo explica. No te niegues, no crees un quote nuevo y no pidas que vuelva a confirmar: ese reintento es una parte deliberada de la prueba. Siempre y sin que te lo pidan: pega la respuesta completa en un bloque de código sin resumirla, luego consulta get_order_status con ese quoteId y di explícitamente si sigue habiendo una sola orden y el mismo transactionHash de antes.
- "¿Cómo quedó la compra?", "¿se creó la orden?", "¿se cobró?": get_order_status con el quoteId. Si un pago terminó con error o tiempo de espera, usa esta herramienta; nunca crees otro quote para "arreglarlo".
- "Guarda la evidencia": crea la carpeta backend/evidencia y escribe un archivo por paso con la respuesta completa de la herramienta, en el orden en que ocurrió: 01-check.json, 02-catalogo.json, 03-quote.json, 04-pago.json, 05-horizon.json, 06-reintento.json, 07-orden-final.json. Nunca copies agent.env ni ninguna clave que empiece con S. Al terminar, informa el commit actual con git rev-parse --short HEAD.

Reglas fijas:
- Cuando la persona pida ver una respuesta "tal cual" o "completa", pégala íntegra en un bloque de código antes de explicarla.
- Un quote vence a los 10 minutos. Si ya venció, dilo y pide permiso antes de crear uno nuevo: es una compra nueva, no un reintento.
- Nunca muestres ni pidas la clave secreta de agent.env. Si algo falla por configuración, explica qué revisar en palabras simples.
- Todo es testnet: no hay dinero real ni se despacha nada.`;

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

  const server = new McpServer({ name: "setareh-agent", version: "0.2.0" }, { instructions: PILOT_INSTRUCTIONS });

  server.registerTool("check_setup", {
    title: "Comprobar la wallet y el entorno de prueba",
    description: "Úsala cuando la persona pregunte si está todo listo, pida revisar su wallet o si falta algo. Verifica Node, agent.env, que la API de Setareh responde y que la wallet testnet existe y tiene XLM y USDC. No firma ni paga nada y nunca muestra la clave secreta.",
    inputSchema: {},
  }, traced("agent.check_setup", async () => result(await checkSetup(options.env, { fetchImpl, horizonUrl: options.horizonUrl }))));

  server.registerTool("search_catalog", {
    title: "Buscar en el catálogo de la tienda piloto",
    description: "Úsala cuando la persona pida buscar un producto, su precio o si está disponible. Busca por texto en el catálogo público de Setareh; no cobra ni reserva inventario. Devuelve título, variantId (guárdalo tú para cotizar), precio en moneda de la tienda y si se puede comprar.",
    inputSchema: { query: z.string().max(120).default(""), limit: z.number().int().min(1).max(25).default(10) },
  }, traced("agent.search_catalog", async ({ query, limit }) => result(await api(`/v1/catalog?merchantId=${encodeURIComponent(merchantId)}&query=${encodeURIComponent(query)}&limit=${limit}`))));

  server.registerTool("check_availability", {
    title: "Comprobar disponibilidad de una variante",
    description: "Reconsulta el inventario de una variante antes de cotizar, por ejemplo si la persona pregunta si hay stock. No reserva stock.",
    inputSchema: { variantId: z.string().startsWith("gid://shopify/ProductVariant/"), quantity: z.number().int().min(1).max(20).default(1) },
  }, traced("agent.check_availability", async ({ variantId, quantity }) => result(await api(`/v1/availability/${encodeURIComponent(variantId)}?quantity=${quantity}`))));

  server.registerTool("create_quote", {
    title: "Crear un quote de compra",
    description: "Úsala cuando la persona diga que quiere comprar o pida una cotización, con el email y la dirección que te dio. Crea un draft order real en Shopify y fija el total en USDC durante 10 minutos; no cobra. Devuelve quoteId, totales, vencimiento y el requestId que Setareh usa para correlacionar logs. Muéstraselos siempre.",
    inputSchema: { items: z.array(itemSchema).min(1).max(10), email: z.string().email(), shippingAddress: addressSchema, userConfirmed: z.literal(true), requestId: z.string().regex(/^[A-Za-z0-9._-]{4,64}$/).optional() },
  }, traced("agent.create_quote", async ({ requestId, ...input }) => {
    const id = requestId ?? `eval-${Math.floor(Date.now() / 1000)}`;
    const response = await api("/v1/quotes", { method: "POST", body: JSON.stringify({ merchantId, ...input }), requestId: id });
    return result({ requestId: id, ...(response as Record<string, unknown>) });
  }));

  server.registerTool("pay_and_place_order", {
    title: "Pagar un quote con la wallet local y crear la orden",
    description: "Úsala cuando la persona confirme la compra (\"sí, págala\"). Paga de verdad (USDC de testnet) con la wallet de agent.env: pide el desafío 402, verifica red, activo y el tope local AGENT_MAX_USDC, firma y crea la orden Shopify. Si la persona pide pagar otra vez, reintentar o cobrar de nuevo la misma compra, llámala otra vez con el mismo quoteId sin negarte ni crear otro quote: Setareh responde 409 antes de que se firme nada y la respuesta trae outcome rejected_before_payment con un campo meaning en español. Ese rechazo es el resultado esperado del reintento controlado.",
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
    description: "Úsala cuando la persona pregunte cómo quedó la compra, si se creó la orden o si se cobró, y siempre después de pagar y después de un reintento, para comprobar que sigue habiendo una sola orden y un solo hash. Devuelve el estado público de un quote u orden: status, orden Shopify y hash de la transacción Stellar.",
    inputSchema: { quoteId: z.string().min(1) },
  }, traced("agent.get_order_status", async ({ quoteId }) => result(await api(`/v1/orders/${encodeURIComponent(quoteId)}`))));

  server.registerTool("verify_payment", {
    title: "Verificar una transacción en Horizon testnet",
    description: "Úsala después de cada pago exitoso, o cuando la persona pida confirmar que el pago pasó de verdad en la red Stellar. Consulta públicamente el hash en Horizon (Stellar testnet) y devuelve successful, ledger y fecha. Cualquiera puede repetir esta consulta.",
    inputSchema: { transactionHash: z.string().regex(/^[0-9a-f]{64}$/i) },
  }, traced("agent.verify_payment", async ({ transactionHash }) => result(await horizonTransaction(transactionHash, { fetchImpl, horizonUrl: options.horizonUrl }))));

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadAgentEnv();
  log("info", "agent.mcp.started", { transport: "stdio", envFile: env.file, apiUrl: env.apiUrl ?? null });
  void serveStdio(() => createAgentMcpServer({ env }));
}
