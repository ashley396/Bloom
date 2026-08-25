import test from "node:test";
import assert from "node:assert/strict";
import { loadGenerationGrounding } from "../netlify/functions/_shared/marketing-generation-grounding.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Phase 4 ("one authoritative shop context layer for marketing generation")
// of the Lily Connected Intelligence pass. This composes marketing-brand-
// brain.js / ai-style-memory.js / marketing-inventory-grounding.js — these
// tests prove the composition and the memoization contract, not the
// underlying loaders themselves (already covered by their own test files).

test("loadGenerationGrounding: loads all three by default, scoped to the given shop", async () => {
  const client = createFakeSupabaseClient([
    { data: { preferences: { preferred_words: { traits: [{ text: "artisan", polarity: "positive", active: true }] } } }, error: null }, // brand brain
    { data: { preferences: {} }, error: null }, // style memory
    { data: [{ id: "inv-1", name: "Garden Rose", category: "Flowers", quantity: 40, low_stock_level: 10, unit: "stems", created_at: new Date().toISOString() }], error: null } // inventory
  ]);
  const result = await loadGenerationGrounding(client, "shop-1");
  assert.match(result.brandVoiceSummary, /artisan/);
  assert.match(result.inventorySummary, /Garden Rose/);
  assert.equal(result.inventorySources.length, 1);
  assert.equal(result.inventorySources[0].name, "Garden Rose");

  const brandCall = client.calls.find((c) => c.table === "marketing_brand_brain");
  assert.ok(brandCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-1"));
  const invCall = client.calls.find((c) => c.table === "inventory");
  assert.ok(invCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-1"));
});

test("loadGenerationGrounding: needs lets a caller skip what it doesn't use — never queries the tables it didn't ask for", async () => {
  const client = createFakeSupabaseClient([{ data: { preferences: {} }, error: null }]);
  const result = await loadGenerationGrounding(client, "shop-1", { needs: ["style"] });
  assert.equal(result.brandVoiceSummary, "");
  assert.equal(result.inventorySummary, null);
  assert.deepEqual(result.inventorySources, []);
  assert.equal(client.calls.find((c) => c.table === "marketing_brand_brain"), undefined);
  assert.equal(client.calls.find((c) => c.table === "inventory"), undefined);
  assert.ok(client.calls.find((c) => c.table === "ai_style_memory"));
});

test("loadGenerationGrounding: an empty shop (no real inventory) returns an honestly empty summary, never a fabricated one", async () => {
  const client = createFakeSupabaseClient([
    { data: { preferences: {} }, error: null },
    { data: { preferences: {} }, error: null },
    { data: [], error: null }
  ]);
  const result = await loadGenerationGrounding(client, "shop-1");
  assert.equal(result.inventorySummary, null);
  assert.deepEqual(result.inventorySources, []);
});

test("loadGenerationGrounding: memoizes onto a shared ctx — a second call for the same shop never re-queries", async () => {
  const client = createFakeSupabaseClient([
    { data: { preferences: {} }, error: null },
    { data: { preferences: {} }, error: null },
    { data: [], error: null }
  ]);
  const ctx = {};
  await loadGenerationGrounding(client, "shop-1", { ctx });
  const callCountAfterFirst = client.calls.length;
  await loadGenerationGrounding(client, "shop-1", { ctx });
  assert.equal(client.calls.length, callCountAfterFirst, "a second call sharing the same ctx must not re-query any of the three loaders");
});

// Phase 9 ("connect intelligence to marketing"): "audience" is opt-in only
// (never one of the three defaults) since its underlying queries are the
// heaviest of the four (full customers + orders history, unbounded).

test("loadGenerationGrounding: default needs never touch customers/orders — audience stays opt-in", async () => {
  const client = createFakeSupabaseClient([
    { data: { preferences: {} }, error: null },
    { data: { preferences: {} }, error: null },
    { data: [], error: null }
  ]);
  const result = await loadGenerationGrounding(client, "shop-1");
  assert.equal(result.audienceSummary, null);
  assert.equal(client.calls.find((c) => c.table === "customers"), undefined);
  assert.equal(client.calls.find((c) => c.table === "orders"), undefined);
});

test("loadGenerationGrounding: 'audience' in needs loads real, consent-aware audience data and threads it into the real prompt brief", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "c1", vip: true, created_at: "2020-01-01T00:00:00Z", contact_preferences: { marketing_opt_in: true } }], error: null }, // customers
    { data: [], error: null } // orders
  ]);
  const result = await loadGenerationGrounding(client, "shop-1", { needs: ["audience"] });
  assert.match(result.audienceSummary, /1 marketing subscriber\b/);
  assert.match(result.audienceSummary, /1 vip customers/i);
  assert.equal(result.brandVoiceSummary, "", "requesting only 'audience' must not also pull brand/style/inventory");

  const customersCall = client.calls.find((c) => c.table === "customers");
  assert.ok(customersCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-1"));
});

test("loadGenerationGrounding: 'audience' memoizes onto a shared ctx exactly like the other three", async () => {
  const client = createFakeSupabaseClient([
    { data: [], error: null }, // customers
    { data: [], error: null } // orders
  ]);
  const ctx = {};
  await loadGenerationGrounding(client, "shop-1", { needs: ["audience"], ctx });
  const callCountAfterFirst = client.calls.length;
  await loadGenerationGrounding(client, "shop-1", { needs: ["audience"], ctx });
  assert.equal(client.calls.length, callCountAfterFirst, "a second call sharing the same ctx must not re-query the audience loader");
});

test("loadGenerationGrounding: without a shared ctx, each call is independent (no accidental cross-request memoization)", async () => {
  const client = createFakeSupabaseClient([
    { data: { preferences: {} }, error: null },
    { data: { preferences: {} }, error: null },
    { data: [], error: null },
    { data: { preferences: {} }, error: null },
    { data: { preferences: {} }, error: null },
    { data: [], error: null }
  ]);
  await loadGenerationGrounding(client, "shop-1");
  const callCountAfterFirst = client.calls.length;
  await loadGenerationGrounding(client, "shop-1");
  assert.equal(client.calls.length, callCountAfterFirst * 2, "omitting ctx must never silently memoize across unrelated calls");
});
