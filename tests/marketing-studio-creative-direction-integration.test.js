import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";
import { mockCloudflareGenerate } from "./helpers/mock-cloudflare-generate.mjs";
import { validateCreativeDirection } from "../netlify/functions/_shared/marketing-creative-direction.js";

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

// A subject-forward flyer's photo path runs a real image-generation call
// AND a real vision quality-check call, not just the text-generation call
// mockCloudflareGenerate alone answers — this mirrors marketing-studio-
// canonical-concept.test.js's own mockCloudflareBoth, so the queue below
// matches a genuine PASS through runMarketingImageQuality rather than
// falling back (which takes a shorter, differently-shaped call sequence).
function mockCloudflareBoth(copyJson) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async (url, options) => {
    let body = {};
    try {
      body = JSON.parse(options?.body || "{}");
    } catch {
      body = {};
    }
    if (!Array.isArray(body.messages) && "image" in body) {
      return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean, matches the brief" } }) };
    }
    if (/flux|black-forest-labs/i.test(String(url))) {
      return { ok: true, json: async () => ({ success: true, result: { image: TINY_JPEG_BASE64 } }) };
    }
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(copyJson) } }) };
  };
  return { restore: () => (globalThis.fetch = originalFetch) };
}

/**
 * Creative Direction Engine, Phase 1 — handler-level integration proof
 * (mirrors this repo's own split: unit coverage for the module itself
 * lives in tests/marketing-creative-direction.test.js; this file proves
 * it's actually wired into the real generate_content/revise_content
 * routes, the same way marketing-studio-canonical-concept.test.js is the
 * integration proof for canonical_concept).
 *
 * Covers Part I items 16 (persists in the existing content JSON) and 17
 * (revision inheritance never creates a parallel concept).
 */

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body, { method = "POST", qs = {} } = {}) {
  return { httpMethod: method, queryStringParameters: { action, ...qs }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function findInsert(client, table) {
  return client.calls.find((c) => c.table === table && c.ops.some((op) => op[0] === "insert"));
}

const COPY_JSON = {
  platform: "facebook",
  headline: "Meet Our Mascot",
  body: "Our shop mascot is ready for the parade with a fresh bouquet in hand!",
  // No CTA — this fixture is a thin-context creative request, same shape
  // as the live-diagnosed prompt ("Create today's Facebook post for
  // Lilies in Bloom"), so 16's own restrained-but-not-sparse assertions
  // below reflect the real no-CTA everyday_floral baseline.
  cta: "",
  visual_brief: "a costume character mascot holding a bouquet of flowers",
  creative_brief: { primary_subject: "a costume character mascot holding a bouquet", mood: "playful", lighting: "bright", composition: "full-body", floral_style: "casual" },
  objective: "awareness",
  hashtags: ["#mascot"],
  asset_requirements: [],
  brand_traits_used: [],
  visual_traits_used: []
};

function subjectForwardGenerateQueue({ shopRow } = {}) {
  return [
    { data: { id: "item-1", content_type: "image_post", title: "Mascot post", brief: "Post our mascot holding flowers for Facebook", status: "idea" }, error: null },
    { data: [{ id: "item-1", status: "generating" }], error: null },
    { data: [{ id: "variant-1", platform: "facebook" }], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: shopRow || { name: "Lilies in Bloom", phone: "606-506-4039", logo_url: null }, error: null },
    { data: null, error: null }, // loadBrandBrain
    { data: null, error: null }, // loadStyleMemory
    { data: [], error: null }, // loadGroundedInventory
    { data: [], error: null }, // audience customers
    { data: [], error: null }, // audience orders
    { data: [], error: null }, // recent-content shortlist
    { data: null, error: null }, // recordUsage("copy")
    { data: { id: "usage-img-1" }, error: null }, // reserveProviderCall(image)
    { data: null, error: null }, // completeProviderCall(image)
    { data: { id: "usage-vision-1" }, error: null }, // reserveProviderCall(vision)
    { data: null, error: null }, // completeProviderCall(vision)
    { data: { id: "media-1" }, error: null }, // website_media insert
    { data: { id: "asset-1" }, error: null }, // ai_generated_assets insert
    { data: null, error: null }, // variant update
    { data: { id: "item-1", status: "draft" }, error: null }
  ];
}

// ---------------------------------------------------------------------------
// 16 — Creative Direction persists in the existing content JSON.
// ---------------------------------------------------------------------------

test("16 — generate_content (flyer): a valid Creative Direction is persisted in the same content JSON as canonical_concept, no new table/column", async () => {
  const mock = mockCloudflareBoth(COPY_JSON);
  try {
    const client = createFakeSupabaseClient(subjectForwardGenerateQueue(), { storage: createFakeSupabaseStorage({}) });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body);

    const assetInsert = findInsert(client, "ai_generated_assets");
    const content = assetInsert.payload.content;
    assert.ok(content.canonical_concept, "sanity: canonical_concept must still be there too");
    assert.ok(content.creative_direction, "16: creative_direction must be persisted");
    assert.equal(content.creative_direction.version, 2);
    const { valid, errors } = validateCreativeDirection(content.creative_direction, { canonicalConcept: content.canonical_concept });
    assert.equal(valid, true, `persisted Creative Direction must already be fully valid: ${errors.join("; ")}`);
    // Corrected design standard: polished, not sparse — a real headline
    // plus a short supporting line, never a paragraph-length graphic
    // overlay. This is the direct, corrected answer to the live-
    // diagnosed failure (stacked text strips / body copy over the photo).
    assert.equal(content.creative_direction.occasionTreatment, "everyday_floral");
    assert.equal(content.creative_direction.textDensity, "standard");
    assert.equal(content.creative_direction.graphicTextSlots.supportingLine, true, "a short supporting line is allowed, never a paragraph body");
    assert.ok(content.creative_direction.graphicTextLimits.supportingLineMaxChars <= 60, "the supporting line stays under the hard character ceiling");
  } finally {
    mock.restore();
  }
});

test("16b — the exact-facts (calm-backdrop) flyer branch also persists a valid Creative Direction", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "We're Closing Early Today",
    body: "We'll be closing at 3pm today — call 606-506-4039 with any last-minute orders.",
    cta: "Call 606-506-4039",
    visual_brief: "v",
    objective: "operational",
    hashtags: [],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Closing notice", brief: "We are closing early at 3pm today, call 606-506-4039.", status: "idea" }, error: null },
        { data: [{ id: "item-1", status: "generating" }], error: null },
        { data: [{ id: "variant-1", platform: "facebook" }], error: null },
        { data: { marketing_monthly_budget_cents: null }, error: null },
        { data: { name: "Lilies in Bloom", phone: "606-506-4039", logo_url: null }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: [], error: null }, // loadGroundedInventory
        { data: [], error: null }, // audience customers
        { data: [], error: null }, // audience orders
        { data: [], error: null }, // recent-content shortlist
        { data: null, error: null }, // recordUsage("copy") — caption
        { data: null, error: null }, // recordUsage("copy") — flyer
        { data: { id: "usage-img-1" }, error: null }, // reserveProviderCall(image, background)
        { data: null, error: null }, // completeProviderCall(image)
        { data: { id: "asset-1" }, error: null }, // ai_generated_assets insert
        { data: null, error: null }, // variant update
        { data: { id: "item-1", status: "draft" }, error: null }
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const content = assetInsert.payload.content;
    assert.ok(content.creative_direction, "the exact-facts flyer branch must persist Creative Direction too");
    assert.equal(content.creative_direction.occasionTreatment, "operational_notice");
    assert.equal(content.creative_direction.compositionFamily, "framed_panel");
    assert.equal(content.creative_direction.brandIdentifier, "shop_name");
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// 17 — revision inheritance never creates a parallel concept.
// ---------------------------------------------------------------------------

const FLYER_ASSET_WITH_CREATIVE_DIRECTION = {
  id: "asset-1",
  asset_type: "flyer",
  content: {
    headline: "Fresh Bouquets",
    body: "Order your fresh bouquet today.",
    cta: "Visit us today",
    caption: "Fresh spring bouquets are here for the season.",
    template_id: "t1",
    aspect_ratio: "1:1",
    style_tier: "generated",
    background_url: "https://fake.storage/bg.jpg",
    photo_strategy: "calm_backdrop",
    grounded_in_inventory: [],
    objective: "awareness",
    canonical_concept: {
      version: 1,
      objective: "awareness",
      occasionCategory: "general",
      primarySubjectClass: "floral_arrangement",
      captionIntent: "informational",
      ctaIntent: "visit_shop",
      visualDirection: { mood: null, lighting: null, composition: null, floralStyle: null, photoStrategy: "calm_backdrop" },
      creativeFamily: "designed_flyer",
      factRequirements: [],
      assetRoute: "flyer_background",
      platform: "facebook",
      sympathyClassification: "not_sympathy",
      inventoryIntent: "not_inventory_driven",
      promotionIntent: "not_promotion"
    },
    creative_direction: {
      version: 2,
      occasionTreatment: "boutique_floral",
      compositionFamily: "framed_panel",
      subjectPlacement: "left_third",
      imageCrop: "tight",
      imagePlacement: "framed_block",
      imageScale: "balanced",
      textRegion: "framed_block",
      typographyPersonality: "serif_script_pairing",
      headlineScale: "large",
      scriptAccentUsage: "subhead_script",
      hierarchyDepth: "headline_plus_cta",
      brandingPosition: "top_left",
      brandingScale: "prominent",
      brandIdentifier: "shop_name",
      ornamentalDensity: "moderate",
      decorativeRestraint: "disciplined",
      borderStyle: "ornamental_frame",
      dividerStyle: "ornamental_flourish",
      badgeStyle: "none",
      bannerStyle: "none",
      decorativeMotif: "watercolor_wash",
      textDensity: "standard",
      ctaProminence: "standard",
      backgroundTreatment: "bordered_panel_with_photo_inset",
      negativeSpaceStrategy: "moderate",
      visualMood: "romantic_soft",
      paletteMood: "soft_pastel",
      graphicTextSlots: { brand: true, headline: true, supportingLine: false, serviceDetail: false, cta: true, phone: false },
      graphicTextLimits: { headlineMaxChars: 42, supportingLineMaxChars: 60, serviceDetailMaxChars: 70, ctaMaxChars: 30 }
    }
  }
};

test("17 — revise_content (flyer, wording-only): the parent's Creative Direction is inherited byte-for-byte, no parallel concept created", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "h2",
    body: "Warm, fresh spring bouquets are here for the season.",
    cta: "Visit us today",
    visual_brief: "v",
    hashtags: ["#spring"],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { user_id: "u1", role: "super_admin", active: true }, error: null },
      { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: FLYER_ASSET_WITH_CREATIVE_DIRECTION, error: null },
      { data: { name: "Test Florals", logo_url: null }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "asset-2" }, error: null }, // ai_generated_assets insert
      { data: null, error: null }, // variant update
      { data: null, error: null } // audit
    ]);
    const handler = createMarketingStudioHandler({ authenticate: async () => ({ user: { id: "u1" } }), createServerClient: () => client });
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "make it warmer" }));
    assert.equal(res.statusCode, 200, res.body);

    const assetInsert = findInsert(client, "ai_generated_assets");
    const content = assetInsert.payload.content;
    const parentDirection = FLYER_ASSET_WITH_CREATIVE_DIRECTION.content.creative_direction;
    assert.deepEqual(content.creative_direction, parentDirection, "an ordinary wording-only revision must inherit Creative Direction byte-for-byte");

    // "No parallel concept": canonical_concept is still the ONE identity
    // object — creative_direction never duplicates or re-derives any of
    // canonical_concept's own identity fields (objective/occasionCategory/
    // ctaIntent/etc.), it only ever describes LAYOUT.
    const concept = content.canonical_concept;
    const parentConcept = FLYER_ASSET_WITH_CREATIVE_DIRECTION.content.canonical_concept;
    for (const field of ["objective", "occasionCategory", "ctaIntent", "sympathyClassification", "promotionIntent", "inventoryIntent", "assetRoute"]) {
      assert.equal(concept[field], parentConcept[field], `revision must never drift ${field} via the creative_direction pathway`);
    }
    const directionKeys = Object.keys(content.creative_direction).sort();
    const conceptKeys = Object.keys(concept).sort();
    assert.deepEqual(
      directionKeys.filter((k) => conceptKeys.includes(k)),
      ["version"],
      "creative_direction and canonical_concept must share no field except version — never a second, competing copy of the same identity data"
    );
  } finally {
    mock.restore();
  }
});

test("17b — revise_content (flyer): a pre-Phase-1 asset with no creative_direction on file gets one deterministically backfilled, never left undefined", async () => {
  const legacyAsset = {
    ...FLYER_ASSET_WITH_CREATIVE_DIRECTION,
    content: { ...FLYER_ASSET_WITH_CREATIVE_DIRECTION.content, creative_direction: undefined }
  };
  delete legacyAsset.content.creative_direction;

  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "h2",
    body: "Warm, fresh spring bouquets are here for the season.",
    cta: "Visit us today",
    visual_brief: "v",
    hashtags: ["#spring"],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { user_id: "u1", role: "super_admin", active: true }, error: null },
      { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: legacyAsset, error: null },
      { data: { name: "Test Florals", logo_url: null }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "asset-2" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler({ authenticate: async () => ({ user: { id: "u1" } }), createServerClient: () => client });
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "make it warmer" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const content = assetInsert.payload.content;
    assert.ok(content.creative_direction, "17b: a legacy asset must get a Creative Direction backfilled, never left missing");
    const { valid, errors } = validateCreativeDirection(content.creative_direction, { canonicalConcept: content.canonical_concept });
    assert.equal(valid, true, errors.join("; "));
  } finally {
    mock.restore();
  }
});
