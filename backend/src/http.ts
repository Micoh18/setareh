import express, { type ErrorRequestHandler } from "express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { FacilitatorResponseError, FacilitatorTimeoutError, SettleError } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { DEFAULT_TESTNET_HORIZON_URL } from "@x402/stellar";
import * as z from "zod/v4";
import { authenticateAgentKey } from "./agent-keys.js";
import { CommerceError, CommerceService } from "./commerce.js";
import type { AgentKeyRecord } from "./db.js";
import { correlationIdFrom, errorMessage, log, withCorrelation } from "./log.js";
import { SHOPIFY_SETUP_PATH, consumeSetupToken, createRecipientChecker, createSetupLink, echoableRecipient, peekSetupToken, setupFormPage, setupMessagePage, validateSetupForm, type RecipientChecker } from "./merchant-setup.js";
import { DEFAULT_QUOTE_RATE_LIMITS, SlidingWindowLimiter, clientKey, type QuoteRateLimits } from "./rate-limit.js";
import { SHOPIFY_CALLBACK_PATH, SHOPIFY_INSTALL_PATH, SHOPIFY_UNINSTALLED_WEBHOOK_PATH, ShopifyOAuth, ShopifyOAuthError, isValidShopDomain, verifyQueryHmac, verifyWebhookHmac } from "./shopify-oauth.js";
import { lastProtocolCheck } from "./stellar-preflight.js";

const addressSchema = z.object({ address1: z.string().min(3), address2: z.string().optional(), city: z.string().min(2), province: z.string().optional(), country: z.string().min(2), zip: z.string().min(3), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional() });
// merchantId is optional: with an agent key the store comes from the key, and naming another one is refused.
const quoteSchema = z.object({ merchantId: z.string().min(1).optional(), items: z.array(z.object({ variantId: z.string().startsWith("gid://shopify/ProductVariant/"), quantity: z.number().int().min(1).max(20) })).min(1).max(10), email: z.string().email(), shippingAddress: addressSchema, userConfirmed: z.literal(true) });

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

/** Reasons a facilitator may return even though a transaction reached, or may still reach, the network. */
const AMBIGUOUS_SETTLE_REASONS = new Set(["settlement_pending", "unexpected_settle_error"]);

/**
 * Only an explicit facilitator rejection with no submitted transaction proves nothing was charged.
 * Timeouts, transport errors and malformed responses leave the outcome unknown.
 */
export function classifySettlementFailure(error: unknown): { definite: boolean; reason: string; transaction?: string } {
  if (error instanceof SettleError) {
    const reason = error.errorReason || "settle_failed";
    const transaction = typeof error.transaction === "string" && error.transaction ? error.transaction : undefined;
    return { definite: !transaction && !AMBIGUOUS_SETTLE_REASONS.has(reason), reason, transaction };
  }
  if (error instanceof FacilitatorTimeoutError) return { definite: false, reason: "facilitator_timeout" };
  if (error instanceof FacilitatorResponseError) return { definite: false, reason: "facilitator_invalid_response" };
  const message = error instanceof Error ? error.message : "";
  if (/^Facilitator settle failed \(\d+\)/.test(message)) return { definite: false, reason: "facilitator_http_error" };
  if (error instanceof TypeError) return { definite: false, reason: "facilitator_unreachable" };
  return { definite: false, reason: "facilitator_error" };
}

const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

/** Request path with identifiers collapsed, so routes aggregate and no free-form path text is logged. */
function routeLabel(path: string) {
  return path.replace(UUID_SEGMENT, "/:id").split("/").map((segment) => (segment.length > 40 || segment.includes("%") ? ":param" : segment)).join("/");
}

function queryParams(request: { originalUrl: string }) {
  return new URL(request.originalUrl, "http://setareh.invalid").searchParams;
}

function installPage(title: string, message: string) {
  // Only static strings and validated *.myshopify.com domains reach this template.
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.4rem">${title}</h1><p>${message}</p></body></html>`;
}

/** The setup page carries a single-use secret in its URL and form: keep it out of caches, referrers and frames. */
function setupHeaders(response: any) {
  response.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
  return response.type("html");
}

