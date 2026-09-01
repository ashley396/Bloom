import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Batch 3 REGRESSION 27-31: the atomic generation claim (Part A/B/C) and
// fail-closed approval (Part D/E/F) must never weaken Batch 1's output-
// safety pipeline or Batch 2's image-quality/cost-accounting gate — they
// sit on either side of those systems (the claim happens BEFORE any of it
// runs; approval happens AFTER it's all persisted), never inside them.
// Most of this is already exercised continuously by the full suite (every
// generate_content/approve_content fixture in this repo was updated for
// the new atomic-claim call shape as part of this batch's own work) —
// these are focused, numbered checkpoints proving the SAME real request
// exercises the new Batch 3 wiring together with the still-intact Batch
// 1/2 systems, not a re-derivation of that existing coverage.

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
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

// REGRESSION 27/28/29/30: the atomic claim, Batch 1's evaluator, Batch 2's
// image-quality gate, and Batch 2's provider-usage accounting all fire, in
// order, within the SAME real generate_content request — an unverified
// flower-species claim is still repaired, the image is still really
// inspected, and every real provider call still gets its own usage row.
test("REGRESSION 27/28/29/30: the atomic claim, Batch 1's evaluator, and Batch 2's image-quality + usage accounting all run together in one real generate_content request", async () => {
  const badCopy = {
    platform: "facebook",
    headline: "Fresh Today",
    body: "We're crafting stunning arrangements using a mix of fresh flowers, including peonies, alstroemeria, and spray roses.",
    cta: "Stop by today",
    visual_brief: "A romantic arrangement of peonies on a marble counter.",
    creative_brief: { primary_subject: "A romantic arrangement of peonies", mood: "romantic", lighting: "natural", composition: "close-up", floral_style: "garden-style" },
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
        { data: [{ id: "item-1", status: "generating" }], error: null }, // Batch 3, Part A: the atomic claim, first
        { data: [{ id: "variant-1", platform: "facebook" }], error: null },
        { data: { marketing_monthly_budget_cents: null }, error: null },
        { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: [], error: null }, // loadGroundedInventory — zero real inventory
        { data: [], error: null }, // audience customers
        { data: [], error: null }, // audience orders
        { data: [], error: null }, // recent-content shortlist
        // Batch 1's weak-copy retry loop (detectWeakMarketingCopy flags
        // this deliberately weak caption and generateSocialPost is called
        // a second real time) means TWO real recordUsage("copy") inserts
        // happen here, not one — confirmed by tracing the real call
        // sequence, not assumed.
        { data: null, error: null }, // recordUsage("copy") — attempt 1
        { data: null, error: null }, // recordUsage("copy") — attempt 2 (retry)
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
    assert.equal(res.statusCode, 200, `must self-correct, not fail: ${res.body}`);
    const body = JSON.parse(res.body);

    // REGRESSION 27: an unverified species claim must still be repaired.
    assert.doesNotMatch(body.copy.body, /\bpeon(?:y|ies)\b/i);

    // REGRESSION 27 (composition proof): the atomic claim ran FIRST, as
    // the very first marketing_content_items write — before any of
    // Batch 1/2's own work started.
    const firstClaimIndex = client.calls.findIndex(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "generating")
    );
    const firstUsageIndex = client.calls.findIndex((c) => c.table === "marketing_generation_usage");
    assert.ok(firstClaimIndex === 1, "the atomic claim must be the very first WRITE this request makes — right after the initial read-only currentItem lookup");
    assert.ok(firstClaimIndex < firstUsageIndex, "the claim must happen before any Batch 2 usage reservation");

    // REGRESSION 28/29: the Batch 2 image-quality gate actually ran and
    // its own real usage rows exist for this request.
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.ok(insertedContent.quality_check, "REGRESSION 28: the Batch 2 image-quality gate must have actually run");
    assert.equal(insertedContent.quality_check.accepted, true);
    const usageInserts = client.calls.filter(
      (c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert") && ["image", "vision"].includes(c.payload?.purpose)
    );
    assert.equal(usageInserts.length, 2, "REGRESSION 29: exactly one image + one vision usage row for the one real attempt");

    // REGRESSION 30: no regression in the safe generate_content flow —
    // the item finishes at a real, non-'generating' state.
    assert.equal(body.item.status, "draft");
  } finally {
    mock.restore();
  }
});

// REGRESSION 31: no regression in flyer final-render approval when valid
// — a real, fully finalized, unquarantined flyer whose storage object
// genuinely exists still approves cleanly through every new Part D/E/F
// gate at once.
test("REGRESSION 31: a genuinely valid, fully finalized flyer still approves cleanly through every new fail-closed gate at once", async () => {
  const storage = createFakeSupabaseStorage({ listResponses: [{ data: [{ name: "flyer-1.png" }], error: null }] });
  const client = createFakeSupabaseClient(
    [
      { data: { id: "item-1", status: "draft" }, error: null },
      { data: [{ asset_id: "flyer-asset-1" }], error: null },
      {
        data: [
          {
            id: "flyer-asset-1",
            asset_type: "flyer",
            status: "completed",
            content: {
              url: "https://fake.storage/website-media/shop-1/flyers/flyer-1.png",
              storage_path: "shop-1/flyers/flyer-1.png",
              mime: "image/png",
              render_status: "rendered"
            }
          }
        ],
        error: null
      },
      { data: { id: "item-1", status: "approved" }, error: null }
    ],
    { storage }
  );
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200, `a genuinely valid, finalized flyer must still approve cleanly: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.equal(body.item.status, "approved");
});
