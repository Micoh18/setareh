import express, { type ErrorRequestHandler } from "express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import * as z from "zod/v4";
import { CommerceService } from "./commerce.js";
import { DEFAULT_QUOTE_RATE_LIMITS, SlidingWindowLimiter, clientKey, type QuoteRateLimits } from "./rate-limit.js";
import { SHOPIFY_CALLBACK_PATH, SHOPIFY_INSTALL_PATH, SHOPIFY_UNINSTALLED_WEBHOOK_PATH, ShopifyOAuth, ShopifyOAuthError, isValidShopDomain, verifyQueryHmac, verifyWebhookHmac } from "./shopify-oauth.js";

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

function queryParams(request: { originalUrl: string }) {
  return new URL(request.originalUrl, "http://setareh.invalid").searchParams;
}

function installPage(title: string, message: string) {
  // Only static strings and validated *.myshopify.com domains reach this template.
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.4rem">${title}</h1><p>${message}</p></body></html>`;
}

function registerShopifyOAuthRoutes(app: ReturnType<typeof express>, oauth: ShopifyOAuth) {
  // Shopify signs the raw webhook body, so this route must read it before express.json() parses it.
  app.post(SHOPIFY_UNINSTALLED_WEBHOOK_PATH, express.raw({ type: "*/*", limit: "64kb" }), (request: any, response: any) => {
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (!verifyWebhookHmac(body, request.get("x-shopify-hmac-sha256"), oauth.clientSecret)) return response.status(401).json({ error: { code: "invalid_hmac" } });
    const shop = request.get("x-shopify-shop-domain");
    if (!isValidShopDomain(shop)) return response.status(400).json({ error: { code: "invalid_shop" } });
    oauth.revoke(shop);
    return response.status(200).json({ ok: true });
  });

  app.get(SHOPIFY_INSTALL_PATH, (request: any, response: any) => {
    const params = queryParams(request);
    const shop = params.get("shop");
    if (!isValidShopDomain(shop)) return response.status(400).type("html").send(installPage("Tienda no válida", "Abre la instalación con el dominio *.myshopify.com de tu tienda."));
    // Launches from Shopify Admin are signed; a forged signature is rejected. Unsigned links still require consent inside Shopify.
    if (params.has("hmac") && !verifyQueryHmac(params, oauth.clientSecret)) return response.status(401).type("html").send(installPage("Solicitud no válida", "La firma de Shopify no coincide. Vuelve a abrir la app desde Shopify Admin."));
    return response.redirect(302, oauth.beginInstall(shop));
  });

  app.get(SHOPIFY_CALLBACK_PATH, async (request: any, response: any) => {
    try {
      const result = await oauth.completeInstall(queryParams(request));
      return response.status(200).type("html").send(installPage("Setareh quedó conectado", `La tienda ${result.shop} autorizó a Setareh. Puedes cerrar esta ventana y avisar al equipo de Setareh.`));
    } catch (error) {
      const status = error instanceof ShopifyOAuthError ? error.status : 500;
      const code = error instanceof ShopifyOAuthError ? error.code : "internal_error";
      console.error(`Shopify OAuth callback rejected: ${code}`);
      return response.status(status).type("html").send(installPage("No se pudo completar la instalación", `Shopify no confirmó la autorización (${code}). Vuelve a abrir el enlace de instalación.`));
    }
  });
}

export function createHttpApp(service: CommerceService, options: { shopifyOAuth?: ShopifyOAuth; quoteRateLimits?: QuoteRateLimits } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Every quote creates a real Shopify draft order, so quote creation is throttled per client and globally.
  const limits = options.quoteRateLimits ?? service.config.quoteRateLimits ?? DEFAULT_QUOTE_RATE_LIMITS;
  const perClient = new SlidingWindowLimiter(limits.perClientPerHour, 3_600_000);
  const global = new SlidingWindowLimiter(limits.globalPerHour, 3_600_000);
  const throttleQuotes = (request: any, response: any, next: any) => {
    if (!perClient.allow(clientKey(request)) || !global.allow("global")) {
      response.set("Retry-After", "3600");
      return response.status(429).json({ error: { code: "rate_limited", message: "Too many quotes were requested. Retry later." } });
    }
    return next();
  };
  if (options.shopifyOAuth) registerShopifyOAuthRoutes(app, options.shopifyOAuth);
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_request: any, response: any) => response.json({ ok: true, service: "setareh", network: service.config.stellarNetwork }));
  app.get("/v1/merchants/:merchantId", (request: any, response: any) => {
    if (request.params.merchantId !== service.config.merchantId) return response.status(404).json({ error: { code: "merchant_not_found" } });
    return response.json({ id: service.config.merchantId, name: service.config.merchantName, shopDomain: service.shopify.domain, payment: { network: service.config.stellarNetwork, asset: service.config.stellarAsset } });
  });
  app.get("/v1/catalog", async (request: any, response: any, next: any) => { try { response.json(await service.searchCatalog(String(request.query.query ?? ""), Math.min(Math.max(Number(request.query.limit ?? 10), 1), 25))); } catch (error) { next(error); } });
  app.get("/v1/availability/:variantId", async (request: any, response: any, next: any) => { try { response.json(await service.checkAvailability(request.params.variantId, Math.min(Math.max(Number(request.query.quantity ?? 1), 1), 20))); } catch (error) { next(error); } });
  app.post("/v1/quotes", throttleQuotes, async (request: any, response: any, next: any) => { try { response.status(201).json(await service.createQuote(quoteSchema.parse(request.body))); } catch (error) { next(error); } });

  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: service.config.facilitatorUrl }))
    .register(service.config.stellarNetwork, new ExactStellarScheme())
    // x402 only logs exceptions thrown by settle hooks, so a refusal must be returned as an abort.
    .onBeforeSettle(async (context) => {
      const path = (context.transportContext as { request?: { path?: string } } | undefined)?.request?.path;
      try {
        if (!path) throw new Error("Unable to resolve quote for this payment route.");
        service.markPaymentSubmitted(quoteIdFromPath(path));
        return undefined;
      } catch (error) {
        return { abort: true as const, reason: "quote_not_payable", message: error instanceof Error ? error.message : "Quote is not payable." };
      }
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
