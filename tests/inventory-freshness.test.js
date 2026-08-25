import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInventoryDate,
  validateMarkupMultiplier,
  validateInventoryFreshnessFields,
  inventoryFreshnessBucket,
} from "../netlify/functions/_shared/inventory-freshness.js";

// inventory-freshness.js had only 68.7% coverage despite gating what a
// florist can actually save on an inventory item's freshness fields, and
// driving the use-first bucket that decides what shows as urgent.

test("parseInventoryDate: accepts a real YYYY-MM-DD date", () => {
  assert.deepEqual(parseInventoryDate("2026-05-01"), { value: "2026-05-01" });
});

test("parseInventoryDate: empty/blank input is treated as 'not provided', not an error", () => {
  assert.equal(parseInventoryDate(""), null);
  assert.equal(parseInventoryDate("  "), null);
  assert.equal(parseInventoryDate(undefined), null);
});

test("parseInventoryDate: rejects a wrong-shaped string before even trying to parse it", () => {
  assert.deepEqual(parseInventoryDate("05/01/2026"), { error: "Dates must use YYYY-MM-DD format." });
});

test("parseInventoryDate: rejects a right-shaped but impossible calendar date", () => {
  assert.deepEqual(parseInventoryDate("2026-13-45"), { error: "Enter a valid date." });
});

test("validateMarkupMultiplier: blank/missing defaults to 3.0x when not required", () => {
  assert.deepEqual(validateMarkupMultiplier(undefined), { ok: true, value: 3.0 });
  assert.deepEqual(validateMarkupMultiplier(""), { ok: true, value: 3.0 });
});

test("validateMarkupMultiplier: blank is an error when explicitly required", () => {
  const result = validateMarkupMultiplier("", { required: true });
  assert.equal(result.ok, false);
});

test("validateMarkupMultiplier: rejects a value outside the real 0.1x-50x business range", () => {
  assert.equal(validateMarkupMultiplier(0.05).ok, false);
  assert.equal(validateMarkupMultiplier(51).ok, false);
  assert.equal(validateMarkupMultiplier("not a number").ok, false);
});

test("validateMarkupMultiplier: accepts and rounds a valid value to 2 decimal places", () => {
  assert.deepEqual(validateMarkupMultiplier(2.4567), { ok: true, value: 2.46 });
});

test("validateInventoryFreshnessFields: a fully valid submission sanitizes cleanly with no errors", () => {
  const result = validateInventoryFreshnessFields({
    received_at: "2026-05-01",
    use_by: "2026-05-08",
    markup_multiplier: 3.5,
    item_kind: "flower",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.sanitized.received_at, "2026-05-01");
  assert.equal(result.sanitized.use_by, "2026-05-08");
  assert.equal(result.sanitized.markup_multiplier, 3.5);
});

test("validateInventoryFreshnessFields: falls back to the legacy arrival_date field when received_at isn't given", () => {
  const result = validateInventoryFreshnessFields({ arrival_date: "2026-05-01" });
  assert.equal(result.sanitized.received_at, "2026-05-01");
});

test("validateInventoryFreshnessFields: received_at takes priority over arrival_date when both are present", () => {
  const result = validateInventoryFreshnessFields({ received_at: "2026-05-02", arrival_date: "2026-05-01" });
  assert.equal(result.sanitized.received_at, "2026-05-02");
});

test("validateInventoryFreshnessFields: a use_by date before the received_at date is a real business-rule error", () => {
  const result = validateInventoryFreshnessFields({ received_at: "2026-05-10", use_by: "2026-05-01" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /cannot be before received date/.test(e)));
});

test("validateInventoryFreshnessFields: a malformed date produces a clear, field-labeled error and never crashes", () => {
  const result = validateInventoryFreshnessFields({ received_at: "not-a-date" });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /^Received date:/);
});

test("validateInventoryFreshnessFields: with no item_kind given, defaults from category — 'flower' only when category is exactly 'Flowers', otherwise 'supply'", () => {
  assert.equal(validateInventoryFreshnessFields({ category: "Flowers" }).sanitized.item_kind, "flower");
  assert.equal(validateInventoryFreshnessFields({}).sanitized.item_kind, "supply");
  assert.equal(validateInventoryFreshnessFields({ category: "Hard Goods" }).sanitized.item_kind, "supply");
});

test("validateInventoryFreshnessFields: an explicit item_kind is honored — its real value, not just its truthiness", () => {
  const result = validateInventoryFreshnessFields({ item_kind: "supply", category: "Flowers" });
  assert.equal(result.sanitized.item_kind, "supply", "an explicit item_kind must win over the category-based default");
});

test("validateInventoryFreshnessFields: an explicit item_kind value is preserved verbatim, not collapsed to a fixed flower/supply literal", () => {
  const result = validateInventoryFreshnessFields({ item_kind: "vase" });
  assert.equal(result.sanitized.item_kind, "vase");
});

test("inventoryFreshnessBucket: a zero or negative quantity is always archived, regardless of freshness score", () => {
  const bucket = inventoryFreshnessBucket({ quantity: 0 }, () => ({ score: 100, useFirst: false, expiringSoon: false }));
  assert.equal(bucket, "archived");
});

test("inventoryFreshnessBucket: a low freshness score buckets as use_first even without an explicit useFirst flag", () => {
  const bucket = inventoryFreshnessBucket({ quantity: 5 }, () => ({ score: 10, useFirst: false, expiringSoon: false }));
  assert.equal(bucket, "use_first");
});

test("inventoryFreshnessBucket: a mid-range score buckets as expiring_soon", () => {
  const bucket = inventoryFreshnessBucket({ quantity: 5 }, () => ({ score: 50, useFirst: false, expiringSoon: false }));
  assert.equal(bucket, "expiring_soon");
});

test("inventoryFreshnessBucket: a high score with in-stock quantity buckets as fresh", () => {
  const bucket = inventoryFreshnessBucket({ quantity: 5 }, () => ({ score: 90, useFirst: false, expiringSoon: false }));
  assert.equal(bucket, "fresh");
});

test("inventoryFreshnessBucket: with no freshnessFn given, falls back to the real default scorer using received_at/vase_life_days", () => {
  const freshBucket = inventoryFreshnessBucket({
    quantity: 10,
    received_at: new Date().toISOString().slice(0, 10),
    vase_life_days: 7,
  });
  assert.equal(freshBucket, "fresh", "an item received today with a week of vase life should be fresh");
});

test("inventoryFreshnessBucket: the default scorer has no received_at at all defaults to a perfect (fresh) score, never a crash", () => {
  const bucket = inventoryFreshnessBucket({ quantity: 5 });
  assert.equal(bucket, "fresh");
});
