import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createMcpServer } from "./mcp.js";

test("an MCP client discovers Setareh tools and searches the Shopify catalog", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-mcp-"));
  const config: SetarehConfig = {
    databasePath: join(directory, "setareh.db"), merchantId: "micohstore", merchantName: "Micohstore",
    stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    facilitatorUrl: "https://example.test", baseUrl: "http://127.0.0.1:4020", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001,
  };
  const database = new SetarehDatabase(config.databasePath);
  const commerce = new CommerceService(config, database, {
    domain: "micohstore.myshopify.com",
    searchVariants: async () => [{ id: "gid://shopify/ProductVariant/1", title: "Lila", sku: "LILA", price: "10000.00", inventoryQuantity: 1, inventoryPolicy: "DENY", availableForSale: true, product: { id: "gid://shopify/Product/1", title: "Regalo lila", handle: "regalo-lila", status: "ACTIVE" } }],
  } as any);
  const server = createMcpServer(commerce, config);
  const client = new Client({ name: "setareh-agent-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["check_availability", "create_quote", "get_order_status", "pay_and_place_order", "search_catalog"]);
    const response = await client.callTool({ name: "search_catalog", arguments: { merchantId: "micohstore", query: "lila", limit: 1 } });
    const catalog = response.structuredContent as { products: Array<{ product: { title: string } }> };
    assert.equal(catalog.products[0]?.product.title, "Regalo lila");
  } finally {
    await client.close();
    await server.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
