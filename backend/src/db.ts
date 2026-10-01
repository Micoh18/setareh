import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type QuoteStatus = "quoted" | "payment_required" | "payment_submitted" | "payment_settled" | "creating_shopify_order" | "created" | "expired" | "out_of_stock" | "payment_failed" | "shopify_failed" | "manual_review";

export type QuoteRecord = {
  id: string;
  merchantId: string;
  status: QuoteStatus;
  currencyShopify: string;
  totalShopify: string;
  currencyPayment: string;
  totalUsdc: string;
  fxRate: string;
  fxSource: string;
  expiresAt: string;
  shippingAddressJson: string;
  lineItemsJson: string;
  email: string;
  shopifyDraftOrderId: string;
  idempotencyKey: string;
  createdAt: string;
};

export type OrderRecord = {
  id: string;
  quoteId: string;
  shopifyOrderId: string;
  shopifyOrderName: string;
  status: string;
  createdAt: string;
};

function now() { return new Date().toISOString(); }

export class SetarehDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS merchant (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, shop_domain TEXT NOT NULL,
        shopify_credentials_ref TEXT NOT NULL DEFAULT 'env:SHOPIFY_CLIENT_ID',
        stellar_recipient TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
      ) STRICT;
      CREATE TABLE IF NOT EXISTS quote (
        id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, status TEXT NOT NULL,
        currency_shopify TEXT NOT NULL, total_shopify TEXT NOT NULL,
        currency_payment TEXT NOT NULL, total_usdc TEXT NOT NULL, fx_rate TEXT NOT NULL, fx_source TEXT NOT NULL DEFAULT 'configured_demo_rate',
        expires_at TEXT NOT NULL, shipping_address_json TEXT NOT NULL,
        line_items_json TEXT NOT NULL, email TEXT NOT NULL, shopify_draft_order_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchant(id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS payment (
        id TEXT PRIMARY KEY, quote_id TEXT NOT NULL UNIQUE, network TEXT NOT NULL,
        asset TEXT NOT NULL, amount TEXT NOT NULL, pay_to TEXT NOT NULL,
        payment_payload_hash TEXT, stellar_transaction_hash TEXT,
        facilitator_receipt_json TEXT, status TEXT NOT NULL, settled_at TEXT,
        FOREIGN KEY (quote_id) REFERENCES quote(id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, quote_id TEXT NOT NULL UNIQUE, shopify_order_id TEXT NOT NULL,
        shopify_order_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY (quote_id) REFERENCES quote(id)
      ) STRICT;
    `);
    const merchantColumns = this.db.prepare("PRAGMA table_info(merchant)").all() as Array<{ name: string }>;
    if (!merchantColumns.some((column) => column.name === "shopify_credentials_ref")) {
      this.db.exec("ALTER TABLE merchant ADD COLUMN shopify_credentials_ref TEXT NOT NULL DEFAULT 'env:SHOPIFY_CLIENT_ID'");
    }
    const quoteColumns = this.db.prepare("PRAGMA table_info(quote)").all() as Array<{ name: string }>;
    if (!quoteColumns.some((column) => column.name === "fx_source")) {
      this.db.exec("ALTER TABLE quote ADD COLUMN fx_source TEXT NOT NULL DEFAULT 'configured_demo_rate'");
    }
  }

  upsertMerchant(merchant: { id: string; name: string; shopDomain: string; shopifyCredentialsRef?: string; stellarRecipient: string }) {
    this.db.prepare(`INSERT INTO merchant (id, name, shop_domain, shopify_credentials_ref, stellar_recipient) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, shop_domain = excluded.shop_domain, shopify_credentials_ref = excluded.shopify_credentials_ref, stellar_recipient = excluded.stellar_recipient`).run(
      merchant.id, merchant.name, merchant.shopDomain, merchant.shopifyCredentialsRef ?? "env:SHOPIFY_CLIENT_ID", merchant.stellarRecipient,
    );
  }

  createQuote(input: Omit<QuoteRecord, "createdAt" | "fxSource"> & { fxSource?: string }): QuoteRecord {
    const quote: QuoteRecord = { ...input, fxSource: input.fxSource ?? "configured_demo_rate", createdAt: now() };
    this.db.prepare(`INSERT INTO quote (id, merchant_id, status, currency_shopify, total_shopify, currency_payment, total_usdc, fx_rate, fx_source, expires_at, shipping_address_json, line_items_json, email, shopify_draft_order_id, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(quote.id, quote.merchantId, quote.status, quote.currencyShopify, quote.totalShopify, quote.currencyPayment, quote.totalUsdc, quote.fxRate, quote.fxSource, quote.expiresAt, quote.shippingAddressJson, quote.lineItemsJson, quote.email, quote.shopifyDraftOrderId, quote.idempotencyKey, quote.createdAt);
    return quote;
  }

  getQuote(id: string): QuoteRecord | undefined {
    const row = this.db.prepare("SELECT * FROM quote WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.quoteFromRow(row) : undefined;
  }

  getUsableQuote(id: string): QuoteRecord {
    const quote = this.getQuote(id);
    if (!quote) throw new Error("Quote not found.");
    if (new Date(quote.expiresAt).getTime() <= Date.now() && ["quoted", "payment_required", "payment_submitted"].includes(quote.status)) {
      this.updateQuoteStatus(id, "expired");
      quote.status = "expired";
    }
    if (quote.status === "expired") throw new Error("Quote expired. Create a new quote before paying.");
    if (quote.status !== "quoted" && quote.status !== "payment_required" && quote.status !== "payment_submitted" && quote.status !== "payment_settled" && quote.status !== "creating_shopify_order") {
      throw new Error(`Quote is not payable in status ${quote.status}.`);
    }
    return quote;
  }

  updateQuoteStatus(id: string, status: QuoteStatus) {
    this.db.prepare("UPDATE quote SET status = ? WHERE id = ?").run(status, id);
  }

  recordPaymentSettled(input: { quoteId: string; network: string; asset: string; amount: string; payTo: string; paymentPayloadHash: string; transactionHash?: string; receipt: unknown }) {
    this.db.prepare(`INSERT INTO payment (id, quote_id, network, asset, amount, pay_to, payment_payload_hash, stellar_transaction_hash, facilitator_receipt_json, status, settled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'settled', ?)
      ON CONFLICT(quote_id) DO UPDATE SET stellar_transaction_hash = excluded.stellar_transaction_hash, facilitator_receipt_json = excluded.facilitator_receipt_json, status = 'settled', settled_at = excluded.settled_at`)
      .run(randomUUID(), input.quoteId, input.network, input.asset, input.amount, input.payTo, input.paymentPayloadHash, input.transactionHash ?? null, JSON.stringify(input.receipt), now());
    this.updateQuoteStatus(input.quoteId, "payment_settled");
  }

  createOrder(input: Omit<OrderRecord, "id" | "createdAt">): OrderRecord {
    const existing = this.getOrderByQuote(input.quoteId);
    if (existing) return existing;
    const order: OrderRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO orders (id, quote_id, shopify_order_id, shopify_order_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(order.id, order.quoteId, order.shopifyOrderId, order.shopifyOrderName, order.status, order.createdAt);
    if (order.status === "created") this.updateQuoteStatus(order.quoteId, "created");
    return order;
  }

  updateOrderStatus(id: string, status: string) {
    this.db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
  }

  claimShopifyOrderCreation(quoteId: string) {
    const result = this.db.prepare("UPDATE quote SET status = 'creating_shopify_order' WHERE id = ? AND status = 'payment_settled'").run(quoteId);
    return result.changes === 1;
  }

  getOrderByQuote(quoteId: string): OrderRecord | undefined {
    const row = this.db.prepare("SELECT * FROM orders WHERE quote_id = ?").get(quoteId) as Record<string, unknown> | undefined;
    return row ? this.orderFromRow(row) : undefined;
  }

  getOrder(id: string): OrderRecord | undefined {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ? OR shopify_order_id = ?").get(id, id) as Record<string, unknown> | undefined;
    return row ? this.orderFromRow(row) : undefined;
  }

  getPayment(quoteId: string) {
    return this.db.prepare("SELECT network, asset, amount, pay_to, stellar_transaction_hash, facilitator_receipt_json, status, settled_at FROM payment WHERE quote_id = ?").get(quoteId) as Record<string, unknown> | undefined;
  }

  markManualReview(quoteId: string) { this.updateQuoteStatus(quoteId, "manual_review"); }
  close() { this.db.close(); }

  private quoteFromRow(row: Record<string, unknown>): QuoteRecord {
    return {
      id: String(row.id), merchantId: String(row.merchant_id), status: row.status as QuoteStatus,
      currencyShopify: String(row.currency_shopify), totalShopify: String(row.total_shopify), currencyPayment: String(row.currency_payment), totalUsdc: String(row.total_usdc), fxRate: String(row.fx_rate), fxSource: String(row.fx_source), expiresAt: String(row.expires_at), shippingAddressJson: String(row.shipping_address_json), lineItemsJson: String(row.line_items_json), email: String(row.email), shopifyDraftOrderId: String(row.shopify_draft_order_id), idempotencyKey: String(row.idempotency_key), createdAt: String(row.created_at),
    };
  }

  private orderFromRow(row: Record<string, unknown>): OrderRecord {
    return { id: String(row.id), quoteId: String(row.quote_id), shopifyOrderId: String(row.shopify_order_id), shopifyOrderName: String(row.shopify_order_name), status: String(row.status), createdAt: String(row.created_at) };
  }
}
