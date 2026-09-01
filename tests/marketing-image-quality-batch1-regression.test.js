import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Batch 2 REGRESSION 23-27: wiring runMarketingImageQuality into
// generate_content/revise_content must never weaken Batch 1's own output-
// safety pipeline (evaluateMarketingOutput) — the two gates run on
// different halves of the same request (text/creative-scene facts vs. the
// generated photo's own visual quality) and must keep composing correctly
// in the SAME call. Most of these behaviors already have dedicated,
// extensive coverage elsewhere (marketing-studio-flyer-content.test.js's
// own REGRESSION suite, marketing-studio-content-revision.test.js's jaguar
// fix, the ACCEPTANCE tests) — already passing with the Batch 2 quality
// gate active, since fixing their fixtures for the new usage-ledger calls
// was part of this batch's own work. These are focused, numbered
// checkpoints proving the SAME real handler call exercises both gates
// together, not a re-derivation of that existing coverage.

function floristDeps(client) {
  return { florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" } };
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

// REGRESSION 23: Batch 1's own safety pipeline (evaluateMarketingOutput)
// still actually runs for a real generate_content image-post call, in the
// SAME request that also exercises the Batch 2 image-quality gate — proven
// by an ungrounded flower species claim in the caption body getting
// stripped, not just "available" but unused.
test("REGRESSION 23/24/25: an unverified flower-species claim is repaired by Batch 1's evaluator in the SAME request that also runs the Batch 2 image-quality gate, and no invented species reaches the persisted content or the image prompt", async () => {
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
  const capturedPrompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (/flux|black-forest-labs/i.test(String(url))) {
      try {
        capturedPrompts.push(JSON.parse(opts?.body || "{}").prompt);
      } catch {
        /* ignore */
      }
    }
    return originalFetch(url, opts);
  };
  try {
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Today's post", brief: "Create today's Facebook post", status: "idea" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook" }], error: null },
        { data: { marketing_monthly_budget_cents: null }, error: null },
        { data: null, error: null }, // -> generating
        { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: [], error: null }, // loadGroundedInventory — zero real inventory
        { data: [], error: null }, // audience customers
        { data: [], error: null }, // audience orders
        { data: [], error: null }, // recent-content shortlist
        { data: null, error: null }, // recordUsage("copy")
        { data: { id: "usage-img-1" }, error: null }, // reserveProviderCall(image)
        { data: null, error: null }, // completeProviderCall(image)
        { data: { id: "usage-vision-1" }, error: null }, // reserveProviderCall(vision)
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

    const NAMED_SPECIES_RE = /\bpeon(?:y|ies)\b/i;
    assert.doesNotMatch(body.copy.body, NAMED_SPECIES_RE, "REGRESSION 24: an unverified species claim must never reach the persisted caption");

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.doesNotMatch(insertedContent.visual_brief || "", NAMED_SPECIES_RE, "REGRESSION 25 (visual-fiction boundary): the sanitized visual_brief must never carry the invented species through to persistence");
    assert.ok(capturedPrompts.length >= 1, "the real image-generation prompt must actually have been sent");
    for (const p of capturedPrompts) assert.doesNotMatch(p, NAMED_SPECIES_RE, "REGRESSION 25: the actual image-generation prompt must reflect the SAME sanitized scene, never the raw invented one");

    // REGRESSION 23 (composition proof): the SAME request that just proved
    // Batch 1's evaluator ran ALSO ran the Batch 2 image-quality gate —
    // a real quality_check verdict is on the persisted content, and the
    // image was actually inspected (not skipped/bypassed).
    assert.ok(insertedContent.quality_check, "the Batch 2 image-quality gate must have actually run in this same request");
    assert.equal(insertedContent.quality_check.accepted, true);
  } finally {
    globalThis.fetch = originalFetch;
    mock.restore();
  }
});

