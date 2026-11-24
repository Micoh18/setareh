import { createHash, randomBytes } from "node:crypto";
import { Asset, Networks, StrKey } from "@stellar/stellar-sdk";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import type { MerchantRecord, SetarehDatabase } from "./db.js";

/**
 * The store's own setup page. After approving the app in Shopify the owner lands here and enters the
 * Stellar address that receives the store's payments and its two caps (per order, per UTC day). Nobody
 * at Setareh types them. The link carries a random token bound to the shop, valid for a short time and
 * spent on the first successful save; getting a new link means going through Shopify's consent again,
 * so only someone with a session in that store can set or change where its money goes.
 */
export const SHOPIFY_SETUP_PATH = "/shopify/setup";

const SETUP_TOKEN_TTL_MS = 30 * 60_000;
/** Sanity bound for a cap typed into the form; real limits are the store's choice. */
const MAX_CAP_USDC = 1_000_000;

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Issues the single-use link for a shop that just completed OAuth. Only the token's hash is stored. */
export function createSetupLink(db: SetarehDatabase, shop: string) {
  const token = randomBytes(32).toString("base64url");
  db.createSetupToken(hashToken(token), shop.toLowerCase(), new Date(Date.now() + SETUP_TOKEN_TTL_MS).toISOString());
  return `${SHOPIFY_SETUP_PATH}?token=${token}`;
}

export function peekSetupToken(db: SetarehDatabase, token: unknown) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? db.peekSetupToken(hashToken(token)) : undefined;
}

export function consumeSetupToken(db: SetarehDatabase, token: unknown) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? db.consumeSetupToken(hashToken(token)) : undefined;
}

export type RecipientCheck = { ok: true } | { ok: false; reason: "invalid_address" | "account_not_found" | "no_usdc_trustline" | "horizon_unavailable" };

/** Verifies that an address can actually receive the store's USDC: it exists on the network and trusts the asset. */
export type RecipientChecker = (address: string) => Promise<RecipientCheck>;

