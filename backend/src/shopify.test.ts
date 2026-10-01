import assert from "node:assert/strict";
import test from "node:test";
import { availability, quoteTags, type ShopifyVariant } from "./shopify.js";

function variant(overrides: Partial<ShopifyVariant> = {}): ShopifyVariant {
  return {
    id: "gid://shopify/ProductVariant/1",
    title: "Llavero lila",
    sku: "LILA-1",
    price: "10000.00",
    inventoryQuantity: 1,
    inventoryPolicy: "DENY",
    availableForSale: true,
    product: { id: "gid://shopify/Product/1", title: "Llavero", handle: "llavero", status: "ACTIVE" },
    ...overrides,
  };
}

test("reports ready inventory only for the requested Shopify quantity", () => {
  assert.deepEqual(availability(variant(), 1).status, "READY_TO_SHIP");
  assert.deepEqual(availability(variant(), 2).status, "OUT_OF_STOCK");
});

test("allows made-to-order variants that Shopify permits to continue selling", () => {
  const result = availability(variant({ availableForSale: false, inventoryQuantity: 0, inventoryPolicy: "CONTINUE" }), 1);
  assert.equal(result.status, "MADE_TO_ORDER");
  assert.equal(result.canPurchase, true);
});

test("uses Shopify-safe operational tags for UUID quotes", () => {
  const tags = quoteTags("0c98f51e-e19f-4875-bf59-a49062dcf088");
  assert.deepEqual(tags, ["setareh", "q:0c98f51e-e19f-4875-bf59-a49062dcf088"]);
  assert.ok(tags.every((tag) => tag.length <= 40));
});
