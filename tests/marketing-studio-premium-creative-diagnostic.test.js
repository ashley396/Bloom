import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Batch 3 staging-acceptance fix ("STRICT EVIDENCE MODE — durable runtime
// trace"): pins the call-site-level `premium_creative_diagnostic` object
// generate_content persists onto the asset's own content — the durable,
// Supabase-readable record of router decision -> feature-flag
// eligibility -> (when attempted) environment/provider/usage/execution/
// orchestrator -> fallback, all merged from the exact values the real
// path already computed (marketing-engine-router.js, shop-feature-
// access.js, marketing-premium-creative-orchestrator.js) — never
// recomputed here. See marketing-premium-creative-orchestrator-
// diagnostic.test.js for the orchestrator's own internal diagnostic
// (environment/provider/usage/execution/orchestrator sub-objects) in
// isolation.

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

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  delete process.env.FLORISYN_FLAG_MARKETING_STUDIO;
  // isShopFeatureEnabled() must fail closed to false via its own internal
  // service-role client — exactly the real staging shape this
  // investigation traced, never a fabricated true.
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
});
test.after(() => {
  process.env = { ...savedEnv };
});

function subjectForwardResponses() {
  const fixed = [
    { data: { id: "item-1", content_type: "social_post", title: "t", brief: "", status: "idea" }, error: null },
    { data: [{ id: "item-1", status: "generating" }], error: null },
    { data: [{ id: "variant-1", platform: "facebook" }], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: { name: "Test Florals" }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null }
  ];
  const filler = Array.from({ length: 20 }, (_, i) => ({ data: { id: `x${i}` }, error: null }));
  return [...fixed, ...filler];
}

function findInsertedContent(client) {
  const asset = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
  return asset?.payload?.content;
}

test("matrix #1/#12: router chooses exact_layout on its own (sympathy) — diagnostic honestly records Premium was never attempted, with a specific fallback reason", async () => {
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
    const responses = subjectForwardResponses();
    responses[0] = { data: { id: "item-1", content_type: "social_post", title: "t", brief: "Create a sympathy Facebook post for Lilies in Bloom.", status: "idea" }, error: null };
    const storage = createFakeSupabaseStorage({});
    const client = createFakeSupabaseClient(responses, { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, `expected the sympathy default path to succeed cleanly: ${res.body}`);

    const content = findInsertedContent(client);
    const diag = content.premium_creative_diagnostic;
    assert.ok(diag, "a diagnostic must be persisted even when the router never picks Premium");
    assert.equal(diag.router.engine, "exact_layout");
    assert.equal(diag.router.reason, "sympathy_default");
    assert.equal(diag.eligibility.feature_flag_enabled, null, "the feature flag must never be checked (or fabricated as false) when the router already chose exact_layout on its own");
    assert.equal(diag.orchestrator.attempted, false);
    assert.equal(diag.execution.provider_generate_entered, false);
    assert.deepEqual(diag.fallback, { occurred: true, final_engine: "exact_layout", reason: "router_exact_layout" });
    assert.equal(content.creative_engine, "exact_layout");
  } finally {
    mock.restore();
  }
});

test("matrix #2/#3/#12/#14: router chooses premium, feature flag reads false (fail-closed) — diagnostic preserves the ORIGINAL router decision even though the final engine falls through to Exact Layout", async () => {
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
    const responses = subjectForwardResponses();
    // The real, exact request text from the traced staging failure.
    responses[0] = { data: { id: "item-1", content_type: "social_post", title: "t", brief: "Create today's Facebook post for Lilies in Bloom.", status: "idea" }, error: null };
    const storage = createFakeSupabaseStorage({});
    const client = createFakeSupabaseClient(responses, { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, `expected the fallback-to-exact-layout path to still succeed cleanly: ${res.body}`);

    const content = findInsertedContent(client);
    const diag = content.premium_creative_diagnostic;
    // Matrix item 2: the pure router's own real decision for this exact
    // ordinary request.
    assert.equal(diag.router.engine, "premium_ai_creative");
    assert.match(diag.router.reason, /^ordinary_creative:/);
    // Matrix item 3: the real (fail-closed, no service-role key in this
    // test process) feature-flag value.
    assert.equal(diag.eligibility.feature_flag_enabled, false);
    // Premium was never actually attempted — the flag gate short-
    // circuited before attemptPremiumCreativeGeneration was ever called.
    assert.equal(diag.orchestrator.attempted, false);
    assert.equal(diag.execution.provider_generate_entered, false);
    // Matrix item 12: an honest, SPECIFIC fallback reason — never a vague
    // generic one.
    assert.deepEqual(diag.fallback, { occurred: true, final_engine: "exact_layout", reason: "feature_flag_disabled" });
    // Matrix item 14: the FINAL rendered engine is exact_layout, but that
    // must never erase the original router decision recorded above in
    // this SAME diagnostic object — both are readable together from one
    // persisted row.
    assert.equal(content.creative_engine, "exact_layout");
    assert.equal(diag.router.engine, "premium_ai_creative", "the original router choice must still be readable even though the final engine fell through");

    // Matrix item 15 (no secrets), at this level: nothing about the
    // process's real environment ever gets serialized into the
    // diagnostic — it only ever carries booleans/short codes/ids.
    const serialized = JSON.stringify(diag);
    assert.ok(!/sk-[A-Za-z0-9]/.test(serialized), "no OpenAI-shaped secret value may ever appear in the persisted diagnostic");
    assert.ok(!serialized.includes("Bearer "), "no raw bearer token may ever appear in the persisted diagnostic");
  } finally {
    mock.restore();
  }
});
