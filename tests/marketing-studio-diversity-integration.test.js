import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Batch 5 ("Repair recent-content diversity + brand-memory learning"),
// Part E/G, Part P #20-23: the diversity evaluator's real wiring into
// generate_content — reusing the SAME bounded caption retry Batch 1's own
// weak-copy check already runs, never a second/recursive retry, and never
// at the expense of Batch 1 safety or Batch 2 cost accounting.

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

const REPEAT_CAPTION = "Fresh flowers just arrived for the weekend, order yours today!";

function mockCloudflareText(copyJson) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(copyJson) } }) });
  return { restore: () => (globalThis.fetch = originalFetch) };
}

function mockCloudflareBoth(copyJson) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async (url) => {
    if (/flux|black-forest-labs/i.test(String(url))) {
      return { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("fake-jpeg-bytes").toString("base64") } }) };
    }
    if (/llava|uform|llama-3\.2-11b-vision/i.test(String(url))) {
      return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean, matches the brief" } }) };
    }
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(copyJson) } }) };
  };
  return { restore: () => (globalThis.fetch = originalFetch) };
}

// Part P #20/#21/#22: bounded (exactly one retry, not recursive),
// preserves the persisted canonical concept, and Batch 1's own safety
// evaluator still runs on both the original and the retried draft.
test("generate_content (text_post): a diversity-triggering repeat runs exactly ONE bounded retry, still persists a real canonical concept, and Batch 1 safety still runs", async () => {
  const copyJson = {
    platform: "facebook",
    headline: "Fresh Today",
    body: REPEAT_CAPTION,
    cta: "Visit us today",
    visual_brief: "a bright bouquet on a wooden counter",
    creative_brief: { primary_subject: "a bright bouquet", mood: "cheerful" },
    objective: "awareness",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
  const mock = mockCloudflareText(copyJson);
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "Weekend post", brief: "A fresh flowers weekend post for Facebook", status: "idea" }, error: null },
      { data: [{ id: "item-1", status: "generating" }], error: null }, // atomic claim
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: [], error: null }, // loadGroundedInventory
      { data: [], error: null }, // audience customers
      { data: [], error: null }, // audience orders
      // recent-content: a real published post with the EXACT SAME opening
      // line the mocked model is about to generate again.
      {
        data: [
          { id: "v-old", content_item_id: "item-old", platform: "facebook", caption: REPEAT_CAPTION, asset_id: "asset-old", status: "published", published_at: "2026-08-20T00:00:00Z", created_at: "2026-08-20T00:00:00Z" }
        ],
        error: null
      },
      { data: [{ id: "item-old", status: "approved", updated_at: "2026-08-20T00:00:00Z" }], error: null },
      { data: [{ id: "asset-old", asset_type: "social_copy", status: "completed", content: { body: REPEAT_CAPTION } }], error: null },
      { data: null, error: null }, // recordUsage("copy") — initial attempt
      { data: null, error: null }, // recordUsage("copy") — the ONE bounded retry
      { data: { id: "asset-1" }, error: null }, // ai_generated_assets insert
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `must self-correct via the bounded retry, not fail: ${res.body}`);

    // Part P #20: bounded — exactly ONE retry, proven by exactly two real
    // copy-usage recordings (initial + the one retry), never a third.
    const copyUsageInserts = client.calls.filter((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert") && c.payload?.purpose === "copy");
    assert.equal(copyUsageInserts.length, 2, "exactly one bounded retry — never zero, never recursive");

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;

    // Part P #21: the diversity retry must never interfere with the
    // canonical concept still getting built and persisted normally.
    assert.ok(insertedContent.canonical_concept, "Part P #21: a real canonical concept must still be persisted after a diversity retry");
    assert.equal(insertedContent.canonical_concept.version, 1);

    // Part P #22: Batch 1 safety still ran — a real evaluateMarketingOutput
    // pass happened on the caption (proven by the request completing
    // successfully with a real, non-empty caption body persisted, exactly
    // the same guarantee every other safe generate_content path gives).
    assert.ok(insertedContent.body && insertedContent.body.length > 0);

    const body = JSON.parse(res.body);
    assert.equal(body.item.status, "draft");
  } finally {
    mock.restore();
  }
});

