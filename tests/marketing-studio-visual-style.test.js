import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Lily Creative Style Learning: connects recordBrandSignal() (writing
// voice, marketing-brand-brain.js — previously orphaned, never called from
// real product behavior) and recordApprovalSignal() (visual style,
// ai-style-memory.js — the shop's separate "My Style" memory, previously
// never wired to Marketing Studio at all) to a real Approve/Reject
// decision. Also adds the "My Style" CRUD actions (get/update/forget/
// reset_visual_style) Marketing Studio's admin console needs to expose
// what Lily has learned, mirroring the existing get/update/forget/
// reset_brand_brain actions exactly.

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}

function nonSuperAdminRow() {
  return { data: { user_id: "u1", role: "support", active: true }, error: null };
}

function baseDeps(client) {
  return {
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client
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

function event(action, body, { method = "POST", qs = {} } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { action, ...qs },
    headers: {},
    body: JSON.stringify({ action, ...body })
  };
}

function mockCloudflareOnce(jsonResult) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) });
  return {
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

// ── "My Style" CRUD ─────────────────────────────────────────────────────

test("get_visual_style: returns categories grouped active/learning plus a summary, scoped to the requesting shop — no embeddings/confidence/model jargon", async () => {
  const learnedPrefs = {
    background_style: { traits: [{ text: "soft luxury", polarity: "positive", source: "explicit", active: true, evidence_count: 1, last_signal_at: null }] },
    lighting: { traits: [{ text: "warm natural light", polarity: "positive", source: "inferred", active: false, evidence_count: 1, last_signal_at: null }] }
  };
  const client = createFakeSupabaseClient([superAdminRow(), { data: { preferences: learnedPrefs }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("get_visual_style", { shop_id: "shop-1" }, { method: "GET" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.categories.background_style.active[0].text, "soft luxury");
  assert.equal(body.categories.lighting.learning[0].text, "warm natural light");
  assert.match(body.summary, /soft luxury/);
  // No internal ML/dev jargon in the payload shape itself — only the plain
  // active/learning trait lists and a human-readable summary string.
  assert.deepEqual(Object.keys(body).sort(), ["categories", "summary"]);
  const styleCall = client.calls.find((c) => c.table === "ai_style_memory");
  const shopEq = styleCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.equal(shopEq[1][1], "shop-1");
});

test("update_visual_style: requires super_admin", async () => {
  const client = createFakeSupabaseClient([nonSuperAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_visual_style", { shop_id: "shop-1", updates: [{ category: "mood", text: "elegant", polarity: "positive" }] }));
  assert.equal(res.statusCode, 403);
});

test("update_visual_style: writes an explicit trait immediately at full strength, scoped to the requesting shop, with an audit trail", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }, { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_visual_style", { shop_id: "shop-1", updates: [{ category: "mood", text: "elegant", polarity: "positive" }] }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.categories.mood.active[0].text, "elegant");
  const upsertCall = client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert"));
  assert.ok(upsertCall, "must persist to the shop's real My Style row");
  const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
  assert.ok(auditCall, "an explicit style edit must leave a real audit trail");
});

test("forget_visual_style_trait: removes one trait outright, requires super_admin", async () => {
  const client = createFakeSupabaseClient([nonSuperAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("forget_visual_style_trait", { shop_id: "shop-1", category: "mood", text: "elegant" }));
  assert.equal(res.statusCode, 403);
});

test("reset_visual_style: clears everything learned for this shop, requires super_admin, with an audit trail", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("reset_visual_style", { shop_id: "shop-1" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.summary, "");
  const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
  assert.ok(auditCall);
});

// ── approve_content: the real learning signal ───────────────────────────

function approveContentQueue({ decision, brandTraits = [], visualTraits = [] }) {
  return [
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null }, // current item lookup
    { data: { id: "item-1", status: decision === "approved" ? "approved" : "archived" }, error: null }, // status update
    { data: [{ asset_id: "asset-1" }], error: null }, // variantAssets select
    { data: [{ id: "asset-1", content: { brand_traits_used: brandTraits, visual_traits_used: visualTraits } }], error: null }, // ai_generated_assets select
    ...(brandTraits.length ? [{ data: null, error: null }, { data: null, error: null }] : []), // loadBrandBrain + saveBrandBrain
    ...(visualTraits.length ? [{ data: null, error: null }, { data: null, error: null }] : []) // loadStyleMemory + saveStyleMemory
  ];
}

test("approve_content: an Approve reinforces both Brand Brain (writing) AND My Style (visual) from the SAME real generation's actual traits_used", async () => {
  const brandTraits = [{ category: "preferred_words", text: "artisan" }];
  const visualTraits = [{ category: "background_style", text: "soft luxury" }];
  const client = createFakeSupabaseClient(approveContentQueue({ decision: "approved", brandTraits, visualTraits }));
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("approve_content", { shop_id: "shop-1", content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200);

  const brandUpsert = client.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert"));
  assert.ok(brandUpsert, "an Approve with brand_traits_used must reinforce Brand Brain — recordBrandSignal() must actually run");
  assert.equal(brandUpsert.payload.shop_id, "shop-1");
  assert.equal(brandUpsert.payload.preferences.preferred_words.traits[0].evidence_count, 1);

  const styleUpsert = client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert"));
  assert.ok(styleUpsert, "an Approve with visual_traits_used must reinforce My Style — recordApprovalSignal() must actually run");
  assert.equal(styleUpsert.payload.shop_id, "shop-1");
  assert.equal(styleUpsert.payload.preferences.background_style.traits[0].evidence_count, 1);
  assert.equal(styleUpsert.payload.preferences.background_style.traits[0].active, false, "one signal is never enough to promote a trait — real repetition is required");
});

test("approve_content: three real Approvals of the same visual trait promote it to an ACTIVE preference — matches the documented threshold, never a single-click promotion", async () => {
  const visualTraits = [{ category: "lighting", text: "warm natural light" }];
  let preferences = { lighting: { traits: [{ text: "warm natural light", polarity: "positive", source: "inferred", active: false, evidence_count: 2, last_signal_at: null }] } };
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: { id: "item-1", status: "approved" }, error: null },
    { data: [{ asset_id: "asset-1" }], error: null },
    { data: [{ id: "asset-1", content: { brand_traits_used: [], visual_traits_used: visualTraits } }], error: null },
    { data: { preferences }, error: null }, // loadStyleMemory — already at evidence_count 2 from two earlier real approvals
    { data: null, error: null } // saveStyleMemory
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("approve_content", { shop_id: "shop-1", content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200);
  const styleUpsert = client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert"));
  const trait = styleUpsert.payload.preferences.lighting.traits[0];
  assert.equal(trait.evidence_count, 3);
  assert.equal(trait.active, true, "the third real Approve must promote this trait to active — Lily now actually applies it");
});

test("approve_content: a Reject weakens the visual trait (signal mapped to 'undone', not 'approved') — never reinforces on a rejection", async () => {
  const visualTraits = [{ category: "colors", text: "neon pink" }];
  let preferences = { colors: { traits: [{ text: "neon pink", polarity: "positive", source: "inferred", active: false, evidence_count: 1, last_signal_at: null }] } };
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: { id: "item-1", status: "archived" }, error: null },
    { data: [{ asset_id: "asset-1" }], error: null },
    { data: [{ id: "asset-1", content: { brand_traits_used: [], visual_traits_used: visualTraits } }], error: null },
    { data: { preferences }, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("approve_content", { shop_id: "shop-1", content_item_id: "item-1", decision: "rejected" }));
  assert.equal(res.statusCode, 200);
  const styleUpsert = client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert"));
  const category = styleUpsert.payload.preferences.colors;
  // A brand-new (evidence_count 1) inferred candidate fully reversed by one
  // Reject is removed outright, never flipped into an active "dislike" out
  // of nowhere — same rule ai-style-memory.js's recordApprovalSignal() has
  // always enforced; this proves approve_content actually calls it with
  // "undone", not "approved", on a Reject.
  assert.equal(category.traits.length, 0);
});

test("approve_content: no traits_used on any linked asset -> no Brand Brain or My Style write at all — never a fabricated signal", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: { id: "item-1", status: "approved" }, error: null },
    { data: [{ asset_id: "asset-1" }], error: null },
    { data: [{ id: "asset-1", content: { url: "https://example.com/x.jpg" } }], error: null } // no traits_used fields at all
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("approve_content", { shop_id: "shop-1", content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200);
  assert.equal(client.calls.find((c) => c.table === "marketing_brand_brain"), undefined);
  assert.equal(client.calls.find((c) => c.table === "ai_style_memory"), undefined);
});

test("approve_content: a content item with no variants/assets at all approves cleanly with no signal write (nothing to learn from)", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: { id: "item-1", status: "approved" }, error: null },
    { data: [], error: null } // variantAssets — no variants at all
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("approve_content", { shop_id: "shop-1", content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200);
  assert.equal(client.calls.find((c) => c.table === "ai_generated_assets"), undefined, "must never even query assets when there are no variants to source them from");
});

test("approve_content: every Brand Brain / My Style read+write this action performs is scoped to the REQUESTING shop, not the content item's implied shop — real tenant isolation, not just a happy-path coincidence", async () => {
  const brandTraits = [{ category: "preferred_words", text: "artisan" }];
  const visualTraits = [{ category: "mood", text: "elegant" }];
  const client = createFakeSupabaseClient(approveContentQueue({ decision: "approved", brandTraits, visualTraits }));
  const handler = createMarketingStudioHandler(baseDeps(client));
  await handler(event("approve_content", { shop_id: "shop-9-real-tenant", content_item_id: "item-1", decision: "approved" }));

  for (const table of ["marketing_brand_brain", "ai_style_memory"]) {
    const calls = client.calls.filter((c) => c.table === table);
    assert.ok(calls.length >= 2, `expected both a load and a save against ${table}`);
    for (const call of calls) {
      const shopEq = call.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
      const scopedShop = shopEq ? shopEq[1][1] : call.payload?.shop_id;
      assert.equal(scopedShop, "shop-9-real-tenant", `${table} call must be scoped to the requesting shop, never another tenant's`);
    }
  }
});

// ── generate_content: end-to-end trait persistence (the other half of the
// loop approve_content reads back from) ────────────────────────────────

test("generate_content: a text_post's real generation persists brand_traits_used/visual_traits_used onto its own asset, and links it to the variant — previously a text_post had NO backing asset at all", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "h",
    body: "Order your fall bouquet today.",
    cta: "Order now",
    visual_brief: "v",
    hashtags: ["#fall"],
    asset_requirements: [],
    brand_traits_used: [{ category: "preferred_words", text: "artisan" }],
    visual_traits_used: [{ category: "mood", text: "elegant" }]
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "Fall Bouquet", brief: "b", status: "idea" }, error: null }, // currentItem
      { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variantsResult
      { data: { marketing_monthly_budget_cents: null }, error: null }, // budget: no shop default configured
      { data: null, error: null }, // content_items update -> generating
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: null, error: null }, // recordUsage insert
      { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset (social_copy)
      { data: null, error: null }, // marketing_platform_variants update (1 variant)
      { data: { id: "item-1", status: "draft" }, error: null }, // final content_items update
      { data: null, error: null } // writeCommandAudit insert
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200);

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.ok(assetInsert, "a text_post must now get its own real asset row — previously nothing was persisted at all");
    assert.equal(assetInsert.payload.asset_type, "social_copy");
    assert.deepEqual(assetInsert.payload.content.brand_traits_used, [{ category: "preferred_words", text: "artisan" }]);
    assert.deepEqual(assetInsert.payload.content.visual_traits_used, [{ category: "mood", text: "elegant" }]);

    const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
    assert.equal(variantUpdate.payload.asset_id, "copy-asset-1", "the variant must be linked to the real asset — approve_content can only read traits_used back through this link");
    // A text_post never rendered an image — disclosure must never claim a
    // generative image was used just because a (text-only) asset row now exists.
    assert.equal(variantUpdate.payload.generative_image_used, false);
    assert.equal(variantUpdate.payload.ai_content_type, "none");
  } finally {
    mock.restore();
  }
});
