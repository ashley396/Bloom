import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";
import { PREMIUM_JOB_TYPE } from "../netlify/functions/_shared/marketing-premium-creative-job.js";

// Hybrid Marketing Studio Batch 4 ("async job architecture") — real,
// end-to-end integration tests through the ACTUAL generate_content
// dispatch, proving the exact real failure (a real staging 504: OpenAI's
// image call blocking the synchronous request/response cycle) cannot
// recur, without ever making a real OpenAI call.
//
// `deps.isShopFeatureEnabled` (a new, deliberately minimal testability
// seam — see marketing-studio.js's own comment at its call site) is the
// ONLY way this suite can prove the Premium-eligible ASYNC KICKOFF path
// itself, since the real call site always builds its own real
// service-role client otherwise (see marketing-studio-premium-creative-
// routing-integration.test.js's own extensive comment on why every OTHER
// test in this codebase can only ever observe that flag as false).
// Production behavior is unchanged: createMarketingStudioHandler() with
// no deps still calls the exact same real isShopFeatureEnabled.

function floristDeps(client, overrides = {}) {
  return { florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" }, isShopFeatureEnabled: async () => true, ...overrides };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

function mockProviders(copyJson) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  process.env.OPENAI_API_KEY = "sk-test-not-real";
  process.env.FLORISYN_ENV = "staging";
  const calls = { cloudflare: 0, openai: 0 };
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("api.openai.com")) {
      calls.openai += 1;
      return { ok: true, json: async () => ({ data: [{ b64_json: "not-used" }] }) };
    }
    calls.cloudflare += 1;
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(copyJson) } }) };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
      delete process.env.OPENAI_API_KEY;
      delete process.env.FLORISYN_ENV;
    }
  };
}

