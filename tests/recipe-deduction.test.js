import test from "node:test";
import assert from "node:assert/strict";
import { shouldDeductOnStatus, applyRecipeDeductions } from "../lib/inventory/recipe-deduction.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// lib/inventory/recipe-deduction.js had only 15.5% coverage despite being
// real money-adjacent logic — it's what actually takes stock off the shelf
// when an order fulfills. These lock in both the pure status gate and the
// real deduction/matching behavior against a fake client.

test("shouldDeductOnStatus: true for every real fulfillment-complete status, case-insensitively", () => {
  for (const status of ["READY", "pickup_ready", "Out_For_Delivery", "delivered", "COMPLETED"]) {
    assert.equal(shouldDeductOnStatus(status), true, `${status} should trigger deduction`);
  }
});

test("shouldDeductOnStatus: false for in-progress statuses and empty/missing input", () => {
  for (const status of ["NEW", "IN_PROGRESS", "CANCELLED", "", null, undefined]) {
    assert.equal(shouldDeductOnStatus(status), false, `${status} should not trigger deduction`);
  }
});

test("applyRecipeDeductions: missing shopId or productId returns a warning and never queries the database", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await applyRecipeDeductions(client, { shopId: null, productId: "p1" });
  assert.deepEqual(result.adjustments, []);
  assert.match(result.warnings[0], /no product linked/i);
  assert.equal(client.calls.length, 0);
});

test("applyRecipeDeductions: deducts by inventory_id when the recipe row has one, honoring the quantity multiplier", async () => {
  const client = createFakeSupabaseClient([
    // product_recipes select
    { data: [{ id: 1, ingredient_name: "Red Rose", quantity: 5, unit: "stem", inventory_id: 10 }], error: null },
    // inventory lookup by id (.maybeSingle())
    { data: { id: 10, name: "Red Rose", quantity: 40, unit: "stem" }, error: null },
    // inventory update (.select().single())
    { data: { id: 10, name: "Red Rose", quantity: 30, unit: "stem" }, error: null },
  ]);
  const result = await applyRecipeDeductions(client, { shopId: "shop-1", productId: "prod-1", quantity: 2 });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.adjustments, [
    { id: 10, name: "Red Rose", used: 10, before: 40, after: 30, unit: "stem" },
  ]);
  const updateCall = client.calls.find((c) => c.table === "inventory" && c.payload);
  assert.deepEqual(updateCall.payload, { quantity: 30 });
});

test("applyRecipeDeductions: without inventory_id, matches inventory by normalized color+name combined", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: 2, ingredient_name: "white rose", quantity: 3, unit: "stem", inventory_id: null }], error: null },
    // inventory list scan (no .single()/.maybeSingle() — awaited directly)
    { data: [{ id: 20, name: "Rose", color: "White", quantity: 10, unit: "stem" }], error: null },
    { data: { id: 20, name: "Rose", quantity: 7, unit: "stem" }, error: null },
  ]);
  const result = await applyRecipeDeductions(client, { shopId: "shop-1", productId: "prod-2" });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.adjustments[0].id, 20);
  assert.equal(result.adjustments[0].used, 3);
});

test("applyRecipeDeductions: without inventory_id, falls back to matching on name alone when combined color+name doesn't match", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: 3, ingredient_name: "Rose", quantity: 1, unit: "stem", inventory_id: null }], error: null },
    { data: [{ id: 30, name: "Rose", color: "Assorted", quantity: 5, unit: "stem" }], error: null },
    { data: { id: 30, name: "Rose", quantity: 4, unit: "stem" }, error: null },
  ]);
  const result = await applyRecipeDeductions(client, { shopId: "shop-1", productId: "prod-3" });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.adjustments[0].id, 30, "name-only fallback match should still find the row");
});

test("applyRecipeDeductions: ingredient not found in inventory produces a warning, no update call", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: 4, ingredient_name: "Peony", quantity: 2, unit: "stem", inventory_id: null }], error: null },
    { data: [], error: null },
  ]);
  const result = await applyRecipeDeductions(client, { shopId: "shop-1", productId: "prod-4" });
  assert.deepEqual(result.adjustments, []);
  assert.match(result.warnings[0], /Peony: not found in inventory/);
});

test("applyRecipeDeductions: insufficient stock produces a warning, never deducts a negative amount", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: 5, ingredient_name: "Tulip", quantity: 10, unit: "stem", inventory_id: 50 }], error: null },
    { data: { id: 50, name: "Tulip", quantity: 4, unit: "stem" }, error: null },
  ]);
  const result = await applyRecipeDeductions(client, { shopId: "shop-1", productId: "prod-5" });
  assert.deepEqual(result.adjustments, []);
  assert.match(result.warnings[0], /Tulip: recipe needed 10, but only 4 was available/);
  const updateCalled = client.calls.some((c) => c.table === "inventory" && c.payload);
  assert.equal(updateCalled, false, "must never write a partial/negative deduction");
});

test("applyRecipeDeductions: multiple recipe rows are each resolved independently — one success, one shortage", async () => {
  const client = createFakeSupabaseClient([
    {
      data: [
        { id: 6, ingredient_name: "Red Rose", quantity: 5, unit: "stem", inventory_id: 60 },
        { id: 7, ingredient_name: "Baby's Breath", quantity: 3, unit: "bunch", inventory_id: null },
      ],
      error: null,
    },
    { data: { id: 60, name: "Red Rose", quantity: 20, unit: "stem" }, error: null },
    { data: { id: 60, name: "Red Rose", quantity: 15, unit: "stem" }, error: null },
    { data: [{ id: 61, name: "Baby's Breath", color: "", quantity: 1, unit: "bunch" }], error: null },
  ]);
  const result = await applyRecipeDeductions(client, { shopId: "shop-1", productId: "prod-6" });
  assert.equal(result.adjustments.length, 1);
  assert.equal(result.adjustments[0].name, "Red Rose");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Baby's Breath/);
});

test("applyRecipeDeductions: a zero or negative recipe quantity is skipped entirely (no lookup, no warning)", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: 8, ingredient_name: "Filler", quantity: 0, unit: "stem", inventory_id: 80 }], error: null },
  ]);
  const result = await applyRecipeDeductions(client, { shopId: "shop-1", productId: "prod-7" });
  assert.deepEqual(result.adjustments, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(client.calls.length, 1, "only the product_recipes query should run — no inventory lookup for a zero-quantity line");
});

test("applyRecipeDeductions: a product_recipes query error is thrown, not swallowed", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: new Error("db unreachable") }]);
  await assert.rejects(
    () => applyRecipeDeductions(client, { shopId: "shop-1", productId: "prod-8" }),
    /db unreachable/
  );
});

test("applyRecipeDeductions: an inventory update error is thrown, not swallowed", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: 9, ingredient_name: "Lily", quantity: 1, unit: "stem", inventory_id: 90 }], error: null },
    { data: { id: 90, name: "Lily", quantity: 10, unit: "stem" }, error: null },
    { data: null, error: new Error("write conflict") },
  ]);
  await assert.rejects(
    () => applyRecipeDeductions(client, { shopId: "shop-1", productId: "prod-9" }),
    /write conflict/
  );
});
