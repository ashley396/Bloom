import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Batch 3 staging-acceptance investigation ("STOP THE LIVE RETEST AGAIN"):
// the real staging failure could not be diagnosed from outside because
// generate_content's own premium-creative call site (marketing-studio.js)
// logged NOTHING when the `if (engineRouteDecision.engine ===
// "premium_ai_creative" && (await isShopFeatureEnabled(...)))` branch
// evaluated false — a request the pure router correctly marked
// premium-eligible, a request the router itself sent straight to
// exact_layout, and a request where Premium Creative was actually
// attempted and failed all looked byte-for-byte identical from the
// outside: an exact_layout asset with zero OpenAI usage-ledger rows.
//
// These tests pin the fix: the router's own real decision
// (marketing_generate_content_engine_route_decision) is now logged on
// EVERY request that reaches this branch, and the feature flag's own real
// value (marketing_generate_content_premium_eligibility) is logged
// whenever — and only whenever — the router actually marked the request
// premium-eligible, preserving the exact short-circuit this codebase
// already relies on (isShopFeatureEnabled must never be queried for a
// request the router already routed to exact_layout on its own).

function floristDeps(client) {
  return { florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function mockCloudflareDualModel({ copyJson, imageBase64 }) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async (url) => {
    const isImageModel = String(url).includes("flux");
    return {
      ok: true,
      json: async () =>
        isImageModel
          ? { success: true, result: { image: imageBase64 } }
          : { success: true, result: { response: JSON.stringify(copyJson) } }
    };
  };
  return {
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

/** Same capture helper marketing-studio-generate-content-observability.test.js
 * already uses — parses structuredLog's own JSON wire format, keeping only
 * this feature's own "marketing_generate_content_" lines. */
async function captureTraceLogs(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  const capture = (line) => {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.message === "string" && parsed.message.startsWith("marketing_generate_content_")) lines.push(parsed);
    } catch {
      // Not a structuredLog JSON line — ignore.
    }
  };
  console.log = (line) => capture(line);
  console.warn = (line) => capture(line);
  console.error = (line) => capture(line);
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  delete process.env.FLORISYN_FLAG_MARKETING_STUDIO;
  // Fails isShopFeatureEnabled() closed to false via its own internal
  // service-role client — exactly the real staging shape this
  // investigation traced, never a fabricated true.
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
});
test.after(() => {
  process.env = { ...savedEnv };
});

