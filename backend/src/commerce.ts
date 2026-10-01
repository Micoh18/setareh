import { createHash, randomUUID } from "node:crypto";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase, type QuoteRecord } from "./db.js";
import { availability, type ShopifyAddress, type ShopifyLineItem, ShopifyClient } from "./shopify.js";

export type QuoteInput = { merchantId: string; items: ShopifyLineItem[]; email: string; shippingAddress: ShopifyAddress; userConfirmed: true };

export class CommerceService {
  constructor(readonly config: SetarehConfig, readonly db: SetarehDatabase, readonly shopify: ShopifyClient) {
    db.upsertMerchant({ id: config.merchantId, name: config.merchantName, shopDomain: shopify.domain, shopifyCredentialsRef: config.shopifyCredentialsRef, stellarRecipient: config.stellarMerchantAddress });
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

  markPaymentSubmitted(quoteId: string) {
    const quote = this.db.getUsableQuote(quoteId);
    if (quote.status !== "payment_required" && quote.status !== "payment_submitted") {
      throw new Error("Quote is not ready for payment settlement.");
    }
    if (quote.status === "payment_required") this.db.updateQuoteStatus(quoteId, "payment_submitted");
  }

  markPaymentFailed(quoteId: string) {
    const quote = this.db.getQuote(quoteId);
    if (quote?.status === "payment_submitted") this.db.updateQuoteStatus(quoteId, "payment_failed");
  }

  recordSettlement(quoteId: string, payment: { payload: unknown; receipt: unknown; transactionHash?: string }) {
    const quote = this.db.getUsableQuote(quoteId);
    this.assertSettlementMatchesQuote(quote, payment.payload);
    if (quote.status !== "payment_submitted") throw new Error("Quote is not in a submitted payment state.");
    this.db.recordPaymentSettled({ quoteId, network: this.config.stellarNetwork, asset: this.config.stellarAsset, amount: quote.totalUsdc, payTo: this.config.stellarMerchantAddress, paymentPayloadHash: createHash("sha256").update(JSON.stringify(payment.payload)).digest("hex"), transactionHash: payment.transactionHash, receipt: payment.receipt });
  }

  async placePaidOrder(quoteId: string, userConfirmed: true) {
    const existing = this.db.getOrderByQuote(quoteId);
    if (existing) return this.presentOrder(existing);
    const quote = this.db.getUsableQuote(quoteId);
    if (!this.db.getPayment(quoteId)) throw new Error("No settled Stellar payment exists for this quote.");
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
      this.db.markManualReview(quoteId);
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
      } : null,
    };
  }

  private presentQuote(quote: QuoteRecord, draftName: string) { return { quoteId: quote.id, status: quote.status, shopifyDraftOrder: { id: quote.shopifyDraftOrderId, name: draftName, currency: quote.currencyShopify, shipping: { title: this.config.shippingTitle ?? "Despacho Setareh", amount: (this.config.shippingFlatClp ?? 0).toFixed(2) }, total: quote.totalShopify }, payment: { network: this.config.stellarNetwork, asset: quote.currencyPayment, amount: quote.totalUsdc, payTo: this.config.stellarMerchantAddress, expiresAt: quote.expiresAt }, exchangeRate: { shopifyPerUsdc: quote.fxRate, source: quote.fxSource }, disclosure: "The USDC amount is fixed only until the quote expires. Ask for explicit confirmation before payment." }; }
  private presentOrder(order: { id: string; quoteId: string; shopifyOrderId: string; shopifyOrderName: string; status: string }) { const payment = this.db.getPayment(order.quoteId); return { status: order.status, quoteId: order.quoteId, orderId: order.id, shopifyOrder: { id: order.shopifyOrderId, name: order.shopifyOrderName }, payment: payment ? { network: payment.network, asset: payment.asset, transactionHash: payment.stellar_transaction_hash } : null }; }

  private assertSettlementMatchesQuote(quote: QuoteRecord, payload: unknown) {
    if (!payload || typeof payload !== "object") throw new Error("Payment payload is missing its accepted requirements.");
    const accepted = (payload as { accepted?: unknown }).accepted;
    if (!accepted || typeof accepted !== "object") throw new Error("Payment payload is missing its accepted requirements.");
    const requirements = accepted as Record<string, unknown>;
    const expectedAsset = USDC_TESTNET_ADDRESS;
    const [whole, fraction = ""] = quote.totalUsdc.split(".");
    const expectedAmount = BigInt(`${whole}${fraction.padEnd(7, "0")}`);
    const matches = requirements.network === this.config.stellarNetwork
      && requirements.asset === expectedAsset
      && requirements.payTo === this.config.stellarMerchantAddress
      && requirements.amount === expectedAmount.toString();
    if (!matches) throw new Error("Payment requirements do not match this quote.");
  }
}
