import { createHash, randomUUID } from "node:crypto";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase, type QuoteRecord } from "./db.js";
import { rpc } from "@stellar/stellar-sdk";
import { DEFAULT_TESTNET_HORIZON_URL, DEFAULT_TESTNET_RPC_URL } from "@x402/stellar";
import { log } from "./log.js";
import { verificationEvidence, verifySettlement, type ChainReaders, type VerificationResult } from "./settlement-verification.js";
import { createHorizonClient } from "./stellar-horizon.js";
import { describeSignedTransfer, usdcUnits, type ExpectedSettlement } from "./stellar-settlement.js";
import { availability, type ShopifyAddress, type ShopifyLineItem, ShopifyClient } from "./shopify.js";

export type QuoteInput = { merchantId: string; items: ShopifyLineItem[]; email: string; shippingAddress: ShopifyAddress; userConfirmed: true };

export const DEFAULT_VERIFICATION_POLICY = { attempts: 4, delayMs: 2_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class CommerceService {
  private chainReaders?: ChainReaders;

  constructor(readonly config: SetarehConfig, readonly db: SetarehDatabase, readonly shopify: ShopifyClient, chain?: ChainReaders) {
    db.upsertMerchant({ id: config.merchantId, name: config.merchantName, shopDomain: shopify.domain, shopifyCredentialsRef: config.shopifyCredentialsRef, stellarRecipient: config.stellarMerchantAddress });
    this.chainReaders = chain;
  }

  /** Stellar RPC and Horizon, built from the configuration unless the caller injected readers (tests). */
  get chain(): ChainReaders {
    if (!this.chainReaders) {
      // @x402/stellar bundles an older stellar-sdk; build the client from ours so XDR types match.
      this.chainReaders = { rpc: new rpc.Server(this.config.stellarRpcUrl ?? DEFAULT_TESTNET_RPC_URL), horizon: createHorizonClient(this.config.stellarHorizonUrl ?? DEFAULT_TESTNET_HORIZON_URL) };
    }
    return this.chainReaders;
  }

  /** What the network must show for a quote to count as paid. */
  expectedSettlement(quote: Pick<QuoteRecord, "totalUsdc">): ExpectedSettlement {
    return { asset: USDC_TESTNET_ADDRESS, payTo: this.config.stellarMerchantAddress, amount: usdcUnits(quote.totalUsdc) };
  }

  /**
   * Reads the settled payment's transaction on Stellar RPC and Horizon once and records what both said.
   * Verified: the order may be placed. Disagree: the quote goes to manual_review and no order is created.
   * Pending: neither source contradicts it yet; the caller may retry or leave it to the settlement worker.
   */
  async verifySettlementOnce(quoteId: string, now = new Date()): Promise<VerificationResult> {
    const quote = this.db.getQuote(quoteId);
    if (!quote) throw new Error("Quote not found.");
    const payment = this.db.getPayment(quoteId);
    if (!payment) throw new Error("No settled Stellar payment exists for this quote.");
    const hash = typeof payment.stellar_transaction_hash === "string" ? payment.stellar_transaction_hash : "";
    let result: VerificationResult;
    if (!hash) {
      result = { verdict: "disagree", transactionHash: hash, reason: "no_transaction_hash", rpc: { found: false, reason: "not_found" }, horizon: { found: false, reason: "not_found" } };
    } else {
      result = await verifySettlement(this.chain, hash, this.expectedSettlement(quote));
    }
    this.db.recordPaymentVerification(quoteId, verificationEvidence(result, now), result.verdict === "verified" ? now.toISOString() : null);
    if (result.verdict === "disagree") {
      // Only a payment that is still waiting to become an order is held; a created order is never reopened here.
      this.db.transitionQuote(quoteId, "payment_settled", "manual_review");
      log("warn", "payment.verification_disagree", { quoteId, transactionHash: hash, reason: result.reason, verdict: result.verdict });
    } else {
      log(result.verdict === "verified" ? "info" : "warn", `payment.verification_${result.verdict}`, { quoteId, transactionHash: hash, reason: "reason" in result ? result.reason : undefined, verdict: result.verdict });
    }
    return result;
  }

  /** In-request verification: a few quick re-reads, since a settled transaction is normally visible within seconds. */
  async verifySettlementWithRetries(quoteId: string, policy = this.config.verification ?? DEFAULT_VERIFICATION_POLICY): Promise<VerificationResult> {
    let result = await this.verifySettlementOnce(quoteId);
    for (let attempt = 1; attempt < policy.attempts && result.verdict === "pending"; attempt += 1) {
      await sleep(policy.delayMs);
      result = await this.verifySettlementOnce(quoteId);
    }
    return result;
  }

  /** The facilitator reported a settlement on a network this service does not accept; nothing is completed. */
  rejectSettlementNetwork(quoteId: string, network: string, paymentPayload: unknown) {
    if (!this.db.transitionQuote(quoteId, "payment_submitted", "manual_review")) return undefined;
    const transfer = describeSignedTransfer(paymentPayload);
    return this.db.recordPaymentAttempt({ quoteId, outcome: "unknown", errorReason: `network_mismatch:${network}`.slice(0, 200), facilitatorTransaction: null, payer: transfer?.from ?? null, amount: transfer ? transfer.amount.toString() : null, payTo: transfer?.to ?? null, signatureExpirationLedger: transfer?.signatureExpirationLedger ?? null });
  }

  async searchCatalog(query: string, limit: number) {
    const variants = await this.shopify.searchVariants(query, limit);
    return { merchantId: this.config.merchantId, store: this.shopify.domain, products: variants.map((variant) => ({ product: variant.product, variant: { id: variant.id, title: variant.title, sku: variant.sku, price: variant.price }, availability: availability(variant, 1) })) };
  }

  async checkAvailability(variantId: string, quantity: number) {
    const variant = await this.shopify.getVariant(variantId);
    if (!variant) throw new Error("Variant not found in Shopify.");
    return { merchantId: this.config.merchantId, product: variant.product, variantId, quantity, availability: availability(variant, quantity), checkedAt: new Date().toISOString() };
  }

  async createQuote(input: QuoteInput) {
    if (input.merchantId !== this.config.merchantId) throw new Error("Merchant is not enabled.");
    for (const item of input.items) {
      const variant = await this.shopify.getVariant(item.variantId);
      if (!variant || !availability(variant, item.quantity).canPurchase) throw new Error(`Variant ${item.variantId} is not available for the requested quantity.`);
    }
    const quoteId = randomUUID();
    const shippingAmount = this.config.shippingFlatClp ?? 0;
    const draft = await this.shopify.createDraftOrder({
      ...input,
      quoteId,
      shippingLine: shippingAmount > 0 ? { title: this.config.shippingTitle ?? "Despacho Setareh", price: shippingAmount } : undefined,
    });
    const totalShopify = Number(draft.totalPrice);
    if (!Number.isFinite(totalShopify) || totalShopify <= 0) throw new Error("Shopify returned an invalid total for this quote.");
    // Stellar assets use seven decimal places; preserve the exact amount that x402 will settle.
    const totalUsdc = Number((totalShopify * this.config.usdcPerClp).toFixed(7));
    if (totalUsdc > this.config.maxQuoteUsdc) throw new Error(`Quote exceeds the configured ${this.config.maxQuoteUsdc} USDC demo limit.`);
    const expiresAt = new Date(Date.now() + this.config.quoteTtlMinutes * 60_000).toISOString();
    const quote = this.db.createQuote({ id: quoteId, merchantId: input.merchantId, status: "quoted", currencyShopify: draft.currencyCode, totalShopify: draft.totalPrice, currencyPayment: this.config.stellarAsset, totalUsdc: totalUsdc.toFixed(7), fxRate: this.config.usdcPerClp.toString(), fxSource: this.config.fxSource, expiresAt, shippingAddressJson: JSON.stringify(input.shippingAddress), lineItemsJson: JSON.stringify(input.items), email: input.email, shopifyDraftOrderId: draft.id, idempotencyKey: `quote:${quoteId}` });
    return this.presentQuote(quote, draft.name);
  }

  getPayableQuote(quoteId: string) {
    const quote = this.db.getUsableQuote(quoteId);
    if (quote.status === "quoted") {
      this.db.updateQuoteStatus(quoteId, "payment_required");
      quote.status = "payment_required";
    }
    if (quote.status !== "payment_required") throw new Error("Quote has already been submitted for payment and cannot be charged again.");
    if (Number(quote.totalUsdc) > this.config.maxQuoteUsdc) throw new Error("Quote exceeds the server spending limit.");
    return quote;
  }

  /**
   * Claims the quote for one settlement and keeps what the signed authorization says (payer, expiry),
   * so that if the process dies mid-settlement the payment can still be reconciled against the network.
   */
  markPaymentSubmitted(quoteId: string, paymentPayload?: unknown) {
    if (!this.db.claimPaymentSubmission(quoteId)) throw new Error("Quote is not ready for payment settlement.");
    const transfer = describeSignedTransfer(paymentPayload);
    this.db.recordPaymentAttempt({ quoteId, outcome: "submitted", errorReason: "", facilitatorTransaction: null, payer: transfer?.from ?? null, amount: transfer ? transfer.amount.toString() : null, payTo: transfer?.to ?? null, signatureExpirationLedger: transfer?.signatureExpirationLedger ?? null });
  }

  /**
   * A quote left in payment_submitted after a restart: the facilitator may or may not have settled it.
   * Moves it to payment_unknown, carrying over the submitted attempt's data for reconcile:payment.
   */
  markInterruptedSettlement(quoteId: string) {
    if (!this.db.transitionQuote(quoteId, "payment_submitted", "payment_unknown")) throw new Error("Quote is not payment_submitted.");
    const submitted = this.db.getLatestPaymentAttempt(quoteId);
    return this.db.recordPaymentAttempt({ quoteId, outcome: "unknown", errorReason: "process_interrupted", facilitatorTransaction: null, payer: submitted?.payer ?? null, amount: submitted?.amount ?? null, payTo: submitted?.payTo ?? null, signatureExpirationLedger: submitted?.signatureExpirationLedger ?? null });
  }

  /**
   * A quote left in creating_shopify_order after a restart. If Shopify already completed the draft, the
   * order is adopted; otherwise the claim is released and the order is placed again (the draft is intact).
   */
  async resumeInterruptedOrder(quoteId: string) {
    const quote = this.db.getQuote(quoteId);
    if (!quote || quote.status !== "creating_shopify_order") throw new Error("Quote is not creating_shopify_order.");
    const draft = await this.shopify.getDraftOrder(quote.shopifyDraftOrderId);
    if (draft?.order) return this.reconcilePaidDraftOrder(quoteId);
    if (!this.db.transitionQuote(quoteId, "creating_shopify_order", "payment_settled")) throw new Error("Quote changed while resuming.");
    return this.placePaidOrder(quoteId, true);
  }

  /**
   * Records a settlement that did not succeed. Only a definite facilitator rejection frees the quote as
   * payment_failed; anything else (timeout, lost response, submitted transaction) may still have moved
   * funds, so the quote is held as payment_unknown until reconcile:payment checks the network.
   */
  recordSettlementFailure(quoteId: string, failure: { definite: boolean; reason: string; transaction?: string }, paymentPayload: unknown) {
    if (!this.db.transitionQuote(quoteId, "payment_submitted", failure.definite ? "payment_failed" : "payment_unknown")) return undefined;
    const transfer = describeSignedTransfer(paymentPayload);
    return this.db.recordPaymentAttempt({
      quoteId, outcome: failure.definite ? "failed" : "unknown", errorReason: failure.reason.slice(0, 200), facilitatorTransaction: failure.transaction ?? null,
      payer: transfer?.from ?? null, amount: transfer ? transfer.amount.toString() : null, payTo: transfer?.to ?? null,
      signatureExpirationLedger: transfer?.signatureExpirationLedger ?? null,
    });
  }

  /** Records a payment_unknown quote's settlement once reconciliation found it on-chain; it still needs verification before an order. */
  recordReconciledSettlement(quoteId: string, transactionHash: string, source = "reconcile:payment") {
    const quote = this.db.getQuote(quoteId);
    if (!quote) throw new Error("Quote not found.");
    if (quote.status !== "payment_unknown") throw new Error(`Quote is ${quote.status}, not payment_unknown.`);
    const owner = this.db.getQuoteIdByTransaction(transactionHash);
    if (owner && owner !== quoteId) throw new Error(`Transaction already settles quote ${owner}.`);
    this.db.recordPaymentSettled({ quoteId, network: this.config.stellarNetwork, asset: this.config.stellarAsset, amount: quote.totalUsdc, payTo: this.config.stellarMerchantAddress, paymentPayloadHash: "reconciled", transactionHash, receipt: { source, transactionHash } });
  }

  /** Closes a payment_unknown quote after reconcile:payment proved nothing was, or can still be, settled. */
  markReconciledUnpaid(quoteId: string) {
    if (!this.db.transitionQuote(quoteId, "payment_unknown", "payment_failed")) throw new Error("Quote is not payment_unknown.");
  }

  recordSettlement(quoteId: string, payment: { payload: unknown; receipt: unknown; transactionHash?: string }) {
    // Deliberately not getUsableQuote: a quote may expire while its claimed settlement is in flight.
    const quote = this.db.getQuote(quoteId);
    if (!quote) throw new Error("Quote not found.");
    this.assertSettlementMatchesQuote(quote, payment.payload);
    if (quote.status !== "payment_submitted") throw new Error("Quote is not in a submitted payment state.");
    this.db.recordPaymentSettled({ quoteId, network: this.config.stellarNetwork, asset: this.config.stellarAsset, amount: quote.totalUsdc, payTo: this.config.stellarMerchantAddress, paymentPayloadHash: createHash("sha256").update(JSON.stringify(payment.payload)).digest("hex"), transactionHash: payment.transactionHash, receipt: payment.receipt });
  }

  /** A settlement succeeded on-chain but could not be recorded; keep the quote out of every automatic path. */
  markSettlementUnrecorded(quoteId: string) {
    if (this.db.getQuote(quoteId)) this.db.markManualReview(quoteId);
  }

  async placePaidOrder(quoteId: string, userConfirmed: true) {
    const existing = this.db.getOrderByQuote(quoteId);
    if (existing) return this.presentOrder(existing);
    const quote = this.db.getUsableQuote(quoteId);
    const settled = this.db.getPayment(quoteId);
    if (!settled) throw new Error("No settled Stellar payment exists for this quote.");
    // Never on the facilitator's word alone: Stellar RPC and Horizon must both confirm the transfer first.
    if (!settled.verified_at) {
      const verification = await this.verifySettlementOnce(quoteId);
      if (verification.verdict === "disagree") throw new Error("Payment is held for manual review: the network does not confirm the reported transfer.");
      if (verification.verdict === "pending") throw new Error("Payment is not yet verified on Stellar RPC and Horizon; the order is not created until it is.");
    }
    if (!this.db.claimShopifyOrderCreation(quoteId)) {
      const completed = this.db.getOrderByQuote(quoteId);
      if (completed) return this.presentOrder(completed);
      throw new Error("Shopify order creation is already in progress for this quote.");
    }
    try {
      for (const item of JSON.parse(quote.lineItemsJson) as ShopifyLineItem[]) {
        const variant = await this.shopify.getVariant(item.variantId);
        if (!variant || !availability(variant, item.quantity).canPurchase) {
          this.db.updateQuoteStatus(quoteId, "out_of_stock");
          throw new Error("Inventory changed after payment. Quote requires manual review.");
        }
      }
      const shopifyOrder = await this.shopify.completeDraftOrder(quote.shopifyDraftOrderId);
      // Persist Shopify's irreversible side effect before any follow-up call.
      // If evidence attachment fails, this ID is enough to reconcile manually
      // without risking a second Shopify order on retry.
      const localOrder = this.db.createOrder({ quoteId, shopifyOrderId: shopifyOrder.id, shopifyOrderName: shopifyOrder.name, status: "evidence_pending" });
      const payment = this.db.getPayment(quoteId);
      if (!payment) throw new Error("Settled payment disappeared before Shopify order completion.");
      await this.shopify.attachPaymentEvidence(shopifyOrder.id, {
        quoteId,
        network: String(payment.network),
        asset: String(payment.asset),
        transactionHash: typeof payment.stellar_transaction_hash === "string" ? payment.stellar_transaction_hash : undefined,
      });
      this.db.updateOrderStatus(localOrder.id, "created");
      this.db.updateQuoteStatus(quoteId, "created");
      return this.presentOrder({ ...localOrder, status: "created" });
    } catch (error) {
      const order = this.db.getOrderByQuote(quoteId);
      if (order) this.db.updateOrderStatus(order.id, "manual_review");
      // A more specific outcome (out_of_stock) set above must not be overwritten by the generic one.
      this.db.transitionQuote(quoteId, "creating_shopify_order", "manual_review");
      throw error;
    }
  }

  async reconcilePaidDraftOrder(quoteId: string) {
    const quote = this.db.getQuote(quoteId);
    if (!quote) throw new Error("Quote not found.");
    const payment = this.db.getPayment(quoteId);
    if (!payment) throw new Error("No settled Stellar payment exists for this quote.");
    const draft = await this.shopify.getDraftOrder(quote.shopifyDraftOrderId);
    const shopifyOrder = draft?.order;
    if (!shopifyOrder) throw new Error("The Shopify draft has not completed to an order or cannot be read with the current app scopes.");

    const localOrder = this.db.createOrder({ quoteId, shopifyOrderId: shopifyOrder.id, shopifyOrderName: shopifyOrder.name, status: "evidence_pending" });
    if (localOrder.status === "created") return this.presentOrder(localOrder);
    try {
      await this.shopify.attachPaymentEvidence(shopifyOrder.id, {
        quoteId,
        network: String(payment.network),
        asset: String(payment.asset),
        transactionHash: typeof payment.stellar_transaction_hash === "string" ? payment.stellar_transaction_hash : undefined,
      });
      this.db.updateOrderStatus(localOrder.id, "created");
      this.db.updateQuoteStatus(quoteId, "created");
      return this.presentOrder({ ...localOrder, status: "created" });
    } catch (error) {
      this.db.updateOrderStatus(localOrder.id, "manual_review");
      this.db.markManualReview(quoteId);
      throw error;
    }
  }

  getOrderStatus(orderId: string) {
    const directOrder = this.db.getOrder(orderId);
    const requestedQuote = directOrder ? undefined : this.db.getQuote(orderId);
    const order = directOrder ?? (requestedQuote ? this.db.getOrderByQuote(requestedQuote.id) : undefined);
    const quote = requestedQuote ?? (order ? this.db.getQuote(order.quoteId) : undefined);
    if (!order && !quote) throw new Error("Order or quote not found.");
    const quoteId = order?.quoteId ?? quote!.id;
    const payment = this.db.getPayment(quoteId);
    return {
      status: order?.status ?? quote!.status,
      quoteId,
      order: order ? this.presentOrder(order).shopifyOrder : null,
      payment: payment ? {
        network: payment.network,
        asset: payment.asset,
        amount: payment.amount,
        transactionHash: payment.stellar_transaction_hash,
        settledAt: payment.settled_at,
        receipt: { status: payment.status, transactionHash: payment.stellar_transaction_hash, settledAt: payment.settled_at },
        verification: this.presentVerification(payment),
      } : null,
    };
  }

  /** Public summary of the two-source check: who confirmed the hash and when. */
  private presentVerification(payment: Record<string, unknown>) {
    const raw = typeof payment.verification_json === "string" ? payment.verification_json : "";
    let detail: { verdict?: string; reason?: string; ledger?: number; rpc?: unknown; horizon?: unknown; checkedAt?: string } = {};
    try { detail = raw ? JSON.parse(raw) as typeof detail : {}; } catch { detail = {}; }
    return { verifiedAt: payment.verified_at ?? null, verdict: detail.verdict ?? "unchecked", reason: detail.reason, ledger: detail.ledger, sources: { rpc: detail.rpc ?? null, horizon: detail.horizon ?? null }, checkedAt: detail.checkedAt };
  }

  private presentQuote(quote: QuoteRecord, draftName: string) { return { quoteId: quote.id, status: quote.status, shopifyDraftOrder: { id: quote.shopifyDraftOrderId, name: draftName, currency: quote.currencyShopify, shipping: { title: this.config.shippingTitle ?? "Despacho Setareh", amount: (this.config.shippingFlatClp ?? 0).toFixed(2) }, total: quote.totalShopify }, payment: { network: this.config.stellarNetwork, asset: quote.currencyPayment, amount: quote.totalUsdc, payTo: this.config.stellarMerchantAddress, expiresAt: quote.expiresAt }, exchangeRate: { shopifyPerUsdc: quote.fxRate, source: quote.fxSource }, disclosure: "The USDC amount is fixed only until the quote expires. Ask for explicit confirmation before payment." }; }
  private presentOrder(order: { id: string; quoteId: string; shopifyOrderId: string; shopifyOrderName: string; status: string }) { const payment = this.db.getPayment(order.quoteId); return { status: order.status, quoteId: order.quoteId, orderId: order.id, shopifyOrder: { id: order.shopifyOrderId, name: order.shopifyOrderName }, payment: payment ? { network: payment.network, asset: payment.asset, transactionHash: payment.stellar_transaction_hash } : null }; }

  private assertSettlementMatchesQuote(quote: QuoteRecord, payload: unknown) {
    if (!payload || typeof payload !== "object") throw new Error("Payment payload is missing its accepted requirements.");
    const accepted = (payload as { accepted?: unknown }).accepted;
    if (!accepted || typeof accepted !== "object") throw new Error("Payment payload is missing its accepted requirements.");
    const requirements = accepted as Record<string, unknown>;
    const expectedAsset = USDC_TESTNET_ADDRESS;
    const expectedAmount = usdcUnits(quote.totalUsdc);
    const matches = requirements.network === this.config.stellarNetwork
      && requirements.asset === expectedAsset
      && requirements.payTo === this.config.stellarMerchantAddress
      && requirements.amount === expectedAmount.toString();
    if (!matches) throw new Error("Payment requirements do not match this quote.");
  }
}