export function createRecipientChecker(horizonUrl: string, fetchImpl: typeof fetch = fetch): RecipientChecker {
  const base = horizonUrl.replace(/\/+$/, "");
  return async (address) => {
    if (!StrKey.isValidEd25519PublicKey(address)) return { ok: false, reason: "invalid_address" };
    try {
      const response = await fetchImpl(`${base}/accounts/${address}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (response.status === 404) return { ok: false, reason: "account_not_found" };
      if (!response.ok) return { ok: false, reason: "horizon_unavailable" };
      const account = await response.json() as { balances?: Array<{ asset_type?: string; asset_code?: string; asset_issuer?: string }> };
      const trustsUsdc = (account.balances ?? []).some((line) => (line.asset_type === "credit_alphanum4" || line.asset_type === "credit_alphanum12")
        && Boolean(line.asset_code) && Boolean(line.asset_issuer) && new Asset(line.asset_code!, line.asset_issuer!).contractId(Networks.TESTNET) === USDC_TESTNET_ADDRESS);
      return trustsUsdc ? { ok: true } : { ok: false, reason: "no_usdc_trustline" };
    } catch {
      return { ok: false, reason: "horizon_unavailable" };
    }
  };
}

export type SetupForm = { name: string; stellarRecipient: string; maxOrderUsdc: number; maxDayUsdc: number };
export type SetupFormErrors = Partial<Record<"name" | "stellarRecipient" | "maxOrderUsdc" | "maxDayUsdc", string>>;

const RECIPIENT_MESSAGES: Record<Exclude<RecipientCheck, { ok: true }>["reason"], string> = {
  invalid_address: "No es una dirección pública Stellar válida. Empieza con G y tiene 56 caracteres.",
  account_not_found: "Esa cuenta todavía no existe en Stellar testnet. Créala y fondéala antes de continuar.",
  no_usdc_trustline: "La cuenta existe pero no puede recibir USDC: le falta la línea de confianza (trustline) al USDC de testnet.",
  horizon_unavailable: "No se pudo consultar la red Stellar en este momento. Vuelve a intentarlo en unos minutos.",
};

/** Parses what the form posted; values are returned as typed plus the messages to show next to each field. */
export async function validateSetupForm(body: Record<string, unknown>, checkRecipient: RecipientChecker): Promise<{ form: SetupForm; errors: SetupFormErrors }> {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const amount = (value: unknown) => { const raw = text(value).replace(",", "."); return /^\d+(\.\d{1,7})?$/.test(raw) ? Number(raw) : Number.NaN; };
  const form: SetupForm = { name: text(body.name), stellarRecipient: text(body.stellarRecipient), maxOrderUsdc: amount(body.maxOrderUsdc), maxDayUsdc: amount(body.maxDayUsdc) };
  const errors: SetupFormErrors = {};
  if (form.name.length < 2 || form.name.length > 80) errors.name = "Escribe el nombre de la tienda (entre 2 y 80 caracteres).";
  const cap = (value: number) => Number.isFinite(value) && value > 0 && value <= MAX_CAP_USDC;
  if (!cap(form.maxOrderUsdc)) errors.maxOrderUsdc = "Escribe un monto en USDC mayor que cero, sólo con números.";
  if (!cap(form.maxDayUsdc)) errors.maxDayUsdc = "Escribe un monto en USDC mayor que cero, sólo con números.";
  else if (cap(form.maxOrderUsdc) && form.maxDayUsdc < form.maxOrderUsdc) errors.maxDayUsdc = "El tope por día no puede ser menor que el tope por orden.";
  const recipient = await checkRecipient(form.stellarRecipient);
  if (!recipient.ok) errors.stellarRecipient = RECIPIENT_MESSAGES[recipient.reason];
  return { form, errors };
}

/**
 * What may be written back into the address field after a failed save. Only a valid public key: if the
 * owner pasted a secret seed by mistake, it must not come back in the page, the browser history or a cache.
 */
export function echoableRecipient(value: unknown) {
  return typeof value === "string" && StrKey.isValidEd25519PublicKey(value.trim()) ? value.trim() : "";
}

/** Every value that reaches the page goes through this, including the ones the owner just typed. */
function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const PAGE_STYLE = "font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#1f1b16";

function page(title: string, body: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="${PAGE_STYLE}"><h1 style="font-size:1.4rem">${escapeHtml(title)}</h1>${body}</body></html>`;
}

export function setupMessagePage(title: string, message: string) {
  return page(title, `<p>${escapeHtml(message)}</p>`);
}

export function setupFormPage(input: { token: string; merchant: MerchantRecord; values?: Partial<Record<keyof SetupForm, string>>; errors?: SetupFormErrors }) {
  const { merchant, errors = {} } = input;
  const current = {
    name: input.values?.name ?? merchant.name,
    stellarRecipient: input.values?.stellarRecipient ?? merchant.stellarRecipient,
    maxOrderUsdc: input.values?.maxOrderUsdc ?? (merchant.maxOrderUsdc === null ? "" : String(merchant.maxOrderUsdc)),
    maxDayUsdc: input.values?.maxDayUsdc ?? (merchant.maxDayUsdc === null ? "" : String(merchant.maxDayUsdc)),
  };
  const field = (name: keyof SetupForm, label: string, help: string, attributes: string) => `
    <label for="${name}" style="display:block;font-weight:600;margin-top:1.2rem">${escapeHtml(label)}</label>
    <div style="font-size:.9rem;color:#5c5348">${escapeHtml(help)}</div>
    <input id="${name}" name="${name}" value="${escapeHtml(current[name])}" ${attributes} required style="width:100%;box-sizing:border-box;padding:.55rem;margin-top:.3rem;font:inherit;border:1px solid ${errors[name] ? "#b3261e" : "#8a7f72"};border-radius:6px">
    ${errors[name] ? `<div role="alert" style="color:#b3261e;font-size:.9rem;margin-top:.25rem">${escapeHtml(errors[name]!)}</div>` : ""}`;
  return page("Configura los cobros de tu tienda", `
    <p>La tienda <strong>${escapeHtml(merchant.shopDomain)}</strong> ya autorizó a Setareh. Falta decir a qué cuenta llegan los pagos y cuánto puede venderse por este canal. Hasta guardar estos datos la tienda no recibe compras.</p>
    <form method="post" action="${SHOPIFY_SETUP_PATH}" autocomplete="off">
      <input type="hidden" name="token" value="${escapeHtml(input.token)}">
      ${field("name", "Nombre de la tienda", "Como quieres que aparezca para los agentes compradores.", 'maxlength="80"')}
      ${field("stellarRecipient", "Dirección Stellar que recibe los pagos", "La clave pública de tu cuenta (empieza con G). Debe existir en Stellar testnet y tener trustline a USDC. Nunca pegues aquí una clave secreta (las que empiezan con S).", 'maxlength="56" spellcheck="false"')}
      ${field("maxOrderUsdc", "Tope por orden (USDC)", "Ninguna compra por este canal podrá superar este monto.", 'inputmode="decimal"')}
      ${field("maxDayUsdc", "Tope por día (USDC)", "Suma máxima de todas las compras de un día (el día cambia a las 00:00 UTC).", 'inputmode="decimal"')}
      <button type="submit" style="margin-top:1.6rem;padding:.65rem 1.2rem;font:inherit;font-weight:600;color:#fff;background:#b4532a;border:0;border-radius:6px;cursor:pointer">Guardar y activar</button>
    </form>
    <p style="font-size:.9rem;color:#5c5348;margin-top:1.6rem">Este enlace sirve una sola vez y vence en 30 minutos. Para cambiar estos datos más adelante, vuelve a abrir la app desde el administrador de Shopify.</p>`);
}