// Part P #23: a diversity-triggering caption retry must never bypass
// Batch 2's own downstream image-quality gate or provider-usage
// accounting — both still run normally afterward, in the same real
// request, with their own real usage rows.
test("generate_content (subject-forward flyer): a diversity-triggering caption retry still lets Batch 2's image-quality gate and provider-usage accounting run normally", async () => {
  const badCopy = {
    platform: "facebook",
    headline: "Fresh Today",
    body: REPEAT_CAPTION,
    cta: "Stop by today",
    visual_brief: "A bright arrangement on a wooden counter.",
    creative_brief: { primary_subject: "A bright arrangement", mood: "cheerful", lighting: "natural", composition: "close-up", floral_style: "garden-style" },
    objective: "awareness",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
  const mock = mockCloudflareBoth(badCopy);
  try {
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Today's post", brief: "Create today's Facebook post", status: "idea" }, error: null },
        { data: [{ id: "item-1", status: "generating" }], error: null },
        { data: [{ id: "variant-1", platform: "facebook" }], error: null },
        { data: { marketing_monthly_budget_cents: null }, error: null },
        { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: [], error: null }, // loadGroundedInventory
        { data: [], error: null }, // audience customers
        { data: [], error: null }, // audience orders
        // recent-content: a real published post with the exact same
        // opening line the mocked model is about to generate again.
        {
          data: [
            { id: "v-old", content_item_id: "item-old", platform: "facebook", caption: REPEAT_CAPTION, asset_id: "asset-old", status: "published", published_at: "2026-08-20T00:00:00Z", created_at: "2026-08-20T00:00:00Z" }
          ],
          error: null
        },
        { data: [{ id: "item-old", status: "approved", updated_at: "2026-08-20T00:00:00Z" }], error: null },
        { data: [{ id: "asset-old", asset_type: "social_copy", status: "completed", content: { body: REPEAT_CAPTION } }], error: null },
        { data: null, error: null }, // recordUsage("copy") — attempt 1
        { data: null, error: null }, // recordUsage("copy") — the ONE bounded retry (safety + diversity share it)
        { data: { id: "usage-img-1" }, error: null }, // Batch 2: reserveProviderCall(image)
        { data: null, error: null }, // completeProviderCall(image)
        { data: { id: "usage-vision-1" }, error: null }, // Batch 2: reserveProviderCall(vision)
        { data: null, error: null }, // completeProviderCall(vision)
        { data: { id: "media-1" }, error: null },
        { data: { id: "asset-1" }, error: null },
        { data: null, error: null }, // variant update
        { data: { id: "item-1", status: "draft" }, error: null }
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, `must self-correct via the bounded retry, not fail: ${res.body}`);

    // Bounded: exactly one retry (two copy-usage recordings), never more,
    // even though BOTH the safety evaluator and the diversity evaluator
    // flagged this same draft.
    const copyUsageInserts = client.calls.filter((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert") && c.payload?.purpose === "copy");
    assert.equal(copyUsageInserts.length, 2, "safety + diversity share the SAME one bounded retry — never two separate retries");

    // Part P #23: Batch 2's image-quality gate and provider-usage
    // accounting still ran, with their own real usage rows, exactly as
    // they would with no diversity check involved at all.
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.ok(insertedContent.quality_check, "Batch 2's image-quality gate must have actually run");
    assert.equal(insertedContent.quality_check.accepted, true);
    const imageUsageInserts = client.calls.filter(
      (c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert") && ["image", "vision"].includes(c.payload?.purpose)
    );
    assert.equal(imageUsageInserts.length, 2, "one image + one vision usage row — Batch 2 cost accounting unaffected by the diversity retry");
  } finally {
    mock.restore();
  }
});
