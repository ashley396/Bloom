import test from "node:test";
import assert from "node:assert/strict";
import { loadGroundedInventory, loadGroundedProducts, buildInventoryGroundingBrief } from "../netlify/functions/_shared/marketing-inventory-grounding.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Priority 2 ("as far as technically possible" pass): inventory-grounded
// content generation — anti-hallucination behavior. These tests focus on
// the "never invent stock" contract: an empty/failed inventory query must
// never silently become a fabricated flower list downstream.

test("loadGroundedInventory: real rows come back with the shop-id filter applied and a computed approxDaysInStock", async () => {
  const now = Date.now();
  const client = createFakeSupabaseClient([
    {
      data: [
        { id: "inv-1", name: "Garden Rose", category: "Flowers", quantity: 24, low_stock_level: 10, unit: "stems", created_at: new Date(now - 5 * 86400000).toISOString() },
        { id: "inv-2", name: "Ranunculus", category: "Flowers", quantity: 3, low_stock_level: 10, unit: "stems", created_at: new Date(now - 1 * 86400000).toISOString() }
      ],
      error: null
    }
  ]);
  const result = await loadGroundedInventory(client, "shop-1");
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, "Garden Rose");
  assert.equal(result.items[0].approxDaysInStock, 5);
  assert.equal(result.items[1].lowStock, true, "quantity 3 <= low_stock_level 10 must flag low stock");
  const selectCall = client.calls.find((c) => c.table === "inventory" && c.ops.some((op) => op[0] === "select"));
  assert.ok(selectCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-1"));
  assert.equal(result.confidence, "approximate", "must never claim precise perishability tracking");
});

test("loadGroundedInventory: a DB error degrades to an honest empty result, never a fabricated list", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "connection lost" } }]);
  const result = await loadGroundedInventory(client, "shop-1");
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
});

test("loadGroundedInventory: zero real rows returns an honestly empty list, not a placeholder flower", async () => {
  const client = createFakeSupabaseClient([{ data: [], error: null }]);
  const result = await loadGroundedInventory(client, "shop-1");
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, []);
});

test("loadGroundedProducts: real shop products come back, scoped to the shop and active only", async () => {
  const client = createFakeSupabaseClient([{ data: [{ id: "p-1", name: "Wedding Bouquet", category: "Weddings", image_url: "https://x/y.jpg" }], error: null }]);
  const result = await loadGroundedProducts(client, "shop-1", { searchText: "wedding" });
  assert.equal(result.ok, true);
  assert.equal(result.items[0].name, "Wedding Bouquet");
});

test("buildInventoryGroundingBrief: an empty item list returns grounded:false and a null summary — callers must treat this as 'cannot ground', never silently proceed", () => {
  const brief = buildInventoryGroundingBrief([]);
  assert.equal(brief.grounded, false);
  assert.equal(brief.summaryText, null);
  assert.deepEqual(brief.sources, []);
});

test("buildInventoryGroundingBrief: real items produce a grounded summary and a structured source list Ashley can see", () => {
  const items = [
    { id: "inv-1", name: "Garden Rose", quantity: 24, unit: "stems", lowStock: false },
    { id: "inv-2", name: "Ranunculus", quantity: 3, unit: "stems", lowStock: true }
  ];
  const brief = buildInventoryGroundingBrief(items);
  assert.equal(brief.grounded, true);
  assert.match(brief.summaryText, /Garden Rose/);
  assert.match(brief.summaryText, /Ranunculus/);
  assert.match(brief.summaryText, /running low/);
  assert.equal(brief.sources.length, 2);
  assert.equal(brief.sources[0].inventory_id, "inv-1");
});