// REGRESSION 26: an exact, explicitly-stated operational fact (a phone
// number) survives byte-for-byte through the deterministic notice path,
// in the SAME request shape that also runs the Batch 2 background quality
// gate for the flyer's Tier-A photo.
test("REGRESSION 26: an exact stated phone number survives verbatim through the deterministic notice path while the Batch 2 background quality gate also runs", async () => {
  const unusedAiCopy = {
    platform: "facebook",
    headline: "Early Closing Notice",
    body: "Don't forget, Lilies in Bloom will be closing at 2:30 today.",
    cta: "Call us",
    visual_brief: "A bright shot of the shop's fresh flowers.",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
  const mock = mockCloudflareBoth(unusedAiCopy);
  try {
    const brief = "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.";
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief, status: "idea" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook" }], error: null },
        { data: { marketing_monthly_budget_cents: null }, error: null },
        { data: null, error: null },
        { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: [], error: null }, // loadGroundedInventory
        { data: [], error: null }, // audience customers
        { data: [], error: null }, // audience orders
        { data: [], error: null }, // recent-content shortlist
        { data: null, error: null }, // recordUsage("copy") — the one real copy call only
        { data: { id: "usage-img-1" }, error: null },
        { data: null, error: null },
        { data: { id: "usage-vision-1" }, error: null },
        { data: null, error: null },
        { data: { id: "flyer-asset-1" }, error: null },
        { data: null, error: null },
        { data: { id: "item-1", status: "draft" }, error: null }
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected the deterministic flyer path to succeed: ${res.body}`);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.match(insertedContent.cta, /606-506-4039/, "REGRESSION 26: the exact stated phone number must survive verbatim");
    assert.equal(insertedContent.style_tier, "generated", "the Batch 2 background quality gate must still have run and passed for this deterministic-wording flyer");
  } finally {
    mock.restore();
  }
});

// REGRESSION 27: revise_content's existing subject-forward "Regenerate
// image" behavior (the jaguar fix — the real subject survives, never
// silently swapped for a generic calm backdrop) remains intact now that
// the call is routed through the Batch 2 quality gate.
test("REGRESSION 27: revise_content's subject-forward 'Regenerate image' still re-rolls the SAME real subject through the Batch 2 quality gate — the jaguar fix is intact", async () => {
  const mock = mockCloudflareBoth({
    platform: "facebook",
    headline: "Go team!",
    body: "Go team!",
    cta: "Order now",
    visual_brief: "n/a",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  const capturedPrompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (/flux|black-forest-labs/i.test(String(url))) {
      try {
        capturedPrompts.push(JSON.parse(opts?.body || "{}").prompt);
      } catch {
        /* ignore */
      }
    }
    return originalFetch(url, opts);
  };
  try {
    const originalFlyerContent = {
      headline: "GO JAGUARS",
      body: "Good luck to the Floyd Central Jaguars this Friday!",
      cta: "Order now",
      caption: "Good luck to the Floyd Central Jaguars this Friday!",
      template_id: "general",
      regions: { headline: {} },
      palette: {},
      canvas: { width: 1080, height: 1080 },
      brand: { shopName: "Lilies in Bloom", phone: "606-506-4039" },
      url: "https://fake.storage/website-media/shop-ashley/old-flyer.png",
      mime: "image/png",
      rendered_at: "2026-08-20T00:00:00.000Z",
      render_status: "rendered",
      style_tier: "generated",
      background_url: "https://fake.storage/website-media/shop-ashley/old-jaguar.jpg",
      photo_strategy: "subject_forward",
      visual_brief: "A jaguar mascot holding a bouquet of flowers.",
      grounded_in_inventory: []
    };
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Mascot day post", brief: "A jaguar mascot holding flowers, for our mascot day post", status: "draft" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "flyer-asset-1" }], error: null },
        { data: { id: "flyer-asset-1", asset_type: "flyer", content: originalFlyerContent }, error: null },
        { data: { name: "Lilies in Bloom", phone: "606-506-4039", primary_color: "#7c3a58" }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: { id: "usage-img-1" }, error: null },
        { data: null, error: null },
        { data: { id: "usage-vision-1" }, error: null },
        { data: null, error: null },
        { data: { id: "flyer-asset-2" }, error: null },
        { data: null, error: null } // variant repoint update
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("revise_content", { content_item_id: "item-1", instruction: "Regenerate the image — keep the exact same wording." }));
    assert.equal(res.statusCode, 200, `expected the image-regeneration revision to succeed: ${res.body}`);
    assert.ok(capturedPrompts.some((p) => /jaguar/i.test(p)), "REGRESSION 27: the real subject must still reach the actual regeneration prompt through the Batch 2 quality gate");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.photo_strategy, "subject_forward", "the photo strategy must still carry forward unchanged across a revision");
    assert.equal(insertedContent.style_tier, "generated");
  } finally {
    globalThis.fetch = originalFetch;
    mock.restore();
  }
});
