import { test } from "node:test";
import assert from "node:assert/strict";
import { listProducts, listRetailProducts, getProduct, getVariant } from "../src/lib/catalog.ts";

test("demo catalog is non-empty and consistent", () => {
  const all = listProducts();
  assert.ok(all.length > 0);
  for (const p of all) {
    assert.ok(p.variants.length > 0);
    for (const v of p.variants) {
      assert.ok(v.priceCents > 0);
      assert.ok(v.stock > 0);
    }
  }
});

test("retail listing excludes wholesale products", () => {
  const all = listProducts();
  const retail = listRetailProducts();
  assert.ok(all.length > retail.length);
  assert.ok(retail.every((p) => !p.isWholesale));
  assert.ok(all.some((p) => p.isWholesale));
});

test("getProduct and getVariant resolve demo entries", () => {
  assert.ok(getProduct("demo-blue-dream"));
  assert.equal(getProduct("missing"), undefined);
  const variant = getVariant("BD-1G");
  assert.ok(variant);
  assert.equal(variant?.priceCents, 1500);
  assert.equal(getVariant("NOPE"), undefined);
});
