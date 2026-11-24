import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

/**
 * Operator command for the stores this instance serves.
 *   npm run merchant -- list
 *   npm run merchant -- limits <merchantId> --order <usdc> --day <usdc>
 *   npm run merchant -- disable <merchantId>     stops new quotes at once; payments in flight still finish
 *   npm run merchant -- enable <merchantId>      only for a store whose setup is complete
 * The payout address is deliberately not settable here: it is the store's own, entered on its setup page.
 */
const USAGE = "Usage: npm run merchant -- list | limits <merchantId> --order <usdc> --day <usdc> | disable <merchantId> | enable <merchantId>";

const [command, ...rest] = process.argv.slice(2);
const target = rest.find((value, index) => !value.startsWith("--") && !rest[index - 1]?.startsWith("--"));
const amount = (name: string) => { const index = rest.indexOf(`--${name}`); const value = index >= 0 ? Number(rest[index + 1]) : Number.NaN; return Number.isFinite(value) && value > 0 ? value : undefined; };
/** Enough of the address to recognize it, never the whole of it in a terminal that may be recorded. */
const shortAddress = (address: string) => (address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null);

const database = new SetarehDatabase(loadConfig().databasePath);
try {
  const describe = (id: string) => {
    const merchant = database.getMerchant(id);
    if (!merchant) throw new Error(`Merchant ${id} is not registered. Run: npm run merchant -- list`);
    return { id: merchant.id, name: merchant.name, shopDomain: merchant.shopDomain, status: merchant.status, network: merchant.network, configuredBy: merchant.configuredBy, payoutAddress: shortAddress(merchant.stellarRecipient), maxOrderUsdc: merchant.maxOrderUsdc, maxDayUsdc: merchant.maxDayUsdc, activeAgentKeys: database.listAgentKeys(merchant.id).filter((key) => !key.revokedAt).length };
  };
  if (command === "list") {
    process.stdout.write(`${JSON.stringify({ merchants: database.listMerchants().map((merchant) => describe(merchant.id)) }, null, 2)}\n`);
  } else if (command === "limits") {
    const order = amount("order");
    const day = amount("day");
    if (!target || order === undefined || day === undefined) throw new Error(USAGE);
    if (day < order) throw new Error("The per-day cap cannot be lower than the per-order cap.");
    describe(target);
    database.setMerchantLimits(target, { maxOrderUsdc: order, maxDayUsdc: day });
    process.stdout.write(`${JSON.stringify({ updated: true, ...describe(target) }, null, 2)}\n`);
  } else if (command === "disable" || command === "enable") {
    if (!target) throw new Error(USAGE);
    const merchant = database.getMerchant(target);
    if (!merchant) throw new Error(`Merchant ${target} is not registered.`);
    if (command === "enable" && (!merchant.stellarRecipient || merchant.maxOrderUsdc === null || merchant.maxDayUsdc === null)) throw new Error("This store has not finished its setup (payout address and caps); it cannot be enabled by hand.");
    database.setMerchantStatus(target, command === "disable" ? "disabled" : "active");
    process.stdout.write(`${JSON.stringify({ updated: true, ...describe(target) }, null, 2)}\n`);
  } else {
    throw new Error(USAGE);
  }
} finally {
  database.close();
}
