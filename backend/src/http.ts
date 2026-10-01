import express, { type ErrorRequestHandler } from "express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import * as z from "zod/v4";
import { CommerceService } from "./commerce.js";

const addressSchema = z.object({ address1: z.string().min(3), address2: z.string().optional(), city: z.string().min(2), province: z.string().optional(), country: z.string().min(2), zip: z.string().min(3), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional() });
const quoteSchema = z.object({ merchantId: z.string().min(1), items: z.array(z.object({ variantId: z.string().startsWith("gid://shopify/ProductVariant/"), quantity: z.number().int().min(1).max(20) })).min(1).max(10), email: z.string().email(), shippingAddress: addressSchema, userConfirmed: z.literal(true) });

function quoteIdFromPath(path: string) {
  const match = /^\/v1\/quotes\/([^/]+)\/pay-and-place$/.exec(path);
  if (!match) throw new Error("Unable to resolve quote for this payment route.");
  return match[1];
}

function transactionHash(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["transactionHash", "txHash", "transaction"]) if (typeof record[key] === "string") return record[key];
  for (const child of Object.values(record)) { const found = transactionHash(child); if (found) return found; }
  return undefined;
}

export function createHttpApp(service: CommerceService) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_request: any, response: any) => response.json({ ok: true, service: "setareh", network: service.config.stellarNetwork }));
  app.get("/v1/merchants/:merchantId", (request: any, response: any) => {
    if (request.params.merchantId !== service.config.merchantId) return response.status(404).json({ error: { code: "merchant_not_found" } });
    return response.json({ id: service.config.merchantId, name: service.config.merchantName, shopDomain: service.shopify.domain, payment: { network: service.config.stellarNetwork, asset: service.config.stellarAsset } });
  });
  app.get("/v1/catalog", async (request: any, response: any, next: any) => { try { response.json(await service.searchCatalog(String(request.query.query ?? ""), Math.min(Math.max(Number(request.query.limit ?? 10), 1), 25))); } catch (error) { next(error); } });
  app.get("/v1/availability/:variantId", async (request: any, response: any, next: any) => { try { response.json(await service.checkAvailability(request.params.variantId, Math.min(Math.max(Number(request.query.quantity ?? 1), 1), 20))); } catch (error) { next(error); } });
  app.post("/v1/quotes", async (request: any, response: any, next: any) => { try { response.status(201).json(await service.createQuote(quoteSchema.parse(request.body))); } catch (error) { next(error); } });

  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: service.config.facilitatorUrl }))
    .register(service.config.stellarNetwork, new ExactStellarScheme())
    .onBeforeSettle(async (context) => {
      const path = (context.transportContext as { request?: { path?: string } } | undefined)?.request?.path;
      if (path) service.markPaymentSubmitted(quoteIdFromPath(path));
    })
    .onAfterSettle(async (context) => {
      if (context.phase !== "before-handler") return;
      const path = (context.transportContext as { request?: { path?: string } } | undefined)?.request?.path;
      if (!path) return;
      const quoteId = quoteIdFromPath(path);
      service.recordSettlement(quoteId, { payload: context.paymentPayload, receipt: context.result, transactionHash: transactionHash(context.result) });
    })
    .onSettleFailure(async (context) => {
      const path = (context.transportContext as { request?: { path?: string } } | undefined)?.request?.path;
      if (path) service.markPaymentFailed(quoteIdFromPath(path));
    });
  const routes = {
    "POST /v1/quotes/:quoteId/pay-and-place": {
      accepts: { scheme: "exact", price: (context: { adapter: { getPath(): string } }) => `$${service.getPayableQuote(quoteIdFromPath(context.adapter.getPath())).totalUsdc}`, network: service.config.stellarNetwork, payTo: service.config.stellarMerchantAddress, maxTimeoutSeconds: 60, extra: { paymentFlow: "upfront" } },
      description: "Settle a fixed Setareh quote in USDC before creating its Shopify order.",
    },
  };
  app.use("/v1/quotes/:quoteId/pay-and-place", (request: any, _response: any, next: any) => {
    try { service.getPayableQuote(request.params.quoteId); next(); } catch (error) { next(error); }
  });
  app.use(paymentMiddleware(routes, resourceServer));
  app.post("/v1/quotes/:quoteId/pay-and-place", async (request: any, response: any, next: any) => {
    try {
      const body = z.object({ userConfirmed: z.literal(true) }).parse(request.body);
      response.json(await service.placePaidOrder(request.params.quoteId, body.userConfirmed));
    } catch (error) { next(error); }
  });
  app.get("/v1/orders/:orderId", (request: any, response: any, next: any) => { try { response.json(service.getOrderStatus(request.params.orderId)); } catch (error) { next(error); } });

  const errors: ErrorRequestHandler = (error: unknown, _request: any, response: any, _next: any) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = error instanceof z.ZodError ? 400 : /not found/i.test(message) ? 404 : /expired|not available|limit|not payable/i.test(message) ? 409 : 500;
    response.status(status).json({ error: { code: status === 500 ? "internal_error" : "request_rejected", message } });
  };
  app.use(errors);
  return app;
}
