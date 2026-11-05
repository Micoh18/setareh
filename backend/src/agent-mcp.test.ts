import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Keypair } from "@stellar/stellar-sdk";
import { createAgentMcpServer } from "./agent-mcp.js";
import { captureLogs } from "./log.js";

const API = "https://api.example.test";

function fakeApi(calls: Array<{ method: string; path: string; requestId: string | null }>) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, requestId: new Headers(init?.headers).get("x-request-id") });
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    if (url.pathname === "/v1/catalog") return json(200, { merchantId: "micohstore", products: [{ product: { title: "Prueba evaluador Setareh" }, variant: { id: "gid://shopify/ProductVariant/1", price: "3000" }, availability: { canPurchase: true } }] });
    if (url.pathname === "/v1/quotes" && method === "POST") return json(201, { quoteId: "11111111-1111-4111-8111-111111111111", status: "quoted", payment: { amount: "3.0000000" } });
    if (url.pathname.endsWith("/pay-and-place")) return json(409, { error: { code: "request_rejected", message: "Quote is not payable in status created." } });
    if (url.pathname.startsWith("/v1/orders/")) return json(200, { status: "created", quoteId: url.pathname.split("/").pop() });
    return json(404, { error: { code: "not_found" } });
  };
}

test("the buyer-side MCP exposes the evaluator tools, relays the request id and reports a repeated payment as rejected before signing", async () => {
  const calls: Array<{ method: string; path: string; requestId: string | null }> = [];
  const restore = captureLogs(() => undefined);
  const secret = Keypair.random().secret();
  const server = createAgentMcpServer({ env: { file: "agent.env", apiUrl: API, maxUsdc: "5", secret }, fetchImpl: fakeApi(calls) as typeof fetch });
  const client = new Client({ name: "evaluator-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["check_availability", "check_setup", "create_quote", "get_order_status", "pay_and_place_order", "search_catalog", "verify_payment"]);
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /mismo quoteId/, "the pilot playbook tells the agent to retry with the same quote");
    assert.match(instructions, /06-reintento\.json/, "the evidence file names live in the server, not in the person's message");
    assert.match(tools.find((tool) => tool.name === "pay_and_place_order")?.description ?? "", /pagar otra vez/);

    const catalog = (await client.callTool({ name: "search_catalog", arguments: { query: "evaluador" } })).structuredContent as { products: Array<{ product: { title: string } }> };
    assert.equal(catalog.products[0]?.product.title, "Prueba evaluador Setareh");

    const quote = (await client.callTool({ name: "create_quote", arguments: { items: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }], email: "evaluacion@example.com", shippingAddress: { firstName: "Prueba", lastName: "Setareh", address1: "Calle de prueba 123", city: "Santiago", country: "CL", zip: "8320000" }, userConfirmed: true, requestId: "eval-test-1" } })).structuredContent as { requestId: string; quoteId: string };
    assert.equal(quote.requestId, "eval-test-1");
    assert.equal(calls.find((call) => call.path === "/v1/quotes")?.requestId, "eval-test-1");

    const payment = (await client.callTool({ name: "pay_and_place_order", arguments: { quoteId: quote.quoteId, userConfirmed: true } })).structuredContent as { outcome: string; httpStatus: number; message: string; meaning: string };
    assert.equal(payment.outcome, "rejected_before_payment");
    assert.equal(payment.httpStatus, 409);
    assert.match(payment.message, /not payable/);
    assert.match(payment.meaning, /no se movió USDC ni se creó otra orden/, "a plain-language reading travels with the raw 409");
    assert.equal(calls.filter((call) => call.path.endsWith("/pay-and-place")).length, 1, "a non-402 answer must not trigger a signed retry");

    const serialized = JSON.stringify(await client.callTool({ name: "check_setup", arguments: {} }));
    assert.ok(!serialized.includes(secret), "the secret key never leaves the process");
  } finally {
    restore();
    await client.close();
    await server.close();
  }
});

test("the stdio entry point used by .mcp.json starts from the repository root and lists its tools", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-agent-mcp-"));
  const envFile = join(directory, "agent.env");
  writeFileSync(envFile, `SETAREH_API_URL=${API}\nAGENT_MAX_USDC=5\n`);
  const repoRoot = join(process.cwd(), "..");
  const transport = new StdioClientTransport({ command: process.execPath, args: ["backend/node_modules/tsx/dist/cli.mjs", "backend/src/agent-mcp.ts"], cwd: repoRoot, env: { ...process.env, SETAREH_AGENT_ENV_FILE: envFile } as Record<string, string>, stderr: "ignore" });
  const client = new Client({ name: "evaluator-stdio-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === "pay_and_place_order"));
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
