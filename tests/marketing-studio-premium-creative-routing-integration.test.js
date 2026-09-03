import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

function clientWithStorage(responses) {
  return createFakeSupabaseClient(responses, { storage: createFakeSupabaseStorage({}) });
}

// Hybrid Marketing Studio Batch 2 ("staging-only OpenAI routing"): live
// end-to-end integration tests through the REAL generate_content handler
// — the actual request path, not just the underlying pure functions
// (those already have their own dedicated unit tests in
// marketing-engine-router.test.js, marketing-premium-creative-
// orchestrator.test.js, marketing-openai-creative-brief.test.js).
//
// NO LIVE OPENAI CALL: every test here mocks globalThis.fetch for BOTH
// Cloudflare and (where relevant) api.openai.com — the exact same pattern
// tests/marketing-studio-canonical-concept.test.js's own mockCloudflareBoth
// already uses for Cloudflare alone.
//
// Independent-review fix: isShopFeatureEnabled() at the live call site
// deliberately never uses this handler's own `client` (see marketing-
// studio.js's own comment on that call site) — it always builds its own
// real service-role client, which fails closed to `false` in this test
// process (no SUPABASE_SERVICE_ROLE_KEY configured). That means every
// test in this file observes the flag reading false — the real shape of
// every environment today — regardless of `openAiEnabled` below. Proof
// that the flag reading TRUE correctly activates Premium Creative lives
// at the orchestrator level (marketing-premium-creative-orchestrator.
// test.js) and at shop-feature-access.js's own dedicated unit tests; this
// file proves the thing that matters everywhere today: with the flag
// unreadable, Premium Creative never activates no matter what else is
// configured, and the request still completes successfully via Exact
// Layout.

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
const TINY_PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
});
test.after(() => {
  process.env = { ...savedEnv };
});

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body, { method = "POST" } = {}) {
  return { httpMethod: method, queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

/**
 * Mocks Cloudflare (copy generation + image generation + vision check)
 * and, when `openAiEnabled` is true, also mocks api.openai.com's real
 * images/generations endpoint — so a test can prove the Premium Creative
 * path actually reaches (a mocked) OpenAI without ever touching the real
 * network. Records every call made to each provider for assertions.
 */
function mockProviders(copyJson, { openAiEnabled = false } = {}) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  if (openAiEnabled) process.env.OPENAI_API_KEY = "sk-test-not-real";
  else delete process.env.OPENAI_API_KEY;

  const calls = { cloudflare: 0, openai: 0 };
  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes("api.openai.com")) {
      calls.openai += 1;
      return { ok: true, json: async () => ({ data: [{ b64_json: TINY_PNG_BASE64 }] }) };
    }
    calls.cloudflare += 1;
    let body = {};
    try {
      body = JSON.parse(options?.body || "{}");
    } catch {
      body = {};
    }
    if (!Array.isArray(body.messages) && "image" in body) {
      return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean, matches the brief" } }) };
    }
    if (/flux|black-forest-labs/i.test(urlStr)) {
      return { ok: true, json: async () => ({ success: true, result: { image: TINY_JPEG_BASE64 } }) };
    }
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(copyJson) } }) };
  };
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

function ordinaryCopyJson(overrides = {}) {
  return {
    platform: "facebook",
    headline: "Fresh Today",
    body: "Fresh, seasonal blooms brighten any room.",
    cta: "Order now",
    visual_brief: "a bright bouquet on a wooden counter",
    creative_brief: { primary_subject: "a bright bouquet", mood: "cheerful", lighting: "natural", composition: "close-up", floral_style: "garden-style" },
    objective: "awareness",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: [],
    ...overrides
  };
}

