import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { assertNoUserErrors, ShopifyClient, type ShopifyUserError } from "./shopify.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

type Variant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
  inventoryPolicy: "CONTINUE" | "DENY";
  availableForSale: boolean;
  product: { id: string; title: string; handle: string; status: string; featuredMedia?: { preview?: { image?: { url: string } } } | null };
};

const variantFields = `
  id title sku price inventoryQuantity inventoryPolicy availableForSale
  product { id title handle status featuredMedia { preview { image { url } } } }
`;

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

function availability(variant: Variant, quantity: number) {
  const remaining = variant.inventoryQuantity;
  if (variant.availableForSale && (remaining === null || remaining >= quantity)) {
    return { status: "READY_TO_SHIP", canPurchase: true, inventoryQuantity: remaining, disclosure: "Disponible para despacho según las condiciones de la tienda." };
  }
  if (variant.inventoryPolicy === "CONTINUE") {
    return { status: "MADE_TO_ORDER", canPurchase: true, inventoryQuantity: remaining, disclosure: "Se puede pedir por encargo. El agente debe confirmar plazo de elaboración antes de pagar." };
  }
  return { status: "OUT_OF_STOCK", canPurchase: false, inventoryQuantity: remaining, disclosure: "No disponible para compra ahora." };
}

const server = new McpServer({ name: "setareh-shopify", version: "0.1.0" });

server.registerTool(
  "search_catalog",
  {
    title: "Buscar catálogo Shopify",
    description: "Busca productos activos de Micohstore. Devuelve IDs de variantes que se requieren para comprobar disponibilidad o crear un borrador de orden.",
    inputSchema: { query: z.string().max(120).optional().describe("Términos de búsqueda, por ejemplo 'tortuga azul'."), limit: z.number().int().min(1).max(25).default(10) },
  },
  async ({ query = "", limit }) => {
    const shopify = ShopifyClient.fromEnvironment();
    const data = await shopify.graphql<{ productVariants: { nodes: Variant[] } }>(
      `query SearchVariants($first: Int!, $query: String!) { productVariants(first: $first, query: $query) { nodes { ${variantFields} } } }`,
      { first: limit, query: `status:active ${query}`.trim() },
    );
    return result({ store: shopify.domain, products: data.productVariants.nodes.map((variant) => ({ product: variant.product, variant: { id: variant.id, title: variant.title, sku: variant.sku, price: variant.price }, availability: availability(variant, 1) })) });
  },
);

server.registerTool(
  "check_availability",
  {
    title: "Comprobar disponibilidad",
    description: "Distingue inventario listo para envío, producto hecho por encargo y producto agotado. No reserva inventario.",
    inputSchema: { variantId: z.string().startsWith("gid://shopify/ProductVariant/"), quantity: z.number().int().min(1).max(20).default(1) },
  },
  async ({ variantId, quantity }) => {
    const shopify = ShopifyClient.fromEnvironment();
    const data = await shopify.graphql<{ productVariant: Variant | null }>(
      `query Variant($id: ID!) { productVariant(id: $id) { ${variantFields} } }`,
      { id: variantId },
    );
    if (!data.productVariant) throw new Error("No se encontró esa variante en Shopify.");
    return result({ product: data.productVariant.product, variantId, quantity, availability: availability(data.productVariant, quantity), checkedAt: new Date().toISOString() });
  },
);

server.registerTool(
  "create_draft_order",
  {
    title: "Crear borrador de orden Shopify",
    description: "Crea un borrador real en Shopify. Úsalo únicamente después de que la persona haya confirmado artículos, dirección y total. No completa la orden ni declara pago confirmado.",
    inputSchema: {
      items: z.array(z.object({ variantId: z.string().startsWith("gid://shopify/ProductVariant/"), quantity: z.number().int().min(1).max(20) })).min(1).max(10),
      email: z.string().email(),
      shippingAddress: z.object({ address1: z.string().min(3), address2: z.string().optional(), city: z.string().min(2), province: z.string().optional(), country: z.string().min(2), zip: z.string().min(3), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional() }),
      stellarTransactionHash: z.string().min(16).max(128).describe("Referencia de pago. En modo demo no se considera liquidación verificada."),
      userConfirmed: z.literal(true).describe("Debe ser true sólo después de que el usuario haya aprobado explícitamente la compra."),
    },
  },
  async ({ items, email, shippingAddress, stellarTransactionHash }) => {
    const shopify = ShopifyClient.fromEnvironment();
    const paymentMode = process.env.SETAREH_PAYMENT_MODE ?? "demo";
    if (paymentMode !== "demo") {
      throw new Error("El modo live de Stellar aún no está implementado. No se creará ninguna orden hasta verificar la transacción on-chain.");
    }
    const data = await shopify.graphql<{ draftOrderCreate: { draftOrder: { id: string; name: string; invoiceUrl: string | null; status: string; totalPrice: string; currencyCode: string } | null; userErrors: ShopifyUserError[] } }>(
      `mutation CreateDraft($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id name invoiceUrl status totalPrice currencyCode } userErrors { field message } } }`,
      {
        input: {
          email,
          lineItems: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
          shippingAddress,
          tags: ["setareh", "setareh:demo-payment"],
          note: `Setareh payment reference (unverified demo): ${stellarTransactionHash}`,
          customAttributes: [{ key: "setareh_payment_reference", value: stellarTransactionHash }],
        },
      },
    );
    assertNoUserErrors(data.draftOrderCreate.userErrors, "No se pudo crear el borrador de orden");
    const draft = data.draftOrderCreate.draftOrder;
    if (!draft) throw new Error("Shopify no devolvió un borrador de orden.");
    return result({ paymentStatus: "UNVERIFIED_DEMO", warning: "Es un borrador real de Shopify, no una orden pagada. No informes al usuario que el pago fue confirmado.", draftOrder: draft });
  },
);

server.registerTool(
  "get_draft_order_status",
  {
    title: "Consultar estado de borrador",
    description: "Consulta el estado actual de un borrador creado por Setareh.",
    inputSchema: { draftOrderId: z.string().startsWith("gid://shopify/DraftOrder/") },
  },
  async ({ draftOrderId }) => {
    const shopify = ShopifyClient.fromEnvironment();
    const data = await shopify.graphql<{ node: { id: string; name: string; status: string; invoiceUrl: string | null; totalPrice: string; currencyCode: string; order: { id: string; name: string } | null } | null }>(
      `query Draft($id: ID!) { node(id: $id) { ... on DraftOrder { id name status invoiceUrl totalPrice currencyCode order { id name } } } }`,
      { id: draftOrderId },
    );
    if (!data.node) throw new Error("No se encontró ese borrador de orden.");
    return result(data.node);
  },
);

console.error("Setareh Shopify MCP running on stdio");
void serveStdio(() => server);