function registerShopifyOAuthRoutes(app: ReturnType<typeof express>, oauth: ShopifyOAuth, service: CommerceService, checkRecipient: RecipientChecker) {
  // Shopify signs the raw webhook body, so this route must read it before express.json() parses it.
  app.post(SHOPIFY_UNINSTALLED_WEBHOOK_PATH, express.raw({ type: "*/*", limit: "64kb" }), (request: any, response: any) => {
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const shop = request.get("x-shopify-shop-domain");
    // The header only picks which app's secret must have signed the body; an unsigned or mis-signed request stops here.
    if (!verifyWebhookHmac(body, request.get("x-shopify-hmac-sha256"), oauth.secretFor(isValidShopDomain(shop) ? shop : ""))) return response.status(401).json({ error: { code: "invalid_hmac" } });
    if (!isValidShopDomain(shop)) return response.status(400).json({ error: { code: "invalid_shop" } });
    oauth.revoke(shop);
    // The store stops taking new quotes at once; payments already in flight are still finished.
    const merchant = service.db.getMerchantByShop(shop);
    if (merchant) { service.db.setMerchantStatus(merchant.id, "disabled"); log("warn", "merchant.disabled", { merchantId: merchant.id, reason: "app_uninstalled" }); }
    return response.status(200).json({ ok: true });
  });

  app.get(SHOPIFY_INSTALL_PATH, (request: any, response: any) => {
    const params = queryParams(request);
    const shop = params.get("shop");
    if (!isValidShopDomain(shop)) return response.status(400).type("html").send(installPage("Tienda no válida", "Abre la instalación con el dominio *.myshopify.com de tu tienda."));
    // Launches from Shopify Admin are signed; a forged signature is rejected. Unsigned links still require consent inside Shopify.
    if (params.has("hmac") && !verifyQueryHmac(params, oauth.secretFor(shop))) return response.status(401).type("html").send(installPage("Solicitud no válida", "La firma de Shopify no coincide. Vuelve a abrir la app desde Shopify Admin."));
    return response.redirect(302, oauth.beginInstall(shop));
  });

  app.get(SHOPIFY_CALLBACK_PATH, async (request: any, response: any) => {
    try {
      const result = await oauth.completeInstall(queryParams(request));
      // The consent just given in Shopify is what authorizes this person to set where the store's money goes.
      service.db.registerInstalledMerchant(result.shop);
      response.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      return response.redirect(303, createSetupLink(service.db, result.shop));
    } catch (error) {
      const status = error instanceof ShopifyOAuthError ? error.status : 500;
      const code = error instanceof ShopifyOAuthError ? error.code : "internal_error";
      log("warn", "shopify.oauth.callback_rejected", { errorCode: code });
      return response.status(status).type("html").send(installPage("No se pudo completar la instalación", `Shopify no confirmó la autorización (${code}). Vuelve a abrir el enlace de instalación.`));
    }
  });

  const expired = (response: any) => setupHeaders(response).status(410).send(setupMessagePage("El enlace ya no sirve", "Este enlace de configuración venció o ya se usó. Vuelve a abrir la app desde el administrador de Shopify para obtener uno nuevo."));

  app.get(SHOPIFY_SETUP_PATH, (request: any, response: any) => {
    const token = queryParams(request).get("token");
    const pending = peekSetupToken(service.db, token);
    const merchant = pending ? service.db.getMerchantByShop(pending.shop) : undefined;
    if (!pending || !merchant) return expired(response);
    return setupHeaders(response).status(200).send(setupFormPage({ token: token!, merchant }));
  });

  app.post(SHOPIFY_SETUP_PATH, express.urlencoded({ extended: false, limit: "8kb" }), async (request: any, response: any) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const pending = peekSetupToken(service.db, body.token);
      const merchant = pending ? service.db.getMerchantByShop(pending.shop) : undefined;
      if (!pending || !merchant) return expired(response);
      const { form, errors } = await validateSetupForm(body, checkRecipient);
      if (Object.keys(errors).length > 0) {
        const typed = (name: string) => (typeof body[name] === "string" ? String(body[name]).slice(0, 120) : "");
        return setupHeaders(response).status(422).send(setupFormPage({ token: String(body.token), merchant, errors, values: { name: typed("name"), stellarRecipient: echoableRecipient(body.stellarRecipient), maxOrderUsdc: typed("maxOrderUsdc"), maxDayUsdc: typed("maxDayUsdc") } }));
      }
      // Spent only now, on a valid save: a typo does not cost the owner a new trip through Shopify.
      if (!consumeSetupToken(service.db, body.token)) return expired(response);
      const saved = service.db.completeMerchantSetup({ shopDomain: pending.shop, ...form });
      return setupHeaders(response).status(200).send(setupMessagePage("Tu tienda quedó activa", `${saved.name} ya puede recibir compras de agentes: hasta ${saved.maxOrderUsdc} USDC por orden y ${saved.maxDayUsdc} USDC por día. Puedes cerrar esta ventana.`));
    } catch (error) {
      log("error", "merchant.setup_failed", { message: errorMessage(error) });
      return setupHeaders(response).status(500).send(setupMessagePage("No se pudo guardar", "Ocurrió un error al guardar la configuración. Vuelve a abrir la app desde el administrador de Shopify e inténtalo de nuevo."));
    }
  });
}