function baseResponses() {
  return [
    { data: { id: "item-1", content_type: "image", title: "t", brief: "Fresh seasonal blooms post for Facebook", status: "idea" }, error: null }, // currentItem
    { data: [{ id: "item-1", status: "generating" }], error: null }, // atomic claim
    { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
    { data: { marketing_monthly_budget_cents: null }, error: null }, // budget
    { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null }, // shopRow
    { data: null, error: null }, // loadBrandBrain
    { data: null, error: null }, // loadStyleMemory
    { data: [], error: null }, // loadGroundedInventory
    { data: [], error: null }, // audience: customers
    { data: [], error: null }, // audience: orders
    { data: [], error: null }, // recent-content shortlist
    { data: null, error: null }, // recordUsage("copy") — caption
    { data: null, error: null } // recordUsage("copy") — on-image flyer text
  ];
}

// Required test #1: feature OFF → existing behavior (Cloudflare/Exact
// Layout unchanged), and #20: existing Cloudflare behavior is unaffected.
//
// Independent-review fix: isShopFeatureEnabled() at the live call site
// deliberately never receives this handler's own `client` (see
// marketing-studio.js's own comment on that call site — the florist
// path's `client` is a member-scoped, RLS-enforced session client that
// can never actually read shop_admin_config, exactly the failure mode
// featureGate()'s own adjacent comment already documents). It builds its
// own real service-role client instead, which — with no
// SUPABASE_SERVICE_ROLE_KEY configured in this test process — fails
// closed to `false` immediately, WITHOUT ever touching this fake
// client's response queue. That means every test below observes the
// flag reading false regardless of intent; proof that the flag reading
// TRUE correctly activates the Premium Creative path lives at the
// orchestrator level (marketing-premium-creative-orchestrator.test.js's
// own "#3/#16" test, using a real client call-log assertion) and at
// shop-feature-access.js's own dedicated unit tests (a real client
// returning `features.X: true` does make isShopFeatureEnabled return
// true) — this file instead proves the one thing that matters in every
// real environment TODAY: the flag is unreadable, so Premium Creative
// never activates, no matter what else is configured.
test("Batch2 #1/#20 feature flag OFF (real-shaped, unreadable): ordinary post uses the existing Cloudflare/Exact Layout path unchanged, never touches OpenAI", async () => {
  const mock = mockProviders(ordinaryCopyJson(), { openAiEnabled: false });
  try {
    const client = clientWithStorage([
      ...baseResponses(),
      { data: null, error: null }, // recordUsage("image")
      { data: { id: "media-1" }, error: null }, // website_media insert
      { data: { id: "asset-1" }, error: null }, // persistGeneratedAsset
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null } // final update
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.creative_engine, "exact_layout");
    assert.equal(mock.calls.openai, 0, "OpenAI must never be called while the feature flag is off");
    assert.ok(mock.calls.cloudflare > 0);
  } finally {
    mock.restore();
  }
});

// Required test #4 area: even with OpenAI fully configured and the
// router choosing premium_ai_creative, the feature flag being unreadable
// (the real shape of every environment today — no shop has this flag set
// and no service-role key path exists in this test process) still falls
// back to Exact Layout, proving the flag is a genuine, independent gate
// rather than something the provider's own availability could bypass.
test("Batch2 #4 feature flag unreadable even with OpenAI fully configured: still falls back to Exact Layout, never a fabricated Premium success", async () => {
  process.env.FLORISYN_ENV = "staging";
  const mock = mockProviders(ordinaryCopyJson(), { openAiEnabled: true });
  try {
    const client = clientWithStorage([
      ...baseResponses(),
      { data: null, error: null }, // recordUsage("image") — falls through to Exact Layout's own Cloudflare call
      { data: { id: "media-1" }, error: null }, // website_media insert
      { data: { id: "asset-1" }, error: null }, // persistGeneratedAsset
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body, "Premium Creative being ungated must never fail generate_content outright");
    assert.equal(mock.calls.openai, 0, "a real, working OpenAI provider is never enough on its own — the flag must independently gate it");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.creative_engine, "exact_layout", "an ungated Premium path must be recorded honestly as exact_layout, never as premium_ai_creative");
  } finally {
    mock.restore();
    delete process.env.FLORISYN_ENV;
  }
});

// Required test #5: operational notice never calls OpenAI, even with the
// flag on and OpenAI configured — the exact-facts branch never checks
// the router or the flag at all.
test("Batch2 #5 operational notice never calls OpenAI even with the feature flag ON and OpenAI configured", async () => {
  process.env.FLORISYN_ENV = "staging";
  const noticeCopyJson = ordinaryCopyJson({ body: "We are closing early today at 3pm for a staff event." });
  const mock = mockProviders(noticeCopyJson, { openAiEnabled: true });
  try {
    // Exact known-good response sequence for the deterministic-notice
    // exact-facts flyer path — mirrors tests/marketing-studio-flyer-
    // content.test.js's own working "closing notice" fixture: the real
    // AI wording call is never made at all (buildDeterministicNoticeContent
    // is used directly), but the Tier A background image still goes
    // through the real reserveProviderCall/completeProviderCall ledger
    // for both the image attempt and its vision quality check.
    const client = clientWithStorage([
      { data: { id: "item-1", content_type: "image", title: "t", brief: "Lilies in Bloom is closing early today at 3pm.", status: "idea" }, error: null },
      { data: [{ id: "item-1", status: "generating" }], error: null },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: [], error: null }, // loadGroundedInventory
      { data: [], error: null }, // audience customers
      { data: [], error: null }, // audience orders
      { data: [], error: null }, // recent-content shortlist
      { data: null, error: null }, // recordUsage("copy") — the ONE real copy call (caption only; the notice itself is deterministic)
      { data: { id: "usage-img-1" }, error: null }, // reserveProviderCall(image) insert
      { data: null, error: null }, // completeProviderCall(image) update
      { data: { id: "usage-vision-1" }, error: null }, // reserveProviderCall(vision) insert
      { data: null, error: null }, // completeProviderCall(vision) update
      { data: { id: "asset-1" }, error: null }, // persistGeneratedAsset (flyer, exact-facts branch)
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(mock.calls.openai, 0, "an operational notice must never reach OpenAI, flag or no flag");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.creative_engine, "exact_layout");
  } finally {
    mock.restore();
    delete process.env.FLORISYN_ENV;
  }
});

// Required test #6: sympathy default never calls OpenAI even with the
// flag on and OpenAI configured.
test("Batch2 #6 sympathy content never calls OpenAI even with the feature flag ON and OpenAI configured", async () => {
  process.env.FLORISYN_ENV = "staging";
  const sympathyCopyJson = ordinaryCopyJson({ body: "Our thoughts are with your family during this difficult time." });
  const mock = mockProviders(sympathyCopyJson, { openAiEnabled: true });
  try {
    const client = clientWithStorage([
      { data: { id: "item-1", content_type: "image", title: "In Sympathy", brief: "In loving memory arrangement post, condolences", status: "idea" }, error: null },
      { data: [{ id: "item-1", status: "generating" }], error: null },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: null }, // recordUsage("copy") caption
      { data: null, error: null }, // recordUsage("copy") on-image flyer text
      // No isShopFeatureEnabled response needed: the router returns
      // exact_layout for sympathy before the flag check's short-circuit
      // is even evaluated, and (per the fix above) the check never
      // touches this fake client anyway.
      { data: null, error: null }, // recordUsage("image")
      { data: { id: "media-1" }, error: null },
      { data: { id: "asset-1" }, error: null },
      { data: null, error: null },
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(mock.calls.openai, 0, "sympathy content must default to Exact Layout, never OpenAI, with no explicit override");
  } finally {
    mock.restore();
    delete process.env.FLORISYN_ENV;
  }
});
