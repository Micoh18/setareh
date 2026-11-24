import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { currentCorrelationId, log } from "./log.js";

export type QuoteStatus = "quoted" | "payment_required" | "payment_submitted" | "payment_settled" | "creating_shopify_order" | "created" | "expired" | "out_of_stock" | "payment_failed" | "payment_unknown" | "shopify_failed" | "manual_review";

export type QuoteRecord = {
  id: string;
  merchantId: string;
  /** The agent key that created the quote; null for quotes older than agent keys or created by the operator. */
  agentKeyId?: string | null;
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

/** A settlement that did not succeed. Holds only values derived from the signed payload, never the payload. */
export type PaymentAttemptRecord = {
  id: string;
  quoteId: string;
  outcome: "submitted" | "failed" | "unknown";
  errorReason: string;
  facilitatorTransaction: string | null;
  payer: string | null;
  amount: string | null;
  payTo: string | null;
  signatureExpirationLedger: number | null;
  createdAt: string;
};

export type ShopifyInstallationRecord = {
  shop: string;
  scope: string;
  status: "active" | "uninstalled";
  accessTokenEnc: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenEnc: string | null;
  refreshTokenExpiresAt: string | null;
  installedAt: string;
  updatedAt: string;
};

export type MerchantStatus = "pending_setup" | "active" | "disabled";

/** A store Setareh sells for. Its id is the handle of its Shopify domain; the payout address and caps are its own. */
export type MerchantRecord = {
  id: string;
  name: string;
  shopDomain: string;
  shopifyCredentialsRef: string;
  /** Empty until the store finishes its setup page. */
  stellarRecipient: string;
  network: string;
  /** USDC caps chosen by the store; null means not set yet (the store cannot sell). */
  maxOrderUsdc: number | null;
  maxDayUsdc: number | null;
  status: MerchantStatus;
  /** "env": defined by this instance's environment. "owner": set by the store on its setup page; the environment never overwrites it. */
  configuredBy: "env" | "owner";
  activatedAt: string | null;
};

export type AgentKeyRecord = { id: string; merchantId: string; label: string; prefix: string; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };

/** Statuses in which a quote's amount counts against the store's daily cap: paid, in flight, or held for a person. */
const DAILY_CAP_COMMITTED: QuoteStatus[] = ["payment_submitted", "payment_settled", "creating_shopify_order", "created", "payment_unknown", "manual_review", "out_of_stock", "shopify_failed"];

/** The merchant id of a store: the part of its Shopify domain before ".myshopify.com". */
export function merchantIdFromShop(shopDomain: string) {
  return shopDomain.trim().toLowerCase().replace(/\.myshopify\.com$/, "");
}

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
      CREATE TABLE IF NOT EXISTS payment_attempt (
        id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, outcome TEXT NOT NULL, error_reason TEXT NOT NULL,
        facilitator_transaction TEXT, payer TEXT, amount TEXT, pay_to TEXT, signature_expiration_ledger INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (quote_id) REFERENCES quote(id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS quote_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
        at TEXT NOT NULL, correlation_id TEXT,
        FOREIGN KEY (quote_id) REFERENCES quote(id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS quote_event_quote ON quote_event (quote_id, id);
      CREATE TABLE IF NOT EXISTS shopify_oauth_state (
        state TEXT PRIMARY KEY, shop TEXT NOT NULL, expires_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS shopify_installation (
        shop TEXT PRIMARY KEY, scope TEXT NOT NULL, status TEXT NOT NULL,
        access_token_enc TEXT, access_token_expires_at TEXT,
        refresh_token_enc TEXT, refresh_token_expires_at TEXT,
        installed_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_key (
        id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, label TEXT NOT NULL, prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT,
        FOREIGN KEY (merchant_id) REFERENCES merchant(id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS merchant_setup_token (
        token_hash TEXT PRIMARY KEY, shop TEXT NOT NULL, expires_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS rate_hit (
        bucket TEXT NOT NULL, at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS rate_hit_bucket ON rate_hit (bucket, at);
    `);
    const merchantColumns = this.db.prepare("PRAGMA table_info(merchant)").all() as Array<{ name: string }>;
    if (!merchantColumns.some((column) => column.name === "shopify_credentials_ref")) {
      this.db.exec("ALTER TABLE merchant ADD COLUMN shopify_credentials_ref TEXT NOT NULL DEFAULT 'env:SHOPIFY_CLIENT_ID'");
    }
    if (!merchantColumns.some((column) => column.name === "status")) {
      // D2: every store carries its own network, caps and lifecycle. Existing rows were selling already, so they stay active.
      this.db.exec(`
        ALTER TABLE merchant ADD COLUMN network TEXT NOT NULL DEFAULT 'stellar:testnet';
        ALTER TABLE merchant ADD COLUMN max_order_usdc REAL;
        ALTER TABLE merchant ADD COLUMN max_day_usdc REAL;
        ALTER TABLE merchant ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
        ALTER TABLE merchant ADD COLUMN configured_by TEXT NOT NULL DEFAULT 'env';
        ALTER TABLE merchant ADD COLUMN activated_at TEXT;
      `);
    }
    const quoteColumns = this.db.prepare("PRAGMA table_info(quote)").all() as Array<{ name: string }>;
    if (!quoteColumns.some((column) => column.name === "agent_key_id")) {
      this.db.exec("ALTER TABLE quote ADD COLUMN agent_key_id TEXT");
    }
    this.renameLegacyMerchantIds();
    if (!quoteColumns.some((column) => column.name === "fx_source")) {
      this.db.exec("ALTER TABLE quote ADD COLUMN fx_source TEXT NOT NULL DEFAULT 'configured_demo_rate'");
    }
    if (!quoteColumns.some((column) => column.name === "personal_data_purged_at")) {
      this.db.exec("ALTER TABLE quote ADD COLUMN personal_data_purged_at TEXT");
    }
    const paymentColumns = this.db.prepare("PRAGMA table_info(payment)").all() as Array<{ name: string }>;
    if (!paymentColumns.some((column) => column.name === "verified_at")) {
      // Set only once Stellar RPC and Horizon both confirmed the transfer; an order needs it.
      this.db.exec("ALTER TABLE payment ADD COLUMN verified_at TEXT");
      this.db.exec("ALTER TABLE payment ADD COLUMN verification_json TEXT");
    }
  }

  /**
   * Until D2 the pilot store's id was whatever SETAREH_MERCHANT_ID said (its default, "micohstore", even
   * for another store). Ids now derive from the Shopify domain, so a legacy row is renamed together with
   * every quote that points at it, in one transaction. Idempotent: rows that already match are untouched.
   */
  private renameLegacyMerchantIds() {
    const rows = this.db.prepare("SELECT id, shop_domain FROM merchant").all() as Array<{ id: string; shop_domain: string }>;
    for (const row of rows) {
      const target = merchantIdFromShop(row.shop_domain);
      if (!target || target === row.id) continue;
      if (rows.some((other) => other.id === target)) {
        log("warn", "merchant.rename_skipped", { reason: "target_id_exists", merchantId: row.id });
        continue;
      }
      this.db.exec("BEGIN");
      try {
        // Parent and children change inside the same transaction; the constraint is checked at COMMIT.
        this.db.exec("PRAGMA defer_foreign_keys = ON");
        this.db.prepare("UPDATE merchant SET id = ? WHERE id = ?").run(target, row.id);
        const quotes = this.db.prepare("UPDATE quote SET merchant_id = ? WHERE merchant_id = ?").run(target, row.id).changes;
        this.db.prepare("UPDATE agent_key SET merchant_id = ? WHERE merchant_id = ?").run(target, row.id);
        this.db.exec("COMMIT");
        log("info", "merchant.renamed", { merchantId: target, from: row.id, amount: Number(quotes) });
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  /**
   * Registers or refreshes a store from this instance's environment. Once the store itself has set its
   * payout address and caps (configured_by = 'owner'), the environment no longer overwrites them.
   */
  upsertMerchant(merchant: { id: string; name: string; shopDomain: string; shopifyCredentialsRef?: string; stellarRecipient: string; maxOrderUsdc?: number | null; maxDayUsdc?: number | null }) {
    const at = now();
    this.db.prepare(`INSERT INTO merchant (id, name, shop_domain, shopify_credentials_ref, stellar_recipient, max_order_usdc, max_day_usdc, status, configured_by, activated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'env', ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, shop_domain = excluded.shop_domain, shopify_credentials_ref = excluded.shopify_credentials_ref,
        stellar_recipient = excluded.stellar_recipient, max_order_usdc = COALESCE(excluded.max_order_usdc, merchant.max_order_usdc), max_day_usdc = COALESCE(excluded.max_day_usdc, merchant.max_day_usdc),
        activated_at = COALESCE(merchant.activated_at, excluded.activated_at)
      WHERE merchant.configured_by = 'env'`).run(
      merchant.id, merchant.name, merchant.shopDomain, merchant.shopifyCredentialsRef ?? "env:SHOPIFY_CLIENT_ID", merchant.stellarRecipient, merchant.maxOrderUsdc ?? null, merchant.maxDayUsdc ?? null, at,
    );
  }

  getMerchant(id: string): MerchantRecord | undefined {
    const row = this.db.prepare("SELECT * FROM merchant WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.merchantFromRow(row) : undefined;
  }

  getMerchantByShop(shopDomain: string): MerchantRecord | undefined {
    const row = this.db.prepare("SELECT * FROM merchant WHERE shop_domain = ?").get(shopDomain.toLowerCase()) as Record<string, unknown> | undefined;
    return row ? this.merchantFromRow(row) : undefined;
  }

  listMerchants(): MerchantRecord[] {
    return (this.db.prepare("SELECT * FROM merchant ORDER BY id").all() as Array<Record<string, unknown>>).map((row) => this.merchantFromRow(row));
  }

  /**
   * A store approved the app through OAuth. A new store starts in pending_setup with no payout address;
   * a store coming back after an uninstall is active again only if its setup was already complete.
   */
  registerInstalledMerchant(shopDomain: string): MerchantRecord {
    const shop = shopDomain.toLowerCase();
    const existing = this.getMerchantByShop(shop);
    if (!existing) {
      const id = merchantIdFromShop(shop);
      this.db.prepare("INSERT INTO merchant (id, name, shop_domain, stellar_recipient, status, configured_by) VALUES (?, ?, ?, '', 'pending_setup', 'owner')").run(id, id, shop);
      log("info", "merchant.registered", { merchantId: id, status: "pending_setup" });
    } else if (existing.status === "disabled") {
      const complete = Boolean(existing.stellarRecipient) && existing.maxOrderUsdc !== null && existing.maxDayUsdc !== null;
      this.db.prepare("UPDATE merchant SET status = ? WHERE id = ?").run(complete ? "active" : "pending_setup", existing.id);
      log("info", "merchant.reinstalled", { merchantId: existing.id, status: complete ? "active" : "pending_setup" });
    }
    return this.getMerchantByShop(shop)!;
  }

  /** The store's own setup: payout address and caps. Activates it and takes it out of the environment's hands. */
  completeMerchantSetup(input: { shopDomain: string; name: string; stellarRecipient: string; maxOrderUsdc: number; maxDayUsdc: number }): MerchantRecord {
    const existing = this.getMerchantByShop(input.shopDomain);
    if (!existing) throw new Error("Merchant not found.");
    this.db.prepare("UPDATE merchant SET name = ?, stellar_recipient = ?, max_order_usdc = ?, max_day_usdc = ?, status = 'active', configured_by = 'owner', activated_at = COALESCE(activated_at, ?) WHERE id = ?")
      .run(input.name, input.stellarRecipient, input.maxOrderUsdc, input.maxDayUsdc, now(), existing.id);
    const action = !existing.stellarRecipient ? "recipient_set" : existing.stellarRecipient !== input.stellarRecipient ? "recipient_changed" : "recipient_unchanged";
    log(action === "recipient_changed" ? "warn" : "info", "merchant.setup_completed", { merchantId: existing.id, action });
    return this.getMerchant(existing.id)!;
  }

  /** Operator-side caps (migration of the pilot store, mainnet canary). Does not touch the payout address. */
  setMerchantLimits(id: string, limits: { maxOrderUsdc: number; maxDayUsdc: number }) {
    return this.db.prepare("UPDATE merchant SET max_order_usdc = ?, max_day_usdc = ? WHERE id = ?").run(limits.maxOrderUsdc, limits.maxDayUsdc, id).changes === 1;
  }

  setMerchantStatus(id: string, status: MerchantStatus) {
    return this.db.prepare("UPDATE merchant SET status = ? WHERE id = ?").run(status, id).changes === 1;
  }

  /** USDC a store already has committed in a period: paid or in-flight quotes, plus unpaid quotes that can still be paid. */
  committedUsdc(merchantId: string, since: string, at = now()): number {
    const row = this.db.prepare(`SELECT COALESCE(SUM(CAST(total_usdc AS REAL)), 0) AS total FROM quote
      WHERE merchant_id = ? AND created_at >= ? AND (status IN (${DAILY_CAP_COMMITTED.map(() => "?").join(", ")}) OR (status IN ('quoted', 'payment_required') AND expires_at > ?))`)
      .get(merchantId, since, ...DAILY_CAP_COMMITTED, at) as { total: number };
    return Number(row.total);
  }

  /** Stores only the hash of an agent key; the key itself is shown once by whoever created it. */
  createAgentKey(input: { id: string; merchantId: string; label: string; prefix: string; keyHash: string }): AgentKeyRecord {
    const createdAt = now();
    this.db.prepare("INSERT INTO agent_key (id, merchant_id, label, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(input.id, input.merchantId, input.label, input.prefix, input.keyHash, createdAt);
    return { id: input.id, merchantId: input.merchantId, label: input.label, prefix: input.prefix, createdAt, revokedAt: null, lastUsedAt: null };
  }

  /** The active key with this hash, if any; revoked keys never match. */
  findAgentKey(keyHash: string): AgentKeyRecord | undefined {
    const row = this.db.prepare("SELECT * FROM agent_key WHERE key_hash = ? AND revoked_at IS NULL").get(keyHash) as Record<string, unknown> | undefined;
    return row ? this.agentKeyFromRow(row) : undefined;
  }

  touchAgentKey(id: string) { this.db.prepare("UPDATE agent_key SET last_used_at = ? WHERE id = ?").run(now(), id); }

  listAgentKeys(merchantId?: string): AgentKeyRecord[] {
    const rows = (merchantId ? this.db.prepare("SELECT * FROM agent_key WHERE merchant_id = ? ORDER BY created_at").all(merchantId) : this.db.prepare("SELECT * FROM agent_key ORDER BY merchant_id, created_at").all()) as Array<Record<string, unknown>>;
    return rows.map((row) => this.agentKeyFromRow(row));
  }

  /** Accepts the key id or its public prefix. */
  revokeAgentKey(idOrPrefix: string) {
    return Number(this.db.prepare("UPDATE agent_key SET revoked_at = ? WHERE (id = ? OR prefix = ?) AND revoked_at IS NULL").run(now(), idOrPrefix, idOrPrefix).changes);
  }

  createSetupToken(tokenHash: string, shop: string, expiresAt: string) {
    this.db.prepare("DELETE FROM merchant_setup_token WHERE expires_at <= ? OR shop = ?").run(now(), shop);
    this.db.prepare("INSERT INTO merchant_setup_token (token_hash, shop, expires_at) VALUES (?, ?, ?)").run(tokenHash, shop, expiresAt);
  }

  /** Reads a live setup token without spending it (the form is shown first, saved later). */
  peekSetupToken(tokenHash: string): { shop: string } | undefined {
    const row = this.db.prepare("SELECT shop, expires_at FROM merchant_setup_token WHERE token_hash = ?").get(tokenHash) as { shop: string; expires_at: string } | undefined;
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) return undefined;
    return { shop: row.shop };
  }

  /** Spends the token in the statement that reads it, so one link saves a store's setup at most once. */
  consumeSetupToken(tokenHash: string): { shop: string } | undefined {
    const row = this.db.prepare("DELETE FROM merchant_setup_token WHERE token_hash = ? RETURNING shop, expires_at").get(tokenHash) as { shop: string; expires_at: string } | undefined;
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) return undefined;
    return { shop: row.shop };
  }

  /** Sliding-window rate limit kept on disk, so a restart does not hand every client a fresh quota. */
  allowRateHit(bucket: string, limit: number, windowMs: number, at = Date.now()) {
    const since = at - windowMs;
    this.db.prepare("DELETE FROM rate_hit WHERE bucket = ? AND at <= ?").run(bucket, since);
    const { n } = this.db.prepare("SELECT COUNT(*) AS n FROM rate_hit WHERE bucket = ?").get(bucket) as { n: number };
    if (Number(n) >= limit) return false;
    this.db.prepare("INSERT INTO rate_hit (bucket, at) VALUES (?, ?)").run(bucket, at);
    return true;
  }

  /** Drops hits of buckets nobody asked about again; called by the settlement worker's daily pass. */
  pruneRateHits(olderThan: number) { return Number(this.db.prepare("DELETE FROM rate_hit WHERE at <= ?").run(olderThan).changes); }

  createQuote(input: Omit<QuoteRecord, "createdAt" | "fxSource"> & { fxSource?: string }): QuoteRecord {
    const quote: QuoteRecord = { ...input, fxSource: input.fxSource ?? "configured_demo_rate", createdAt: now() };
    this.db.prepare(`INSERT INTO quote (id, merchant_id, agent_key_id, status, currency_shopify, total_shopify, currency_payment, total_usdc, fx_rate, fx_source, expires_at, shipping_address_json, line_items_json, email, shopify_draft_order_id, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(quote.id, quote.merchantId, quote.agentKeyId ?? null, quote.status, quote.currencyShopify, quote.totalShopify, quote.currencyPayment, quote.totalUsdc, quote.fxRate, quote.fxSource, quote.expiresAt, quote.shippingAddressJson, quote.lineItemsJson, quote.email, quote.shopifyDraftOrderId, quote.idempotencyKey, quote.createdAt);
    this.recordTransition(quote.id, null, quote.status);
    return quote;
  }

  getQuote(id: string): QuoteRecord | undefined {
    const row = this.db.prepare("SELECT * FROM quote WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.quoteFromRow(row) : undefined;
  }

  getUsableQuote(id: string): QuoteRecord {
    const quote = this.getQuote(id);
    if (!quote) throw new Error("Quote not found.");
    // Expiry only gates new payments. Once a settlement is claimed, its outcome must be recorded.
    if (new Date(quote.expiresAt).getTime() <= Date.now() && ["quoted", "payment_required"].includes(quote.status)) {
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
    this.changeStatus(id, status);
  }

  /**
   * Every quote status change goes through here, so each one is audited in quote_event and logged with
   * the current correlation ID. `from`/`extraCondition` make the change conditional; the read and the
   * update run back to back on the synchronous SQLite handle, so `from_status` is exact.
   */
  private changeStatus(id: string, to: QuoteStatus, from?: QuoteStatus, extraCondition = "", ...extraParams: string[]) {
    const current = this.db.prepare("SELECT status FROM quote WHERE id = ?").get(id) as { status: QuoteStatus } | undefined;
    if (!current || (from !== undefined && current.status !== from)) return false;
    const changed = this.db.prepare(`UPDATE quote SET status = ? WHERE id = ? AND status = ?${extraCondition}`).run(to, id, current.status, ...extraParams).changes === 1;
    if (changed && current.status !== to) this.recordTransition(id, current.status, to);
    return changed;
  }

  private recordTransition(quoteId: string, from: QuoteStatus | null, to: QuoteStatus) {
    const correlationId = currentCorrelationId() ?? null;
    this.db.prepare("INSERT INTO quote_event (quote_id, from_status, to_status, at, correlation_id) VALUES (?, ?, ?, ?, ?)").run(quoteId, from, to, now(), correlationId);
    log(to === "manual_review" || to === "payment_unknown" ? "warn" : "info", "quote.status", { quoteId, from: from ?? "none", to });
  }

  getQuoteEvents(quoteId: string): Array<{ from: QuoteStatus | null; to: QuoteStatus; at: string; correlationId: string | null }> {
    const rows = this.db.prepare("SELECT from_status, to_status, at, correlation_id FROM quote_event WHERE quote_id = ? ORDER BY id").all(quoteId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ from: (row.from_status ?? null) as QuoteStatus | null, to: row.to_status as QuoteStatus, at: String(row.at), correlationId: row.correlation_id === null ? null : String(row.correlation_id) }));
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

  /** Moves a live quote to payment_submitted in one statement, so only one settlement can start per quote. */
  claimPaymentSubmission(quoteId: string) {
    return this.changeStatus(quoteId, "payment_submitted", "payment_required", " AND expires_at > ?", now());
  }

  /** Conditional status change; returns false when the quote was not in the expected status. */
  transitionQuote(quoteId: string, from: QuoteStatus, to: QuoteStatus) {
    return this.changeStatus(quoteId, to, from);
  }

  recordPaymentAttempt(input: Omit<PaymentAttemptRecord, "id" | "createdAt">): PaymentAttemptRecord {
    const attempt: PaymentAttemptRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO payment_attempt (id, quote_id, outcome, error_reason, facilitator_transaction, payer, amount, pay_to, signature_expiration_ledger, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(attempt.id, attempt.quoteId, attempt.outcome, attempt.errorReason, attempt.facilitatorTransaction, attempt.payer, attempt.amount, attempt.payTo, attempt.signatureExpirationLedger, attempt.createdAt);
    return attempt;
  }

  getLatestPaymentAttempt(quoteId: string): PaymentAttemptRecord | undefined {
    const row = this.db.prepare("SELECT * FROM payment_attempt WHERE quote_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(quoteId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
    return { id: String(row.id), quoteId: String(row.quote_id), outcome: row.outcome as PaymentAttemptRecord["outcome"], errorReason: String(row.error_reason), facilitatorTransaction: text(row.facilitator_transaction), payer: text(row.payer), amount: text(row.amount), payTo: text(row.pay_to), signatureExpirationLedger: row.signature_expiration_ledger === null ? null : Number(row.signature_expiration_ledger), createdAt: String(row.created_at) };
  }

  /** Quotes sitting in an intermediate status since before `olderThan`; each should have moved on within seconds. */
  listStuckQuotes(olderThan: string): Array<{ quoteId: string; status: QuoteStatus; since: string }> {
    const rows = this.db.prepare(`
      SELECT q.id AS quote_id, q.status, COALESCE(MAX(e.at), q.created_at) AS since
      FROM quote q LEFT JOIN quote_event e ON e.quote_id = q.id
      WHERE q.status IN ('payment_submitted', 'payment_settled', 'creating_shopify_order')
      GROUP BY q.id HAVING since < ? ORDER BY since`).all(olderThan) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ quoteId: String(row.quote_id), status: row.status as QuoteStatus, since: String(row.since) }));
  }

  /** Quotes that need a person: unknown payments, manual review and stock lost after payment. */
  listQuotesNeedingReview(): Array<{ quoteId: string; status: QuoteStatus; since: string }> {
    const rows = this.db.prepare(`
      SELECT q.id AS quote_id, q.status, COALESCE(MAX(e.at), q.created_at) AS since
      FROM quote q LEFT JOIN quote_event e ON e.quote_id = q.id
      WHERE q.status IN ('payment_unknown', 'manual_review', 'out_of_stock') GROUP BY q.id ORDER BY since`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ quoteId: String(row.quote_id), status: row.status as QuoteStatus, since: String(row.since) }));
  }

  countQuotesByStatus(since?: string): Record<string, number> {
    const rows = this.db.prepare(`SELECT status, COUNT(*) AS n FROM quote WHERE created_at >= ? GROUP BY status`).all(since ?? "") as Array<{ status: string; n: number }>;
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
  }

  /** All status transitions since a date, oldest first, for funnel and latency metrics. */
  listQuoteEvents(since?: string): Array<{ quoteId: string; from: QuoteStatus | null; to: QuoteStatus; at: string }> {
    const rows = this.db.prepare("SELECT quote_id, from_status, to_status, at FROM quote_event WHERE at >= ? ORDER BY id").all(since ?? "") as Array<Record<string, unknown>>;
    return rows.map((row) => ({ quoteId: String(row.quote_id), from: (row.from_status ?? null) as QuoteStatus | null, to: row.to_status as QuoteStatus, at: String(row.at) }));
  }

  /** Which quote, if any, already owns a Stellar transaction; one transaction can settle only one quote. */
  getQuoteIdByTransaction(transactionHash: string): string | undefined {
    const row = this.db.prepare("SELECT quote_id FROM payment WHERE stellar_transaction_hash = ?").get(transactionHash) as { quote_id: string } | undefined;
    return row?.quote_id;
  }

  claimShopifyOrderCreation(quoteId: string) {
    return this.changeStatus(quoteId, "creating_shopify_order", "payment_settled");
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
    return this.db.prepare("SELECT network, asset, amount, pay_to, stellar_transaction_hash, facilitator_receipt_json, status, settled_at, verified_at, verification_json FROM payment WHERE quote_id = ?").get(quoteId) as Record<string, unknown> | undefined;
  }

  /** Stores the two-source check of a settlement; `verifiedAt` is set only on a verified verdict. */
  recordPaymentVerification(quoteId: string, verification: unknown, verifiedAt: string | null) {
    this.db.prepare("UPDATE payment SET verification_json = ?, verified_at = COALESCE(verified_at, ?) WHERE quote_id = ?").run(JSON.stringify(verification), verifiedAt, quoteId);
  }

  /** Quotes in the given statuses with the time they entered the current status, oldest first. */
  listQuotesInStatuses(statuses: QuoteStatus[]): Array<{ quoteId: string; status: QuoteStatus; since: string }> {
    if (statuses.length === 0) return [];
    const rows = this.db.prepare(`
      SELECT q.id AS quote_id, q.status, COALESCE(MAX(e.at), q.created_at) AS since
      FROM quote q LEFT JOIN quote_event e ON e.quote_id = q.id
      WHERE q.status IN (${statuses.map(() => "?").join(", ")}) GROUP BY q.id ORDER BY since`).all(...statuses) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ quoteId: String(row.quote_id), status: row.status as QuoteStatus, since: String(row.since) }));
  }

  /** Settled payments by verification state, for metrics. */
  countPaymentsByVerification(): { verified: number; unverified: number } {
    const row = this.db.prepare("SELECT SUM(CASE WHEN verified_at IS NULL THEN 0 ELSE 1 END) AS verified, SUM(CASE WHEN verified_at IS NULL THEN 1 ELSE 0 END) AS unverified FROM payment WHERE status = 'settled'").get() as { verified: number | null; unverified: number | null };
    return { verified: Number(row.verified ?? 0), unverified: Number(row.unverified ?? 0) };
  }

  createOAuthState(state: string, shop: string, expiresAt: string) {
    this.db.prepare("DELETE FROM shopify_oauth_state WHERE expires_at <= ?").run(now());
    this.db.prepare("INSERT INTO shopify_oauth_state (state, shop, expires_at) VALUES (?, ?, ?)").run(state, shop, expiresAt);
  }

  /** Deletes the nonce in the same statement that reads it, so a callback can be accepted at most once. */
  consumeOAuthState(state: string): { shop: string } | undefined {
    const row = this.db.prepare("DELETE FROM shopify_oauth_state WHERE state = ? RETURNING shop, expires_at").get(state) as { shop: string; expires_at: string } | undefined;
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) return undefined;
    return { shop: row.shop };
  }

  saveShopifyInstallation(input: { shop: string; scope: string; accessTokenEnc: string; accessTokenExpiresAt: string | null; refreshTokenEnc: string | null; refreshTokenExpiresAt: string | null }) {
    const at = now();
    this.db.prepare(`INSERT INTO shopify_installation (shop, scope, status, access_token_enc, access_token_expires_at, refresh_token_enc, refresh_token_expires_at, installed_at, updated_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop) DO UPDATE SET scope = excluded.scope, status = 'active', access_token_enc = excluded.access_token_enc, access_token_expires_at = excluded.access_token_expires_at,
        refresh_token_enc = excluded.refresh_token_enc, refresh_token_expires_at = excluded.refresh_token_expires_at, updated_at = excluded.updated_at,
        installed_at = CASE WHEN shopify_installation.status = 'active' THEN shopify_installation.installed_at ELSE excluded.installed_at END`)
      .run(input.shop, input.scope, input.accessTokenEnc, input.accessTokenExpiresAt, input.refreshTokenEnc, input.refreshTokenExpiresAt, at, at);
  }

  getShopifyInstallation(shop: string): ShopifyInstallationRecord | undefined {
    const row = this.db.prepare("SELECT * FROM shopify_installation WHERE shop = ?").get(shop) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
    return { shop: String(row.shop), scope: String(row.scope), status: row.status as ShopifyInstallationRecord["status"], accessTokenEnc: text(row.access_token_enc), accessTokenExpiresAt: text(row.access_token_expires_at), refreshTokenEnc: text(row.refresh_token_enc), refreshTokenExpiresAt: text(row.refresh_token_expires_at), installedAt: String(row.installed_at), updatedAt: String(row.updated_at) };
  }

  /** Keeps the row for audit but erases every token. */
  revokeShopifyInstallation(shop: string) {
    const result = this.db.prepare("UPDATE shopify_installation SET status = 'uninstalled', access_token_enc = NULL, access_token_expires_at = NULL, refresh_token_enc = NULL, refresh_token_expires_at = NULL, updated_at = ? WHERE shop = ?").run(now(), shop);
    return result.changes === 1;
  }

  markManualReview(quoteId: string) { this.updateQuoteStatus(quoteId, "manual_review"); }

  /**
   * Retention policy for personal data (see Docs/operaciones/logs-y-retencion.md). The buyer's email and
   * shipping address are only needed until Shopify has the order or the quote expired unpaid, so they are
   * blanked after a grace period; the raw facilitator receipt goes with them once the order is old enough.
   * Quotes that still need an operator (payment_unknown, manual_review, shopify_failed, in-flight states)
   * are never touched. Amounts, statuses, hashes and the audit trail stay. Dry run unless `apply` is true.
   */
  purgePersonalData(input: { expiredAfterDays: number; orderedAfterDays: number; now?: Date; apply: boolean }): Array<{ quoteId: string; status: QuoteStatus; reason: "unpaid" | "ordered"; purged: boolean }> {
    const at = input.now ?? new Date();
    const day = 24 * 60 * 60 * 1000;
    const expiredCutoff = new Date(at.getTime() - input.expiredAfterDays * day).toISOString();
    const orderedCutoff = new Date(at.getTime() - input.orderedAfterDays * day).toISOString();
    const candidates = this.db.prepare(`
      SELECT q.id, q.status, CASE WHEN o.id IS NULL THEN 'unpaid' ELSE 'ordered' END AS reason
      FROM quote q LEFT JOIN orders o ON o.quote_id = q.id
      WHERE q.personal_data_purged_at IS NULL
        AND ((o.id IS NULL AND q.status IN ('quoted', 'payment_required', 'expired', 'out_of_stock', 'payment_failed') AND q.expires_at <= ?)
          OR (o.id IS NOT NULL AND q.status = 'created' AND o.created_at <= ?))
      ORDER BY q.created_at`).all(expiredCutoff, orderedCutoff) as Array<{ id: string; status: QuoteStatus; reason: "unpaid" | "ordered" }>;
    if (!input.apply) return candidates.map((row) => ({ quoteId: row.id, status: row.status, reason: row.reason, purged: false }));
    const purgeQuote = this.db.prepare("UPDATE quote SET email = '', shipping_address_json = '{}', personal_data_purged_at = ? WHERE id = ? AND personal_data_purged_at IS NULL");
    const purgeReceipt = this.db.prepare("UPDATE payment SET facilitator_receipt_json = NULL WHERE quote_id = ?");
    const purgedAt = at.toISOString();
    this.db.exec("BEGIN");
    try {
      for (const row of candidates) {
        purgeQuote.run(purgedAt, row.id);
        if (row.reason === "ordered") purgeReceipt.run(row.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return candidates.map((row) => ({ quoteId: row.id, status: row.status, reason: row.reason, purged: true }));
  }

  personalDataPurgedAt(quoteId: string): string | null {
    const row = this.db.prepare("SELECT personal_data_purged_at FROM quote WHERE id = ?").get(quoteId) as { personal_data_purged_at: string | null } | undefined;
    return row?.personal_data_purged_at ?? null;
  }
  close() { this.db.close(); }

  private quoteFromRow(row: Record<string, unknown>): QuoteRecord {
    return {
      id: String(row.id), merchantId: String(row.merchant_id), agentKeyId: row.agent_key_id === null || row.agent_key_id === undefined ? null : String(row.agent_key_id), status: row.status as QuoteStatus,
      currencyShopify: String(row.currency_shopify), totalShopify: String(row.total_shopify), currencyPayment: String(row.currency_payment), totalUsdc: String(row.total_usdc), fxRate: String(row.fx_rate), fxSource: String(row.fx_source), expiresAt: String(row.expires_at), shippingAddressJson: String(row.shipping_address_json), lineItemsJson: String(row.line_items_json), email: String(row.email), shopifyDraftOrderId: String(row.shopify_draft_order_id), idempotencyKey: String(row.idempotency_key), createdAt: String(row.created_at),
    };
  }

  private merchantFromRow(row: Record<string, unknown>): MerchantRecord {
    const amount = (value: unknown) => (value === null || value === undefined ? null : Number(value));
    return {
      id: String(row.id), name: String(row.name), shopDomain: String(row.shop_domain), shopifyCredentialsRef: String(row.shopify_credentials_ref), stellarRecipient: String(row.stellar_recipient),
      network: String(row.network), maxOrderUsdc: amount(row.max_order_usdc), maxDayUsdc: amount(row.max_day_usdc), status: row.status as MerchantStatus,
      configuredBy: row.configured_by === "owner" ? "owner" : "env", activatedAt: row.activated_at === null || row.activated_at === undefined ? null : String(row.activated_at),
    };
  }

  private agentKeyFromRow(row: Record<string, unknown>): AgentKeyRecord {
    const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
    return { id: String(row.id), merchantId: String(row.merchant_id), label: String(row.label), prefix: String(row.prefix), createdAt: String(row.created_at), revokedAt: text(row.revoked_at), lastUsedAt: text(row.last_used_at) };
  }

  private orderFromRow(row: Record<string, unknown>): OrderRecord {
    return { id: String(row.id), quoteId: String(row.quote_id), shopifyOrderId: String(row.shopify_order_id), shopifyOrderName: String(row.shopify_order_name), status: String(row.status), createdAt: String(row.created_at) };
  }
}
