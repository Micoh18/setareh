import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ShopifyClient } from "./shopify.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const draftOrderId = process.argv[2];
if (!draftOrderId?.startsWith("gid://shopify/DraftOrder/")) {
  throw new Error("Usage: npm run reconcile:draft -- gid://shopify/DraftOrder/<id>");
}

const draft = await ShopifyClient.fromEnvironment().getDraftStatus(draftOrderId);
process.stdout.write(`${JSON.stringify(draft, null, 2)}\n`);
