import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createHttpApp } from "./http.js";
import { captureLogs, correlationIdFrom, log, scrub, withCorrelation } from "./log.js";

const merchant = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const buyerSecret = Keypair.random().secret();
const sensitive = {
  email: "comprador.real@correo-privado.cl",
  street: "Pasaje Secreto 4321",
  phone: "+56 9 8765 4321",
  // Built at runtime so the fixture never looks like a real token to secret scanners.
  shopifyToken: ["shpat", "0123456789abcdef0123456789abcdef"].join("_"),
  signedBlob: "AAAAAgAAAAB".padEnd(400, "x9Q"),
};

test("scrub masks emails, Stellar secrets, Shopify tokens, credentials and encoded blobs", () => {
  const masked = scrub(`mail ${sensitive.email} seed ${buyerSecret} token ${sensitive.shopifyToken} auth Bearer abc.def.ghi blob ${sensitive.signedBlob}`);
  for (const secret of [sensitive.email, buyerSecret, sensitive.shopifyToken, "abc.def.ghi", sensitive.signedBlob.slice(0, 120)]) assert.ok(!masked.includes(secret), `leaked ${secret.slice(0, 12)}`);
  assert.match(masked, /\[email\].*\[stellar-secret\].*\[shopify-token\].*\[credential\].*\[blob\]/);
  // Public identifiers stay readable for diagnosis.
  assert.equal(scrub("tx 0f12600a192ef219137a667dde25631bc42bd26569dab066c256b88036d7d41f"), "tx 0f12600a192ef219137a667dde25631bc42bd26569dab066c256b88036d7d41f");
});

test("log keeps only allowlisted fields and tags lines with the active correlation ID", () => {
  const lines: string[] = [];
  const restore = captureLogs((line) => lines.push(line));
  try {
    withCorrelation("req-12345678", () => log("info", "test.event", { quoteId: "q1", email: sensitive.email, shippingAddress: { address1: sensitive.street }, message: `failed for ${sensitive.email}` }));
  } finally { restore(); }
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.correlationId, "req-12345678");
  assert.equal(entry.quoteId, "q1");
  assert.equal(entry.email, undefined);
  assert.equal(entry.shippingAddress, undefined);
  assert.equal(entry.message, "failed for [email]");
});

test("caller request IDs are reused only when they are short opaque tokens", () => {
  assert.equal(correlationIdFrom("agent-run-42:step-3"), "agent-run-42:step-3");
  for (const unsafe of ["short", "has spaces in it", `x${"y".repeat(200)}`, "<script>alert(1)</script>", undefined]) {
    assert.match(correlationIdFrom(unsafe), /^[0-9a-f-]{36}$/);
  }
});

test("a full paid purchase logs every step under its request ID without buyer data or payment secrets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-logs-"));
  const facilitator = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/supported") return response.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: {} }));
    if (request.url === "/settle") return response.end(JSON.stringify({ success: true, payer: "GBUYER", transaction: "ab".repeat(32), network: "stellar:testnet", amount: "100000000" }));
    response.statusCode = 404; response.end();
  });
  await new Promise<void>((resolve) => facilitator.listen(0, "127.0.0.1", resolve));
  const facilitatorAddress = facilitator.address();
  assert.ok(facilitatorAddress && typeof facilitatorAddress !== "string");
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: merchant, facilitatorUrl: `http://127.0.0.1:${facilitatorAddress.port}`, maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  const shopify = {
    domain: "micohstore.myshopify.com",
    getVariant: async () => ({ id: "gid://shopify/ProductVariant/1", inventoryQuantity: 5, inventoryPolicy: "DENY", availableForSale: true, product: { id: "gid://shopify/Product/1", title: "Gato mago", handle: "gato-mago", status: "ACTIVE" } }),
    createDraftOrder: async () => ({ id: "gid://shopify/DraftOrder/9", name: "#D9", invoiceUrl: null, status: "OPEN", totalPrice: "10000.00", currencyCode: "CLP" }),
    completeDraftOrder: async () => ({ id: "gid://shopify/Order/9", name: "#1009" }),
    // A Shopify error that echoes buyer data and a token must not reach the logs verbatim.
    attachPaymentEvidence: async () => { throw new Error(`metafield rejected for ${sensitive.email} using ${sensitive.shopifyToken}`); },
  };
  const service = new CommerceService(config, database, shopify as any);
  const appServer = createHttpApp(service).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.on("listening", resolve));
  const appAddress = appServer.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  const base = `http://127.0.0.1:${appAddress.port}`;
  const lines: string[] = [];
  const restore = captureLogs((line) => lines.push(line));
  try {
    const created = await fetch(`${base}/v1/quotes`, { method: "POST", headers: { "Content-Type": "application/json", "X-Request-Id": "agent-quote-0001" }, body: JSON.stringify({ merchantId: "micohstore", items: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }], email: sensitive.email, shippingAddress: { address1: sensitive.street, city: "Santiago", country: "CL", zip: "8320000", firstName: "Ana", lastName: "Privada", phone: sensitive.phone }, userConfirmed: true }) });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("x-request-id"), "agent-quote-0001");
    const { quoteId } = await created.json() as { quoteId: string };

    const endpoint = `${base}/v1/quotes/${quoteId}/pay-and-place`;
    const unpaid = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userConfirmed: true }) });
    const challenge = JSON.parse(Buffer.from(String(unpaid.headers.get("payment-required")), "base64url").toString("utf8"));
    const payment = Buffer.from(JSON.stringify({ x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: { transaction: sensitive.signedBlob, secret: buyerSecret } })).toString("base64url");
    const paid = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": payment, "X-Request-Id": "agent-pay-0002" }, body: JSON.stringify({ userConfirmed: true }) });
    assert.equal(paid.status, 500, "evidence attachment failure surfaces as an error and parks the quote");
    const body = await paid.text();
    assert.ok(!body.includes(sensitive.email) && !body.includes(sensitive.shopifyToken), "a 500 response must not echo upstream error text");
    assert.equal(paid.headers.get("x-request-id"), "agent-pay-0002");
    assert.equal(database.getQuote(quoteId)?.status, "manual_review");

    const output = lines.join("\n");
    for (const [name, secret] of Object.entries({ ...sensitive, buyerSecret, header: payment.slice(0, 60) })) assert.ok(!output.includes(secret), `log leaked ${name}`);
    assert.ok(!output.includes("Pasaje"), "log leaked part of the shipping address");

    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const forPay = entries.filter((entry) => entry.correlationId === "agent-pay-0002").map((entry) => `${entry.event}${entry.to ? `:${entry.to}` : ""}`);
    assert.deepEqual(forPay, ["quote.status:payment_submitted", "quote.status:payment_settled", "payment.settled", "quote.status:creating_shopify_order", "quote.status:manual_review", "http.error", "http.request"]);
    assert.ok(entries.some((entry) => entry.event === "http.request" && entry.route === "/v1/quotes/:id/pay-and-place" && entry.httpStatus === 402));
    assert.ok(entries.find((entry) => entry.event === "http.error")?.message === "metafield rejected for [email] using [shopify-token]");

    const events = database.getQuoteEvents(quoteId);
    assert.deepEqual(events.map((event) => event.to), ["quoted", "payment_required", "payment_submitted", "payment_settled", "creating_shopify_order", "manual_review"]);
    assert.equal(events[0].correlationId, "agent-quote-0001");
    assert.equal(events.at(-1)?.correlationId, "agent-pay-0002");
  } finally {
    restore();
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => facilitator.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
