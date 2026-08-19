import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSellerKpis,
  canBrowseListing,
  nextPublishTransition,
  normalizePublishStatus,
  validateProductImages,
  validateProductVariants,
  AVAILABILITY_STATUSES,
  normalizeAvailabilityStatus,
  availabilityStatusLabel,
  resolveDisplayPrice,
  allUnitPrices,
  normalizeSeasonalMonths,
  isCurrentlyAvailable,
  validateFloralAttributes
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

// --- Florisyn Wholesale Marketplace: floral-specific data model (vision phase 1) ---

test("normalizeAvailabilityStatus accepts only real states and falls back to available_now", () => {
  assert.equal(normalizeAvailabilityStatus("SEASONAL"), "seasonal");
  assert.equal(normalizeAvailabilityStatus("not-a-real-status"), "available_now");
  assert.equal(normalizeAvailabilityStatus(undefined), "available_now");
  assert.deepEqual(AVAILABILITY_STATUSES, ["available_now", "scheduled", "seasonal", "preorder", "limited", "sold_out"]);
});

test("availabilityStatusLabel is human-readable for every real status", () => {
  for (const status of AVAILABILITY_STATUSES) {
    assert.match(availabilityStatusLabel(status), /^[A-Z]/);
  }
});

test("resolveDisplayPrice prefers the most specific set pack-size price, stem over bunch over box over case", () => {
  assert.deepEqual(resolveDisplayPrice({ price_per_stem: 2.5, price_per_bunch: 20, price: 99, unit: "each" }), {
    price: 2.5,
    unit: "stem",
    source: "price_per_stem"
  });
  assert.deepEqual(resolveDisplayPrice({ price_per_bunch: 20, price_per_case: 300 }), {
    price: 20,
    unit: "bunch",
    source: "price_per_bunch"
  });
});

test("resolveDisplayPrice falls back to the generic price/unit when no floral price is set — existing listings keep working unchanged", () => {
  assert.deepEqual(resolveDisplayPrice({ price: 19.99, unit: "each" }), { price: 19.99, unit: "each", source: "price" });
  assert.deepEqual(resolveDisplayPrice({}), { price: null, unit: "each", source: "price" });
});

test("resolveDisplayPrice ignores zero/negative pack prices — a $0 price_per_stem never wins over a real price", () => {
  assert.deepEqual(resolveDisplayPrice({ price_per_stem: 0, price: 19.99, unit: "each" }), {
    price: 19.99,
    unit: "each",
    source: "price"
  });
});

test("allUnitPrices lists every real pack-size price that's actually set", () => {
  assert.deepEqual(allUnitPrices({ price_per_stem: 2, price_per_case: 300 }), [
    { unit: "stem", price: 2 },
    { unit: "case", price: 300 }
  ]);
  assert.deepEqual(allUnitPrices({}), []);
});

test("normalizeSeasonalMonths keeps only real calendar months, deduped and sorted", () => {
  assert.deepEqual(normalizeSeasonalMonths([5, 3, 3, 13, 0, "not a month", 12]), [3, 5, 12]);
  assert.deepEqual(normalizeSeasonalMonths(null), []);
});

test("isCurrentlyAvailable trusts availability_status first, then honest date bounds — never assumes availability a seasonal listing didn't state", () => {
  assert.equal(isCurrentlyAvailable({ availability_status: "sold_out" }), false);
  assert.equal(isCurrentlyAvailable({ availability_status: "available_now" }), true);
  assert.equal(
    isCurrentlyAvailable({ availability_status: "scheduled", available_from: "2099-01-01" }, new Date("2026-08-19")),
    false
  );
  assert.equal(
    isCurrentlyAvailable({ availability_status: "seasonal", seasonal_months: [12] }, new Date("2026-08-19")),
    false
  );
  assert.equal(
    isCurrentlyAvailable({ availability_status: "seasonal", seasonal_months: [8] }, new Date("2026-08-19")),
    true
  );
});

test("validateFloralAttributes rejects non-positive pack sizes and a backwards date range, accepts a real listing", () => {
  assert.equal(validateFloralAttributes({ stems_per_bunch: -5 }).valid, false);
  assert.equal(validateFloralAttributes({ stem_length_in: 0 }).valid, false);
  assert.equal(
    validateFloralAttributes({ available_from: "2026-09-01", available_until: "2026-08-01" }).valid,
    false
  );
  assert.equal(validateFloralAttributes({ availability_status: "not-real" }).valid, false);
  assert.equal(
    validateFloralAttributes({
      variety: "Quicksand",
      stem_length_in: 24,
      stems_per_bunch: 25,
      price_per_bunch: 20,
      availability_status: "seasonal",
      available_from: "2026-09-01",
      available_until: "2026-12-01"
    }).valid,
    true
  );
});
