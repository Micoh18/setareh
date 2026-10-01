import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";

const addressSchema = z.object({ address1: z.string().min(3), address2: z.string().optional(), city: z.string().min(2), province: z.string().optional(), country: z.string().min(2), zip: z.string().min(3), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional() });
const itemSchema = z.object({ variantId: z.string().startsWith("gid://shopify/ProductVariant/"), quantity: z.number().int().min(1).max(20) });

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

export function createMcpServer(commerce: CommerceService, config: SetarehConfig) {
  const server = new McpServer({ name: "setareh", version: "0.2.0" });
  server.registerTool("search_catalog", {
    title: "Buscar catálogo Shopify", description: "Busca variantes activas de Micohstore en Shopify. Esta operación no cobra ni reserva inventario.",
    inputSchema: { merchantId: z.string().default(config.merchantId), query: z.string().max(120).optional(), limit: z.number().int().min(1).max(25).default(10) },
  }, async ({ merchantId, query = "", limit }) => {
    if (merchantId !== config.merchantId) throw new Error("Merchant is not enabled.");
    return result(await commerce.searchCatalog(query, limit));
  });
  server.registerTool("check_availability", {
    title: "Comprobar disponibilidad", description: "Reconsulta el inventario Shopify antes de crear una cotización. No reserva stock.",
    inputSchema: { merchantId: z.string().default(config.merchantId), variantId: z.string().startsWith("gid://shopify/ProductVariant/"), quantity: z.number().int().min(1).max(20).default(1) },
  }, async ({ merchantId, variantId, quantity }) => {
    if (merchantId !== config.merchantId) throw new Error("Merchant is not enabled.");
    return result(await commerce.checkAvailability(variantId, quantity));
  });
  server.registerTool("create_quote", {
    title: "Crear cotización de compra", description: "Fija productos, dirección, total Shopify y monto USDC durante un tiempo limitado. Úsala sólo después de confirmación explícita de la persona.",
    inputSchema: { merchantId: z.string().default(config.merchantId), items: z.array(itemSchema).min(1).max(10), email: z.string().email(), shippingAddress: addressSchema, userConfirmed: z.literal(true) },
  }, async (input) => result(await commerce.createQuote(input)));
  server.registerTool("pay_and_place_order", {
    title: "Obtener el endpoint pagable de una cotización", description: "Devuelve el endpoint HTTP x402 que debe invocar la wallet del agente. El endpoint responde 402, liquida USDC Stellar testnet y crea una orden Shopify exactamente una vez.",
    inputSchema: { quoteId: z.string().uuid(), userConfirmed: z.literal(true) },
  }, async ({ quoteId }) => {
    const quote = commerce.getPayableQuote(quoteId);
    const path = `/v1/quotes/${quoteId}/pay-and-place`;
    const endpoint = config.baseUrl ? new URL(path, config.baseUrl).toString() : path;
    return result({ status: "payment_required", quoteId, endpoint, method: "POST", body: { userConfirmed: true }, payment: { network: config.stellarNetwork, asset: config.stellarAsset, amount: quote.totalUsdc, payTo: config.stellarMerchantAddress, expiresAt: quote.expiresAt }, disclosure: "The agent wallet must call this endpoint with x402. Setareh never receives the wallet private key." });
  });
  server.registerTool("get_order_status", {
    title: "Consultar orden Setareh", description: "Devuelve el estado de orden Shopify y un resumen seguro del settlement Stellar. Acepta el orderId de Setareh/Shopify o el quoteId si la compra está en revisión manual.",
    inputSchema: { orderId: z.string().min(1) },
  }, async ({ orderId }) => result(commerce.getOrderStatus(orderId)));
  return server;
}