export type HttpAppOptions = {
  shopifyOAuth?: ShopifyOAuth;
  quoteRateLimits?: QuoteRateLimits;
  /** Overrides the configuration; "off" serves /v1 without agent keys (local development and single-store tests). */
  agentAuth?: "required" | "off";
  /** Overridable for tests; production asks Horizon whether the address exists and trusts USDC. */
  checkRecipient?: RecipientChecker;
};

export function createHttpApp(service: CommerceService, options: HttpAppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Every request runs under a correlation ID (the caller's X-Request-Id when well-formed), echoed back
  // and attached to every log line and quote status change made while serving it.
  app.use((request: any, response: any, next: any) => {
    const correlationId = correlationIdFrom(request.get("x-request-id"));
    const startedAt = performance.now();
    response.set("X-Request-Id", correlationId);
    response.on("finish", () => withCorrelation(correlationId, () => log(response.statusCode >= 500 ? "error" : "info", "http.request", {
      method: request.method, route: routeLabel(request.path), httpStatus: response.statusCode, durationMs: Math.round(performance.now() - startedAt),
      merchantId: (request.agentKey as AgentKeyRecord | undefined)?.merchantId, agentKey: (request.agentKey as AgentKeyRecord | undefined)?.prefix,
    })));
    withCorrelation(correlationId, next);
  });

  const agentAuth = options.agentAuth ?? service.config.agentAuth ?? "required";
  // Limits live in the service database: a restart does not hand out a fresh quota.
  const limits = options.quoteRateLimits ?? service.config.quoteRateLimits ?? DEFAULT_QUOTE_RATE_LIMITS;
  const perClient = new SlidingWindowLimiter(limits.perClientPerHour, 3_600_000, service.db, "quotes:client");
  const perStore = new SlidingWindowLimiter(limits.globalPerHour, 3_600_000, service.db, "quotes:store");
  const authFailures = new SlidingWindowLimiter(service.config.authFailuresPerHour ?? 30, 3_600_000, service.db, "auth:failed");

  if (options.shopifyOAuth) registerShopifyOAuthRoutes(app, options.shopifyOAuth, service, options.checkRecipient ?? createRecipientChecker(service.config.stellarHorizonUrl ?? DEFAULT_TESTNET_HORIZON_URL));
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_request: any, response: any) => {
    const protocol = lastProtocolCheck();
    response.json({
      ok: true, service: "setareh", network: service.config.stellarNetwork,
      settlement: { verification: "rpc+horizon", worker: service.config.settlementWorker?.enabled === false ? "off" : "on" },
      protocol: protocol ? { known: protocol.known, rpc: protocol.rpc.protocolVersion, horizon: protocol.horizon.protocolVersion, supported: protocol.supported, checkedAt: protocol.checkedAt } : null,
      agentAuth,
    });
  });

  /**
   * Every /v1 route is called by an identified agent. The key decides the store: nothing a caller sends
   * can widen it. A wrong, missing or revoked key answers 401, and repeated failures from one address 429.
   */
  app.use("/v1", (request: any, response: any, next: any) => {
    if (agentAuth === "off") return next();
    const key = authenticateAgentKey(service.db, request.get("authorization"));
    if (key) { request.agentKey = key; return next(); }
    if (!authFailures.allow(clientKey(request))) {
      response.set("Retry-After", "3600");
      return response.status(429).json({ error: { code: "rate_limited", message: "Too many requests without a valid agent key. Retry later." } });
    }
    response.set("WWW-Authenticate", 'Bearer realm="setareh"');
    return response.status(401).json({ error: { code: "invalid_agent_key", message: "A valid agent key is required: send it as Authorization: Bearer <key>." } });
  });

  /** The store this request acts on. With a key it is the key's store, and naming any other is refused with 401. */
  const merchantOf = (request: any, requested?: unknown): string => {
    const key = request.agentKey as AgentKeyRecord | undefined;
    const named = typeof requested === "string" && requested ? requested : undefined;
    if (!key) return named ?? service.defaultMerchantId();
    if (named && named !== key.merchantId) throw new CommerceError("agent_key_wrong_merchant", "This agent key is not valid for that merchant.", 401);
    return key.merchantId;
  };
  /** A quote or order of another store is refused exactly like a wrong key. */
  const assertOwns = (request: any, merchantId: string | undefined) => {
    const key = request.agentKey as AgentKeyRecord | undefined;
    if (key && merchantId !== undefined && merchantId !== key.merchantId) throw new CommerceError("agent_key_wrong_merchant", "This agent key is not valid for that merchant.", 401);
  };

  // Every quote creates a real Shopify draft order, so quote creation is throttled per agent and per store.
  const throttleQuotes = (request: any, response: any, next: any) => {
    const key = request.agentKey as AgentKeyRecord | undefined;
    if (!perClient.allow(key ? `key:${key.id}` : `ip:${clientKey(request)}`) || !perStore.allow(key ? key.merchantId : "all")) {
      response.set("Retry-After", "3600");
      return response.status(429).json({ error: { code: "rate_limited", message: "Too many quotes were requested. Retry later." } });
    }
    return next();
  };

  app.get("/v1/merchants/:merchantId", (request: any, response: any, next: any) => {
    try {
      const merchant = service.merchant(merchantOf(request, request.params.merchantId));
      response.json({ id: merchant.id, name: merchant.name, shopDomain: merchant.shopDomain, status: merchant.status, payment: { network: merchant.network, asset: service.config.stellarAsset }, limits: { maxOrderUsdc: merchant.maxOrderUsdc, maxDayUsdc: merchant.maxDayUsdc } });
    } catch (error) { next(error); }
  });
  app.get("/v1/catalog", async (request: any, response: any, next: any) => { try { response.json(await service.searchCatalog(merchantOf(request, request.query.merchantId), String(request.query.query ?? ""), Math.min(Math.max(Number(request.query.limit ?? 10), 1), 25))); } catch (error) { next(error); } });
  app.get("/v1/availability/:variantId", async (request: any, response: any, next: any) => { try { response.json(await service.checkAvailability(merchantOf(request, request.query.merchantId), request.params.variantId, Math.min(Math.max(Number(request.query.quantity ?? 1), 1), 20))); } catch (error) { next(error); } });
  app.post("/v1/quotes", throttleQuotes, async (request: any, response: any, next: any) => {
    try {
      const input = quoteSchema.parse(request.body);
      response.status(201).json(await service.createQuote({ ...input, merchantId: merchantOf(request, input.merchantId), agentKeyId: (request.agentKey as AgentKeyRecord | undefined)?.id }));
    } catch (error) { next(error); }
  });

  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: service.config.facilitatorUrl }))
    .register(service.config.stellarNetwork, new ExactStellarScheme())
    // x402 only logs exceptions thrown by settle hooks, so a refusal must be returned as an abort.
    .onBeforeSettle(async (context) => {
      const path = (context.transportContext as { request?: { path?: string } } | undefined)?.request?.path;
      try {
        if (!path) throw new Error("Unable to resolve quote for this payment route.");
        service.markPaymentSubmitted(quoteIdFromPath(path), context.paymentPayload);
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
      const hash = transactionHash(context.result);
      const reportedNetwork = (context.result as { network?: unknown } | undefined)?.network;
      if (typeof reportedNetwork === "string" && reportedNetwork !== service.config.stellarNetwork) {
        // F16: a hash from another network can never settle this quote; hold it instead of recording a payment.
        service.rejectSettlementNetwork(quoteId, reportedNetwork, context.paymentPayload);
        log("warn", "payment.network_mismatch", { quoteId, transactionHash: hash, network: reportedNetwork });
        return;
      }
      try {
        service.recordSettlement(quoteId, { payload: context.paymentPayload, receipt: context.result, transactionHash: hash });
        log("info", "payment.settled", { quoteId, transactionHash: hash, network: service.config.stellarNetwork });
      } catch (error) {
        // Funds moved but the settlement could not be recorded; the order handler will refuse this quote.
        service.markSettlementUnrecorded(quoteId);
        log("error", "payment.unrecorded", { quoteId, transactionHash: hash, message: errorMessage(error) });
      }
    })
    .onSettleFailure(async (context) => {
      const path = (context.transportContext as { request?: { path?: string } } | undefined)?.request?.path;
      if (!path) return;
      const quoteId = quoteIdFromPath(path);
      const failure = classifySettlementFailure(context.error);
      const attempt = service.recordSettlementFailure(quoteId, failure, context.paymentPayload);
      if (attempt) log(attempt.outcome === "unknown" ? "warn" : "info", attempt.outcome === "unknown" ? "payment.unknown" : "payment.failed", { quoteId, reason: failure.reason, transactionHash: failure.transaction, message: errorMessage(context.error) });
    });
  const routes = {
    "POST /v1/quotes/:quoteId/pay-and-place": {
      accepts: {
        scheme: "exact",
        price: (context: { adapter: { getPath(): string } }) => `$${service.getPayableQuote(quoteIdFromPath(context.adapter.getPath())).totalUsdc}`,
        network: service.config.stellarNetwork,
        // Each quote is paid to its own store's address.
        payTo: (context: { adapter: { getPath(): string } }) => service.recipientFor(service.getPayableQuote(quoteIdFromPath(context.adapter.getPath()))),
        maxTimeoutSeconds: 60, extra: { paymentFlow: "upfront" },
      },
      description: "Settle a fixed Setareh quote in USDC before creating its Shopify order.",
    },
  };
  // Quotes with a signed payment being processed right now. The database claim is what guarantees a single
  // settlement; this makes the second of two simultaneous paid requests get a plain 409 instead of racing to it.
  const paying = new Set<string>();
  app.use("/v1/quotes/:quoteId/pay-and-place", (request: any, response: any, next: any) => {
    try {
      const quoteId = String(request.params.quoteId);
      // Ownership comes first: a key of another store never learns whether this quote can still be paid.
      assertOwns(request, service.db.getQuote(quoteId)?.merchantId);
      service.getPayableQuote(quoteId);
      if (request.get("payment-signature") || request.get("x-payment")) {
        if (paying.has(quoteId)) throw new CommerceError("payment_in_progress", "A payment for this quote is already being processed and it cannot be charged again.", 409);
        paying.add(quoteId);
        response.on("close", () => paying.delete(quoteId));
      }
      next();
    } catch (error) { next(error); }
  });
  app.use(paymentMiddleware(routes, resourceServer));
  app.post("/v1/quotes/:quoteId/pay-and-place", async (request: any, response: any, next: any) => {
    try {
      const body = z.object({ userConfirmed: z.literal(true) }).parse(request.body);
      const quoteId = request.params.quoteId;
      const quote = service.db.getQuote(quoteId);
      if (quote?.status === "manual_review" && !service.db.getPayment(quoteId)) throw new Error("Payment is held for manual review: the facilitator reported it on another network.");
      if (quote?.status === "payment_settled" && !service.db.getPayment(quoteId)?.verified_at) {
        const verification = await service.verifySettlementWithRetries(quoteId);
        if (verification.verdict === "disagree") throw new Error("Payment is held for manual review: the network does not confirm the reported transfer.");
        if (verification.verdict === "pending") {
          // The facilitator says settled but neither reader shows it yet; the settlement worker finishes or escalates.
          return response.status(202).json({ ...service.getOrderStatus(quoteId), pending: "verification", message: "The payment is being verified on Stellar RPC and Horizon. Check the quote with get_order_status; the order is created automatically once both confirm it." });
        }
      }
      response.json(await service.placePaidOrder(quoteId, body.userConfirmed));
    } catch (error) { next(error); }
  });
  app.get("/v1/orders/:orderId", (request: any, response: any, next: any) => {
    try {
      const status = service.getOrderStatus(request.params.orderId);
      assertOwns(request, status.merchantId);
      response.json(status);
    } catch (error) { next(error); }
  });

  const errors: ErrorRequestHandler = (error: unknown, _request: any, response: any, _next: any) => {
    if (error instanceof CommerceError) {
      // 402 here is a store limit, not an x402 challenge: it carries no payment requirements, only the limit that applied.
      log("info", "http.error", { httpStatus: error.httpStatus, errorCode: error.code, message: error.message });
      return response.status(error.httpStatus).json({ error: { code: error.code, message: error.message, ...error.details } });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = error instanceof z.ZodError ? 400 : /not found/i.test(message) ? 404 : /expired|not available|limit|not payable|manual review|not yet verified|already been submitted/i.test(message) ? 409 : 500;
    // Validation details may echo request fields; log only the class of a 400.
    log(status === 500 ? "error" : "info", "http.error", { httpStatus: status, message: status === 400 ? "invalid_request" : message });
    // A 500 may carry upstream text (Shopify, facilitator) that echoes buyer data; the redacted log keeps it.
    const publicMessage = status === 500 ? "Internal error. Check the quote with get_order_status before retrying." : message;
    response.status(status).json({ error: { code: status === 500 ? "internal_error" : "request_rejected", message: publicMessage } });
  };
  app.use(errors);
  return app;
}