function ordinaryCopyJson() {
  return {
    platform: "facebook",
    headline: "Beautiful Blooms",
    body: "A little something to brighten someone's day.",
    cta: "Shop now",
    visual_brief: "A bright seasonal bouquet.",
    creative_brief: { primary_subject: "a bright bouquet", mood: "cheerful", lighting: "natural", composition: "close-up", floral_style: "garden-style" },
    objective: "awareness",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
}

// The real, exact fixed sequence generate_content's subject-forward
// branch always issues before it ever reaches the Premium routing
// decision — pinned exactly like marketing-studio-premium-eligibility-
// observability.test.js's own subjectForwardResponses(), whose brief/
// content_type this reuses verbatim (proven to route premium_ai_creative
// and to reach the subject-forward branch without an exact-facts/
// notice/sympathy short-circuit).
function fixedResponses() {
  return [
    { data: { id: "item-1", content_type: "social_post", title: "t", brief: "Create today's Facebook post for Lilies in Bloom.", status: "idea" }, error: null }, // currentItem
    { data: [{ id: "item-1", status: "generating" }], error: null }, // atomic claim
    { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
    { data: { marketing_monthly_budget_cents: null }, error: null }, // budget
    { data: { name: "Test Florals" }, error: null }, // shopRow
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

test("Batch4 Part C: a Premium-eligible request reserves usage, creates a durable job, and returns the pending response WITHOUT ever calling OpenAI synchronously", async () => {
  const mock = mockProviders(ordinaryCopyJson());
  try {
    const client = createFakeSupabaseClient(
      [
        ...fixedResponses(),
        { data: { id: "job-1", shop_id: "shop-ashley", job_type: PREMIUM_JOB_TYPE, status: "planned", plan: [], result: {} }, error: null }, // createOrContinuePremiumJob -> createPremiumJob insert().select().single() (fresh, no conflict)
        { data: { id: "usage-1" }, error: null }, // reserveProviderCall insert().select("id").single()
        { data: { plan: [], result: {}, updated_at: "2026-01-01T00:00:00.000Z" }, error: null }, // addPremiumJobAttempt read
        { data: [{ id: "job-1", plan: [{ id: "attempt-0" }], result: {} }], error: null } // addPremiumJobAttempt CAS update().select() (array, no .single())
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.premium_generation_pending, true);
    assert.equal(parsed.job_id, "job-1");
    assert.equal(parsed.content_item_id, "item-1");
    assert.equal(parsed.status, "generating");

    assert.equal(mock.calls.openai, 0, "the real staging 504's own root cause: provider.generate() must NEVER be reached from the synchronous request");

    const jobInsert = client.calls.find((c) => c.table === "ai_execution_jobs" && c.ops.some((op) => op[0] === "insert"));
    assert.ok(jobInsert, "must create a real durable ai_execution_jobs row — no new table");
    const insertedJob = jobInsert.ops.find((op) => op[0] === "insert")[1][0];
    assert.equal(insertedJob.job_type, PREMIUM_JOB_TYPE);
    assert.equal(insertedJob.status, "planned");
    assert.equal(insertedJob.result.content_item_id, "item-1");

    // recordUsage("copy") writes into this same ledger table twice
    // (caption + on-image flyer text) before the Premium reservation ever
    // runs — find the OpenAI reservation specifically, not just the first
    // insert into this table.
    const usageInsert = client.calls.find(
      (c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert" && op[1][0].provider === "openai")
    );
    assert.ok(usageInsert, "must reserve usage through the EXISTING ledger — no second usage table");
    const insertedUsage = usageInsert.ops.find((op) => op[0] === "insert")[1][0];
    assert.equal(insertedUsage.job_id, "job-1", "Part A: every Premium reservation must be linked to job_id via the EXISTING FK");
    assert.equal(insertedUsage.status, "estimated");

    // The content item was never touched again after the atomic claim —
    // still "generating," never reverted, never persisted to "draft" —
    // proving the early return genuinely bypassed persistGeneratedAsset.
    const itemUpdates = client.calls.filter((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
    assert.equal(itemUpdates.length, 1, "only the original atomic claim should have touched marketing_content_items");
  } finally {
    mock.restore();
  }
});

// Reuses the exact working Cloudflare-image+vision mock and response
// fixture marketing-studio-premium-creative-routing-integration.test.js's
// own "Batch2 #4" test already proved reaches full Exact Layout
// completion (image generation + vision quality check + asset/variant/
// content-item persistence) — only the feature-flag override and the
// injected job-create failure are new here.
function mockFullPipelineProviders(copyJson) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  process.env.OPENAI_API_KEY = "sk-test-not-real";
  process.env.FLORISYN_ENV = "staging";
  const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  const calls = { cloudflare: 0, openai: 0 };
  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes("api.openai.com")) {
      calls.openai += 1;
      return { ok: true, json: async () => ({ data: [{ b64_json: "not-used" }] }) };
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
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
      delete process.env.OPENAI_API_KEY;
      delete process.env.FLORISYN_ENV;
    }
  };
}

function imageContentBaseResponses() {
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

test("Batch4 Part C: if the durable job can't be created, the request falls through to the existing Exact Layout path unchanged — never a 500, never a fabricated Premium success", async () => {
  const mock = mockFullPipelineProviders(ordinaryCopyJson());
  try {
    const client = createFakeSupabaseClient(
      [
        ...imageContentBaseResponses(),
        { data: null, error: { message: "insert failed: connection reset" } }, // createOrContinuePremiumJob -> createPremiumJob insert fails (non-conflict error)
        // Falls through to the existing Exact Layout / Cloudflare path —
        // same tail shape as marketing-studio-premium-creative-routing-
        // integration.test.js's own feature-flag-off fallback tests.
        { data: null, error: null }, // recordUsage("image")
        { data: { id: "media-1" }, error: null }, // website_media insert
        { data: { id: "asset-1" }, error: null }, // persistGeneratedAsset
        { data: null, error: null }, // variant update
        { data: { id: "item-1", status: "draft" }, error: null } // final update
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(mock.calls.openai, 0, "a failed job-create must never fall through to a real OpenAI call either");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.creative_engine, "exact_layout");
    assert.equal(insertedContent.premium_creative_diagnostic.fallback.reason, "job_create_failed");
  } finally {
    mock.restore();
  }
});
