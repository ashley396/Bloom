import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Phase 5/9 wiring ("Lily, help me sell what I already have"): buildSocialPostTask/
// buildVideoConceptTask had zero inventory awareness until now — "I have 40
// roses I need to sell, make a Facebook post" could only ever produce invented
// flowers. generate_content now reuses marketing-inventory-grounding.js (PR
// #177/Priority 2's own shared, already-tested "never invent stock" helper)
// exactly the way the compound orchestrator already does for its image step —
// these tests prove it actually reaches THIS path too, not just documented.

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}
function baseDeps(client) {
  return { authenticate: async () => ({ user: { id: "u1" } }), createServerClient: () => client };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function mockCloudflareOnce(jsonResult) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) };
  };
  return {
    getSentBody: () => sentBody,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

test("generate_content: reads this shop's real current inventory before calling the model, scoped to the requesting shop", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "I have 40 roses to sell", status: "idea" }, error: null }, // currentItem
    { data: [{ id: "item-1", status: "generating" }], error: null }, // Batch 3: atomic claim
    { data: [], error: null }, // variants
    { data: { marketing_monthly_budget_cents: null }, error: null }, // budget: no shop default
    { data: { name: "Test Florals" }, error: null } // shopRow — a real shop must be verified before any generation
    // No further responses queued — real generation call has no Cloudflare
    // mock here and will fail past this point, which is fine: this test
    // only cares that the inventory read happened, scoped correctly,
    // before that failure.
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
  const inventoryCall = client.calls.find((c) => c.table === "inventory" && c.ops.some((op) => op[0] === "select"));
  assert.ok(inventoryCall, "generate_content must actually load this shop's real inventory before generating — the summary it produces is useless if never read");
  const shopEq = inventoryCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.ok(shopEq, "the inventory read must be scoped to the requesting shop — never a cross-shop leak");
  assert.equal(shopEq[1][1], "shop-1");
});

test("generate_content: real inventory rows reach the actual prompt sent to the model, and the resulting asset records exactly what it was grounded in", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "Fresh roses today!",
    body: "40 garden roses, fresh in today — order yours before they're gone.",
    cta: "Order now",
    visual_brief: "A bucket of garden roses on a counter.",
    hashtags: ["#roses"],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "Rose sale", brief: "I have 40 roses I need to sell", status: "idea" }, error: null }, // currentItem
      { data: [{ id: "item-1", status: "generating" }], error: null }, // Batch 3: atomic claim
      { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
      { data: { marketing_monthly_budget_cents: null }, error: null }, // budget: no shop default
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      {
        data: [{ id: "inv-1", name: "Garden Rose", category: "Flowers", quantity: 40, low_stock_level: 10, unit: "stems", created_at: new Date().toISOString() }],
        error: null
      }, // loadGroundedInventory: one real row
      { data: [], error: null }, // Phase 9 grounding: loadCustomerAudienceSummary — customers (none)
      { data: [], error: null }, // Phase 9 grounding: loadCustomerAudienceSummary — orders (none)
      { data: [], error: null }, // Phase 2 rebuild grounding: loadRecentContent (marketing_platform_variants)
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null }, // final content_items update
      { data: null, error: null } // audit insert
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `generate_content failed: ${res.body}`);

    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /Garden Rose \(40 stems in stock\)/, "the shop's real current inventory must reach the actual model prompt, not just sit in an inventory list nobody reads");
    // Phase 3 live-test fix: the anti-fabrication instruction is now a
    // standing rule, present with or without real inventory.
    assert.match(userMessage, /NEVER CLAIM A SPECIFIC BUSINESS FACT THAT ISN'T VERIFIED/);

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.deepEqual(
      assetInsert.payload.content.grounded_in_inventory,
      [{ inventory_id: "inv-1", name: "Garden Rose", quantity: 40, unit: "stems" }],
      "the persisted asset must record exactly which real inventory rows informed it — a real, checkable source list, never a guess at what the model used"
    );
  } finally {
    mock.restore();
  }
});

test("generate_content: an empty shop (no real inventory rows) degrades to no inventory grounding at all — never a fabricated one", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "h",
    body: "b",
    cta: "c",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null },
      { data: [{ id: "item-1", status: "generating" }], error: null }, // Batch 3: atomic claim
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: [], error: null }, // loadGroundedInventory: zero real rows
      { data: [], error: null }, // Phase 9 grounding: loadCustomerAudienceSummary — customers (none)
      { data: [], error: null }, // Phase 9 grounding: loadCustomerAudienceSummary — orders (none)
      { data: [], error: null }, // Phase 2 rebuild grounding: loadRecentContent (marketing_platform_variants)
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `generate_content failed: ${res.body}`);

    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.ok(!/real current inventory/i.test(userMessage), "no real inventory to ground on — the prompt must not claim any");
    assert.ok(!userMessage.includes("undefined"));

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.deepEqual(assetInsert.payload.content.grounded_in_inventory, [], "an empty shop must record an honestly empty source list, never a fabricated one");
  } finally {
    mock.restore();
  }
});