// The first 11 responses are the exact, real, fixed sequence every request
// through this branch issues (currentItem load, atomic claim, variants,
// budget, shopRow, brand brain, style memory, inventory, audience x2,
// recent-content shortlist) — pinned exactly like every other test in this
// suite. What follows (usage-ledger writes, the image/media/asset
// inserts, the final variant/content-item updates) varies in COUNT
// depending on how many bounded image-quality attempts the request needs
// (a plain PASS on the first attempt vs. a FALLBACK after rejections) —
// this test is about the engine-route/eligibility LOGGING, not about
// pinning that unrelated internal retry count, so the tail is generous,
// content-agnostic filler `{ data: { id: "x<n>" }, error: null }` that
// satisfies whatever shape each remaining real query needs (an update, an
// insert().select().single(), ...) without asserting on it.
function subjectForwardResponses() {
  const fixed = [
    { data: { id: "item-1", content_type: "social_post", title: "t", brief: "", status: "idea" }, error: null }, // currentItem (brief overwritten per-test below)
    { data: [{ id: "item-1", status: "generating" }], error: null }, // atomic claim
    { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
    { data: { marketing_monthly_budget_cents: null }, error: null }, // budget
    { data: { name: "Test Florals" }, error: null }, // shopRow
    { data: null, error: null }, // loadBrandBrain
    { data: null, error: null }, // loadStyleMemory
    { data: [], error: null }, // loadGroundedInventory
    { data: [], error: null }, // audience: customers
    { data: [], error: null }, // audience: orders
    { data: [], error: null } // recent-content shortlist
  ];
  const filler = Array.from({ length: 20 }, (_, i) => ({ data: { id: `x${i}` }, error: null }));
  return [...fixed, ...filler];
}

test("generate_content logs the real engine-route decision AND the real (fail-closed) premium eligibility for a request the pure router marks premium-eligible", async () => {
  const mock = mockCloudflareDualModel({
    copyJson: {
      platform: "facebook",
      headline: "Beautiful Blooms",
      body: "A little something to brighten someone's day.",
      cta: "Shop now",
      visual_brief: "A bright seasonal bouquet.",
      hashtags: [],
      asset_requirements: [],
      brand_traits_used: [],
      visual_traits_used: []
    },
    imageBase64: Buffer.from("fake-jpeg-bytes").toString("base64")
  });
  try {
    const storage = createFakeSupabaseStorage({});
    const responses = subjectForwardResponses();
    // The real, exact request text from the traced staging failure —
    // ordinary/everyday, no operational-notice/promotion/sympathy signal,
    // so the pure router marks this premium-eligible (occasionCategory
    // "general" -> "everyday_floral").
    responses[0] = { data: { id: "item-1", content_type: "social_post", title: "t", brief: "Create today's Facebook post for Lilies in Bloom.", status: "idea" }, error: null };
    const client = createFakeSupabaseClient(responses, { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const { result: res, lines } = await captureTraceLogs(() => handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" })));
    assert.equal(res.statusCode, 200, `expected the fallback-to-exact-layout path to still succeed cleanly: ${res.body}`);

    const routeDecision = lines.find((l) => l.message === "marketing_generate_content_engine_route_decision");
    assert.ok(routeDecision, "the router's own real decision must be logged on every request that reaches this branch");
    assert.equal(routeDecision.engine, "premium_ai_creative", "the pure router must mark this ordinary request premium-eligible");
    assert.match(routeDecision.reason, /^ordinary_creative:/);

    const eligibility = lines.find((l) => l.message === "marketing_generate_content_premium_eligibility");
    assert.ok(eligibility, "premium eligibility must be logged whenever the router marked the request premium-eligible");
    assert.equal(eligibility.premiumFeatureEnabled, false, "with no real service-role key configured, isShopFeatureEnabled must fail closed to false — never fabricated true");

    // The final, persisted result honestly reflects Exact Layout, matching
    // the real traced staging behavior — this test is about observability,
    // not about changing what engine actually ran.
    const asset = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = asset?.payload?.content;
    assert.equal(insertedContent?.creative_engine, "exact_layout");
  } finally {
    mock.restore();
  }
});

test("generate_content logs the engine-route decision but NEVER queries the premium feature flag when the router itself already chose exact_layout (sympathy default)", async () => {
  const mock = mockCloudflareDualModel({
    copyJson: {
      platform: "facebook",
      headline: "In Loving Memory",
      body: "Our thoughts are with you and your family.",
      cta: "Call us",
      visual_brief: "A calm, respectful arrangement of white flowers.",
      hashtags: [],
      asset_requirements: [],
      brand_traits_used: [],
      visual_traits_used: []
    },
    imageBase64: Buffer.from("fake-jpeg-bytes").toString("base64")
  });
  try {
    const storage = createFakeSupabaseStorage({});
    const responses = subjectForwardResponses();
    responses[0] = { data: { id: "item-1", content_type: "social_post", title: "t", brief: "Create a sympathy Facebook post for Lilies in Bloom.", status: "idea" }, error: null };
    const client = createFakeSupabaseClient(responses, { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const { result: res, lines } = await captureTraceLogs(() => handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" })));
    assert.equal(res.statusCode, 200, `expected the sympathy default path to succeed cleanly: ${res.body}`);

    const routeDecision = lines.find((l) => l.message === "marketing_generate_content_engine_route_decision");
    assert.ok(routeDecision, "the router's own real decision must still be logged");
    assert.equal(routeDecision.engine, "exact_layout");
    assert.equal(routeDecision.reason, "sympathy_default");

    // The short-circuit this codebase relies on (never spend a real DB
    // round-trip checking a feature flag for a request the router already
    // sent to exact_layout on its own) must be completely unchanged.
    const eligibility = lines.find((l) => l.message === "marketing_generate_content_premium_eligibility");
    assert.equal(eligibility, undefined, "premium eligibility must NEVER be logged (or checked) when the router itself already chose exact_layout");
  } finally {
    mock.restore();
  }
});
