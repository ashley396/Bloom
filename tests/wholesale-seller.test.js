import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSellerKpis,
  canBrowseListing,
  nextPublishTransition,
  normalizePublishStatus,
  validateProductImages,
  validateProductVariants
} from "../netlify/functions/_shared/marketplace-products.js";

test("publish workflow transitions draft to preview to published", () => {
  assert.equal(nextPublishTransition("draft", "to_preview"), "preview");
  assert.equal(nextPublishTransition("preview", "publish"), "published");
  assert.equal(nextPublishTransition("published", "unpublish"), "draft");
});

test("catalog browse excludes draft and preview listings", () => {
  assert.equal(canBrowseListing({ active: true, publish_status: "published" }), true);
  assert.equal(canBrowseListing({ active: true, publish_status: "draft" }), false);
  assert.equal(canBrowseListing({ active: true, publish_status: "preview" }), false);
  assert.equal(canBrowseListing({ active: true, publish_status: "preview" }, { previewAllowed: true }), true);
});

test("validateProductVariants enforces sku and price", () => {
  const invalid = validateProductVariants([{ name: "Small", price: -1 }]);
  assert.equal(invalid.valid, false);
  const duplicate = validateProductVariants([
    { name: "Small", price: 10, sku: "A" },
    { name: "Large", price: 12, sku: "A" }
  ]);
  assert.equal(duplicate.valid, false);
  const valid = validateProductVariants([{ name: "Small", price: 10, sku: "A" }]);
  assert.equal(valid.valid, true);
});

test("validateProductImages requires http urls", () => {
  assert.equal(validateProductImages([{ url: "https://cdn.example.com/a.jpg" }]).valid, true);
  assert.equal(validateProductImages([{ url: "not-a-url" }]).valid, false);
});

test("buildSellerKpis aggregates inventory and order metrics", () => {
  const kpis = buildSellerKpis({
    products: [
      { id: "1", publish_status: "published", active: true, available_quantity: 2, low_stock_threshold: 5 },
      { id: "2", publish_status: "draft", active: true, available_quantity: 100, low_stock_threshold: 5 }
    ],
    orders: [{ status: "paid", total: 120 }, { status: "pending", total: 40 }],
    variantsByListing: {}
  });
  assert.equal(kpis.published_count, 1);
  assert.equal(kpis.draft_count, 1);
  assert.equal(kpis.low_stock_count, 1);
  assert.equal(kpis.revenue_total, 120);
  assert.equal(kpis.pending_order_count, 1);
});

test("normalizePublishStatus defaults safely", () => {
  assert.equal(normalizePublishStatus("PUBLISHED"), "published");
  assert.equal(normalizePublishStatus("invalid", "draft"), "draft");
});
