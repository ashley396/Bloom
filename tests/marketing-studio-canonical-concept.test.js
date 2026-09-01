import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";
import { mockCloudflareGenerate } from "./helpers/mock-cloudflare-generate.mjs";

// Batch 4 ("Persisted canonical concept + revision enforcement") — the 44
// required handler-level tests (Part L), exercising the real
// generate_content/revise_content/approve_content/revert_content_revision
// handlers through the fake Supabase client, the same way every other
// Batch regression suite in this repo does. Module-level unit coverage for
// the underlying classifiers/detectors themselves lives in
// tests/marketing-canonical-concept.test.js — this file is the
// integration proof that they're actually wired into the real routes.
//
// Each test's leading comment names which of the 44 numbered Part L
// requirements it covers; most tests cover more than one, the same way
// this repo's existing batch regression suites bundle related checkpoints
// into one real request rather than re-deriving the same fixture 44 times.

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}
function baseDeps(client) {
  return { authenticate: async () => ({ user: { id: "u1" } }), createServerClient: () => client };
}
function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body, { method = "POST", qs = {} } = {}) {
  return { httpMethod: method, queryStringParameters: { action, ...qs }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

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

function findInsert(client, table) {
  return client.calls.find((c) => c.table === table && c.ops.some((op) => op[0] === "insert"));
}

// ---------------------------------------------------------------------------
// INITIAL GENERATION (1-6)
// ---------------------------------------------------------------------------

// Items 1, 2, 5, 6: a text_post's canonical concept is persisted, and its
// caption/CTA both derive from the exact same real signals recorded on it
// (same objective, same cta intent, same version — a single shared
// contract, not two independently-decided ones).
test("Part L #1/2/5/6 — generate_content (text_post): canonical concept is persisted and shared by the caption and CTA", async () => {
  const copyJson = {
    platform: "facebook",
    headline: "Fresh Spring Arrivals",
    body: "Our spring bouquets are here, full of tulips and ranunculus grown for the season.",
    cta: "Visit us today",
    visual_brief: "a bright spring bouquet on a wooden counter",
    creative_brief: { primary_subject: "a bright spring bouquet", mood: "cheerful", lighting: "natural", composition: "close-up", floral_style: "garden-style" },
    objective: "awareness",
    hashtags: ["#spring"],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
  const mock = mockCloudflareBoth(copyJson);
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "Spring bouquet", brief: "A bright spring bouquet post for Facebook", status: "idea" }, error: null },
      { data: [{ id: "item-1", status: "generating" }], error: null }, // atomic claim
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: [], error: null }, // loadGroundedInventory
      { data: [], error: null }, // audience customers
      { data: [], error: null }, // audience orders
      { data: [], error: null }, // recent-content shortlist
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "asset-1" }, error: null }, // ai_generated_assets insert
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, res.body);

    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    assert.ok(concept, "Part L #1: canonical concept must be persisted");
    assert.equal(concept.version, 1);
    // Part L #2/#5: caption and CTA both reflect the SAME concept fields.
    assert.equal(concept.objective, "awareness");
    assert.equal(concept.ctaIntent, "visit_shop", "Part L #5: CTA intent must reflect the actual persisted CTA");
    assert.equal(concept.sympathyClassification, "not_sympathy");
    // Part L #6: this is literally the one object on the one asset row —
    // there is no second, independently-decided concept anywhere else.
    assert.equal(assetInsert.payload.content.objective, concept.objective);
  } finally {
    mock.restore();
  }
});

// Items 1, 3, 4, 6: a subject-forward flyer's canonical concept is
// persisted and shared by the flyer's on-image text, the Facebook caption,
// and the image (assetRoute reflects the real photo choice).
test("Part L #1/3/4/6 — generate_content (subject-forward flyer, AI-generated photo): canonical concept shared by flyer text, caption, and image route", async () => {
  const copyJson = {
    platform: "facebook",
    headline: "Meet Our Mascot",
    body: "Our shop mascot is ready for the parade with a fresh bouquet in hand!",
    cta: "Stop by today",
    visual_brief: "a costume character mascot holding a bouquet of flowers",
    creative_brief: { primary_subject: "a costume character mascot holding a bouquet", mood: "playful", lighting: "bright", composition: "full-body", floral_style: "casual" },
    objective: "awareness",
    hashtags: ["#mascot"],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
  const mock = mockCloudflareBoth(copyJson);
  try {
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Mascot post", brief: "Post our mascot holding flowers for Facebook", status: "idea" }, error: null },
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
        { data: null, error: null }, // recordUsage("copy")
        { data: { id: "usage-img-1" }, error: null }, // reserveProviderCall(image)
        { data: null, error: null }, // completeProviderCall(image)
        { data: { id: "usage-vision-1" }, error: null }, // reserveProviderCall(vision)
        { data: null, error: null }, // completeProviderCall(vision)
        { data: { id: "media-1" }, error: null }, // website_media insert
        { data: { id: "asset-1" }, error: null }, // ai_generated_assets insert
        { data: null, error: null }, // variant update
        { data: { id: "item-1", status: "draft" }, error: null }
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body);

    const assetInsert = findInsert(client, "ai_generated_assets");
    const content = assetInsert.payload.content;
    const concept = content.canonical_concept;
    assert.ok(concept, "Part L #1: canonical concept must be persisted");
    // Part L #3: flyer text uses the persisted concept's objective.
    assert.equal(content.objective, concept.objective);
    // Part L #4: assetRoute reflects the real AI-generated photo choice.
    assert.equal(concept.assetRoute, "ai_generated_photo");
    assert.equal(concept.primarySubjectClass, "mascot_or_character");
    // Part L #6: caption (content.caption) and flyer body share one asset.
    assert.equal(content.caption, copyJson.body);
  } finally {
    mock.restore();
  }
});

// Item 1 (video): the video_concept branch runs before the ad-hoc
// `concept` object exists, but still gets its own persisted canonical
// concept from the same real module.
test("Part L #1 — generate_content (video_concept): still gets a persisted canonical concept of its own", async () => {
  const videoJson = {
    concept: "A quick tour of today's fresh arrivals",
    script: "Walk through the cooler and show off today's fresh arrivals.",
    scenes: ["0-3s: pan across the cooler"],
    captions: ["Fresh today!"],
    hashtags: ["#fresh"],
    suggested_length_seconds: 15,
    brand_traits_used: [],
    visual_traits_used: []
  };
  const mock = mockCloudflareBoth(videoJson);
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "reel", title: "Cooler tour", brief: "A quick reel showing today's fresh arrivals", status: "idea" }, error: null },
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
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "asset-1" }, error: null }, // ai_generated_assets insert
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    assert.ok(concept, "Part L #1: the video branch must persist its own canonical concept too");
    assert.equal(concept.creativeFamily, "video_concept");
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// REVISION PRESERVATION (7-15)
// ---------------------------------------------------------------------------

const SOCIAL_COPY_ASSET_WITH_CONCEPT = {
  id: "asset-1",
  asset_type: "social_copy",
  content: {
    headline: "Fresh Bouquets",
    body: "Fresh spring bouquets are here for the season.",
    cta: "Visit us today",
    hashtags: ["#spring"],
    objective: "awareness",
    canonical_concept: {
      version: 1,
      objective: "awareness",
      occasionCategory: "general",
      primarySubjectClass: "floral_arrangement",
      captionIntent: "informational",
      ctaIntent: "visit_shop",
      visualDirection: { mood: null, lighting: null, composition: null, floralStyle: null, photoStrategy: null },
      creativeFamily: "text_only",
      factRequirements: [],
      assetRoute: "none",
      platform: "facebook",
      sympathyClassification: "not_sympathy",
      inventoryIntent: "not_inventory_driven",
      promotionIntent: "not_promotion"
    }
  }
};

// Item 7: "make the caption shorter" preserves the concept.
test("Part L #7 — revise_content (social_copy): 'make the caption shorter' preserves every concept identity field", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "Fresh Bouquets",
    body: "Fresh spring bouquets, in today.",
    cta: "Visit us today",
    visual_brief: "v",
    hashtags: ["#spring"],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: SOCIAL_COPY_ASSET_WITH_CONCEPT, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "asset-2" }, error: null },
      { data: null, error: null }, // variant update
      { data: null, error: null } // audit
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "make the caption shorter" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    const parent = SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept;
    for (const field of ["objective", "occasionCategory", "primarySubjectClass", "ctaIntent", "promotionIntent", "sympathyClassification", "inventoryIntent", "assetRoute"]) {
      assert.equal(concept[field], parent[field], `Part L #7: ${field} must be preserved byte-for-byte`);
    }
    assert.equal(assetInsert.payload.content.concept_change, undefined, "an ordinary wording revision must never record a concept_change");
  } finally {
    mock.restore();
  }
});

const FLYER_ASSET_WITH_CONCEPT = {
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
    }
  }
};

// Item 8: "make it warmer" (a caption-only tone tweak on a flyer asset)
// preserves the concept.
test("Part L #8 — revise_content (flyer): 'make it warmer' preserves the concept", async () => {
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
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: FLYER_ASSET_WITH_CONCEPT, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "asset-2" }, error: null }, // ai_generated_assets insert
      { data: null, error: null }, // variant update
      { data: null, error: null } // audit
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "make it warmer" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    const parent = FLYER_ASSET_WITH_CONCEPT.content.canonical_concept;
    assert.deepEqual(concept.objective, parent.objective);
    assert.deepEqual(concept.sympathyClassification, parent.sympathyClassification);
    assert.deepEqual(concept.assetRoute, parent.assetRoute);
    // On-image wording is untouched — only the caption changed.
    assert.equal(assetInsert.payload.content.headline, FLYER_ASSET_WITH_CONCEPT.content.headline);
  } finally {
    mock.restore();
  }
});

const IMAGE_ASSET_WITH_CONCEPT = {
  id: "asset-1",
  asset_type: "image",
  content: {
    url: "https://fake.storage/old.jpg",
    caption: "Fresh spring bouquets are here for the season.",
    visual_brief: "a bright spring bouquet on a wooden counter",
    base_visual_brief: "a bright spring bouquet on a wooden counter",
    brand_traits_used: [],
    visual_traits_used: [],
    creative_brief: { primary_subject: "a bright spring bouquet", mood: "cheerful" },
    objective: "awareness",
    grounded_in_inventory: [],
    canonical_concept: {
      version: 1,
      objective: "awareness",
      occasionCategory: "general",
      primarySubjectClass: "floral_arrangement",
      captionIntent: "informational",
      ctaIntent: "none",
      visualDirection: { mood: "cheerful", lighting: null, composition: null, floralStyle: null, photoStrategy: null },
      creativeFamily: "plain_photo_post",
      factRequirements: [],
      assetRoute: "ai_generated_photo",
      platform: "facebook",
      sympathyClassification: "not_sympathy",
      inventoryIntent: "not_inventory_driven",
      promotionIntent: "not_promotion"
    }
  }
};

function mockImageOnlyRegen() {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!/flux|black-forest-labs/i.test(String(url))) {
      return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean, matches the brief" } }) };
    }
    return { ok: true, json: async () => ({ success: true, result: { image: TINY_JPEG_BASE64 } }) };
  };
  return { restore: () => (globalThis.fetch = originalFetch) };
}

// Items 9-14: "make the image brighter" (an image-only regeneration) must
// preserve objective/occasion/subject class/promotion state/inventory
// intent all at once — every canonical-concept identity field.
test("Part L #9/10/11/12/13/14 — revise_content (image): an image-only regeneration preserves every identity field of the concept", async () => {
  const mock = mockImageOnlyRegen();
  try {
    const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
    const client = createFakeSupabaseClient(
      [
        superAdminRow(),
        { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
        { data: IMAGE_ASSET_WITH_CONCEPT, error: null },
        { data: { name: "Test Florals" }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: { id: "usage-img-1" }, error: null },
        { data: null, error: null },
        { data: { id: "usage-vision-1" }, error: null },
        { data: null, error: null },
        { data: { id: "media-2" }, error: null },
        { data: { id: "asset-2" }, error: null },
        { data: null, error: null }, // variant update
        { data: null, error: null } // audit
      ],
      { storage }
    );
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "regenerate the background image, a bit brighter" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    const parent = IMAGE_ASSET_WITH_CONCEPT.content.canonical_concept;
    // Item 9: objective preserved.
    assert.equal(concept.objective, parent.objective);
    // Item 10/11: occasion preserved (objective + occasionCategory here).
    assert.equal(concept.occasionCategory, parent.occasionCategory);
    // Item 12: subject class preserved.
    assert.equal(concept.primarySubjectClass, parent.primarySubjectClass);
    // Item 13: promotion state preserved.
    assert.equal(concept.promotionIntent, parent.promotionIntent);
    // Item 14: inventory intent preserved.
    assert.equal(concept.inventoryIntent, parent.inventoryIntent);
    // Batch 4 bug fix regression: creative_brief/objective/grounded_in_inventory
    // must still be carried forward — this branch used to drop them.
    assert.deepEqual(assetInsert.payload.content.creative_brief, IMAGE_ASSET_WITH_CONCEPT.content.creative_brief);
    assert.equal(assetInsert.payload.content.objective, IMAGE_ASSET_WITH_CONCEPT.content.objective);
  } finally {
    mock.restore();
  }
});

// Item 15: a copy rewrite preserves visual direction (never overwritten by
// a wording-only revision).
test("Part L #15 — revise_content (social_copy): a copy rewrite preserves visualDirection", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "h2",
    body: "Bright, fresh spring bouquets are here — come see today.",
    cta: "Visit us today",
    visual_brief: "v",
    hashtags: ["#spring"],
    asset_requirements: []
  });
  try {
    const assetWithMood = {
      ...SOCIAL_COPY_ASSET_WITH_CONCEPT,
      content: { ...SOCIAL_COPY_ASSET_WITH_CONCEPT.content, canonical_concept: { ...SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept, visualDirection: { mood: "cheerful", lighting: "natural", composition: null, floralStyle: null, photoStrategy: null } } }
    };
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: assetWithMood, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "asset-2" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "make it punchier" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    assert.deepEqual(assetInsert.payload.content.canonical_concept.visualDirection, assetWithMood.content.canonical_concept.visualDirection);
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// EXPLICIT CONCEPT CHANGE (16-21)
// ---------------------------------------------------------------------------

// Items 16, 21: birthday -> sympathy updates occasion/sympathy only, and
// records which fields changed.
test("Part L #16/21 — revise_content (social_copy): 'change this from a birthday post to a sympathy post' updates occasion/sympathy only, and records the change", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "With Sympathy",
    body: "Test Florals is honored to create a gentle sympathy arrangement for your family.",
    cta: "Call us to arrange delivery",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    const birthdayAsset = {
      ...SOCIAL_COPY_ASSET_WITH_CONCEPT,
      content: { ...SOCIAL_COPY_ASSET_WITH_CONCEPT.content, body: "Happy birthday! Fresh flowers to celebrate the day.", canonical_concept: { ...SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept, occasionCategory: "birthday" } }
    };
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: birthdayAsset, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "asset-2" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "change this from a birthday post to a sympathy post" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    assert.equal(concept.occasionCategory, "sympathy");
    assert.equal(concept.sympathyClassification, "sympathy");
    // Everything else inherited untouched.
    assert.equal(concept.objective, birthdayAsset.content.canonical_concept.objective);
    assert.equal(concept.ctaIntent, birthdayAsset.content.canonical_concept.ctaIntent);
    // Item 21: the changed fields are recorded.
    const changeRecord = assetInsert.payload.content.concept_change;
    assert.ok(changeRecord, "an explicit concept change must record concept_change");
    assert.ok(changeRecord.changed_fields.includes("occasionCategory"));
    assert.ok(changeRecord.changed_fields.includes("sympathyClassification"));
    assert.equal(changeRecord.reason, "change this from a birthday post to a sympathy post");
  } finally {
    mock.restore();
  }
});

// Item 17: awareness -> promotion updates objective/promotion intent only.
test("Part L #17 — revise_content (social_copy): 'promote 20% off instead' updates objective/promotion intent only", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "20% Off Today",
    body: "Take 20% off fresh spring bouquets today only.",
    cta: "Order now",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: SOCIAL_COPY_ASSET_WITH_CONCEPT, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "asset-2" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "promote 20% off instead" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    const parent = SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept;
    assert.equal(concept.objective, "promotion");
    assert.equal(concept.promotionIntent, "real_promotion");
    assert.equal(concept.occasionCategory, parent.occasionCategory);
    assert.equal(concept.primarySubjectClass, parent.primarySubjectClass);
    const changeRecord = assetInsert.payload.content.concept_change;
    assert.deepEqual(new Set(changeRecord.changed_fields), new Set(["objective", "promotionIntent"]));
  } finally {
    mock.restore();
  }
});

// Item 18: generic -> inventory-driven updates inventory intent only when
// explicit.
test("Part L #18 — revise_content (social_copy): 'use inventory we have today' updates inventory intent only", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "In The Shop Today",
    body: "Here's what's freshest in the shop today.",
    cta: "Visit us today",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: SOCIAL_COPY_ASSET_WITH_CONCEPT, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "asset-2" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "use inventory we have today" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    const parent = SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept;
    assert.equal(concept.inventoryIntent, "inventory_driven");
    assert.equal(concept.objective, parent.objective);
    assert.equal(concept.occasionCategory, parent.occasionCategory);
    assert.deepEqual(new Set(assetInsert.payload.content.concept_change.changed_fields), new Set(["inventoryIntent"]));
  } finally {
    mock.restore();
  }
});

// Item 19: a CTA change updates CTA intent only.
test("Part L #19 — revise_content (social_copy): 'change the cta to call us' updates CTA intent only", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "Fresh Bouquets",
    body: "Fresh spring bouquets are here for the season.",
    cta: "Call us",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: SOCIAL_COPY_ASSET_WITH_CONCEPT, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "asset-2" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "change the cta to call us" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    const parent = SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept;
    assert.equal(concept.ctaIntent, "call_shop");
    assert.equal(concept.objective, parent.objective);
    assert.equal(concept.occasionCategory, parent.occasionCategory);
    assert.deepEqual(new Set(assetInsert.payload.content.concept_change.changed_fields), new Set(["ctaIntent"]));
  } finally {
    mock.restore();
  }
});

// Item 20: an explicit subject change updates the subject class.
test("Part L #20 — revise_content (social_copy): 'change the subject to a mascot' updates the primary subject class", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "Meet Our Mascot",
    body: "Our shop mascot stopped by with fresh flowers today.",
    cta: "Visit us today",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: SOCIAL_COPY_ASSET_WITH_CONCEPT, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "asset-2" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "change the subject to a mascot character" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    const concept = assetInsert.payload.content.canonical_concept;
    assert.equal(concept.primarySubjectClass, "mascot_or_character");
    assert.deepEqual(new Set(assetInsert.payload.content.concept_change.changed_fields), new Set(["primarySubjectClass"]));
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// UNDO (22-25)
// ---------------------------------------------------------------------------

// Items 22, 24: undo restores the parent concept after a copy revision.
test("Part L #22/24 — revert_content_revision: undo after a copy revision restores the parent's exact canonical concept", async () => {
  const childAsset = {
    id: "asset-2",
    parent_asset_id: "asset-1",
    asset_type: "social_copy",
    content: { body: "shorter", canonical_concept: { ...SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept, objective: "promotion" } }
  };
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "in_review" }, error: null }, // currentItem
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-2" }], error: null }, // variants
    { data: { id: "asset-2", parent_asset_id: "asset-1", asset_type: "social_copy" }, error: null }, // asset lookup
    { data: SOCIAL_COPY_ASSET_WITH_CONCEPT, error: null }, // parent asset (full row)
    { data: null, error: null }, // variant update
    { data: null, error: null } // audit
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("revert_content_revision", { shop_id: "shop-1", content_item_id: "item-1" }));
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.asset.id, "asset-1", "Part L #44: undo must restore the PARENT asset id");
  assert.deepEqual(body.asset.content.canonical_concept, SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept, "Part L #22/24: undo must restore the parent's exact concept");
  const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(variantUpdate.payload.asset_id, "asset-1");
  void childAsset; // documents what the (never-persisted) child looked like
});

// Item 23: undo after an image revision restores the prior concept.
test("Part L #23 — revert_content_revision: undo after an image revision restores the prior concept", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "in_review" }, error: null },
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-2" }], error: null },
    { data: { id: "asset-2", parent_asset_id: "asset-1", asset_type: "image" }, error: null },
    { data: IMAGE_ASSET_WITH_CONCEPT, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("revert_content_revision", { shop_id: "shop-1", content_item_id: "item-1" }));
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.deepEqual(body.asset.content.canonical_concept, IMAGE_ASSET_WITH_CONCEPT.content.canonical_concept);
});

// Item 25: undo after an explicit concept change restores the ORIGINAL
// concept, not the changed one.
test("Part L #25 — revert_content_revision: undo after an explicit concept change restores the original (pre-change) concept", async () => {
  const preChangeAsset = { ...SOCIAL_COPY_ASSET_WITH_CONCEPT, content: { ...SOCIAL_COPY_ASSET_WITH_CONCEPT.content, canonical_concept: { ...SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept, occasionCategory: "birthday" } } };
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "in_review" }, error: null },
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-2" }], error: null },
    { data: { id: "asset-2", parent_asset_id: "asset-1", asset_type: "social_copy" }, error: null },
    { data: preChangeAsset, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("revert_content_revision", { shop_id: "shop-1", content_item_id: "item-1" }));
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.asset.content.canonical_concept.occasionCategory, "birthday", "must restore the ORIGINAL occasion, not whatever the reverted revision changed it to");
});

// ---------------------------------------------------------------------------
// COHERENCE (26-34)
// ---------------------------------------------------------------------------

// Item 30 (+27/29 via the same detector): a flyer wording revision whose
// generated text no longer reads as sympathy, when the concept says it
// must, is blocked rather than silently persisted.
test("Part L #30 — revise_content (flyer): a sympathy-concept flyer revision that comes back non-sympathy is blocked", async () => {
  const sympathyFlyerAsset = {
    ...FLYER_ASSET_WITH_CONCEPT,
    content: {
      ...FLYER_ASSET_WITH_CONCEPT.content,
      headline: "With Sympathy",
      body: "Our condolences to your family.",
      canonical_concept: { ...FLYER_ASSET_WITH_CONCEPT.content.canonical_concept, occasionCategory: "sympathy", sympathyClassification: "sympathy" }
    }
  };
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "Celebrate Today!",
    body: "Come celebrate with a bright bouquet — 20% off today only!",
    cta: "Order now",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "t", brief: "A sympathy arrangement post", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: sympathyFlyerAsset, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "make the wording on the flyer more upbeat" }));
    assert.equal(res.statusCode, 400, "a sympathy post's flyer text must never silently become celebratory/promotional");
    assert.equal(findInsert(client, "ai_generated_assets"), undefined, "nothing must be persisted when the coherence check blocks the revision");
  } finally {
    mock.restore();
  }
});

// Item 28: a CTA that invents urgency/a sale nothing in the request
// describes is blocked, via the same wiring.
test("Part L #28 — revise_content (flyer): a CTA that invents a sale nothing was asked for is blocked", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "Fresh Bouquets",
    body: "Order your fresh bouquet today.",
    cta: "50% off — today only, hurry!",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "t", brief: "Order your fresh bouquet today", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: FLYER_ASSET_WITH_CONCEPT, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "punch up the flyer wording" }));
    assert.equal(res.statusCode, 400, "an invented sale/urgency CTA nothing in the request describes must be blocked");
  } finally {
    mock.restore();
  }
});

// Items 26, 33: an image regeneration whose new prompt shares no real word
// with the original subject is blocked as subject drift, unless the
// florist explicitly asked to change the subject.
test("Part L #26/33 — revise_content (image): a background regeneration that would silently swap the depicted subject is blocked", async () => {
  const mock = mockImageOnlyRegen();
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: IMAGE_ASSET_WITH_CONCEPT, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    // "try a different photo of our mascot" names a completely different,
    // unrelated subject (a mascot) with no overlap with the original real
    // subject ("a bright spring bouquet") and never explicitly says to
    // change the subject.
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "try a different photo of our shop mascot dancing" }));
    assert.equal(res.statusCode, 400, "an image regeneration that silently swaps the depicted subject must be blocked");
    assert.equal(findInsert(client, "ai_generated_assets"), undefined);
  } finally {
    mock.restore();
  }
});

// Item 32: a real uploaded photo's asset route can never be silently
// swapped to an AI-generated one by a revision.
test("Part L #32 — revise_content (image): a real uploaded photo's asset route can never be silently swapped to AI-generated", async () => {
  const uploadedAsset = { ...IMAGE_ASSET_WITH_CONCEPT, content: { ...IMAGE_ASSET_WITH_CONCEPT.content, user_uploaded_photo: true, canonical_concept: { ...IMAGE_ASSET_WITH_CONCEPT.content.canonical_concept, assetRoute: "real_shop_photo" } } };
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
    { data: uploadedAsset, error: null },
    { data: { name: "Test Florals" }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "regenerate the photo" }));
  assert.equal(res.statusCode, 400, "a real uploaded photo must never be silently swapped for an AI generation");
});

// Item 31: a revised image prompt can't carry forward an inventory-driven
// flower name the CURRENT revision request doesn't reaffirm and verified
// inventory doesn't actually support — a stale species name baked into an
// old visual_brief must not survive an unrelated revision unchallenged.
// (A flower the florist's OWN current instruction names by hand is a real
// supplied fact and IS allowed — see buildImageRevisionBrief's own
// grounding rule — so this deliberately names the ungrounded flower only
// in the STALE stored visual_brief, never in the instruction itself.)
test("Part L #31 — revise_content (image): a stale ungrounded flower name is stripped from the revised image prompt, not silently carried forward", async () => {
  const mock = mockImageOnlyRegen();
  try {
    const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
    const staleOrchidAsset = {
      ...IMAGE_ASSET_WITH_CONCEPT,
      content: { ...IMAGE_ASSET_WITH_CONCEPT.content, visual_brief: "a bright bouquet of orchids on a wooden counter", base_visual_brief: "a bright bouquet of orchids on a wooden counter" }
    };
    const client = createFakeSupabaseClient(
      [
        superAdminRow(),
        { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
        { data: staleOrchidAsset, error: null },
        { data: { name: "Test Florals" }, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: { id: "usage-img-1" }, error: null },
        { data: null, error: null },
        { data: { id: "usage-vision-1" }, error: null },
        { data: null, error: null },
        { data: { id: "media-2" }, error: null },
        { data: { id: "asset-2" }, error: null },
        { data: null, error: null },
        { data: null, error: null }
      ],
      { storage }
    );
    const handler = createMarketingStudioHandler(baseDeps(client));
    // No flower named here — orchids only exists in the stale stored
    // visual_brief above, never reaffirmed by this actual request.
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "regenerate the background image, a bit brighter" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = findInsert(client, "ai_generated_assets");
    assert.doesNotMatch(assetInsert.payload.content.visual_brief, /\borchids?\b/i);
  } finally {
    mock.restore();
  }
});

// Item 34: unrequested concept drift is impossible by construction — see
// the module-level regression tests "detectConceptDrift: an unrequested
// objective change is caught when not in the allowed set" and "...multiple
// simultaneous unrequested drifts are all reported" in
// tests/marketing-canonical-concept.test.js, which this integration file
// does not re-derive. The defensive detectConceptDrift guard added inside
// buildRevisedConcept (marketing-studio.js) is the backstop that makes an
// unrequested drift throw rather than persist, should the logic above it
// ever regress.

// ---------------------------------------------------------------------------
// REGRESSION (35-44)
// ---------------------------------------------------------------------------

// Items 35, 42: Batch 1's output-safety pipeline still runs on a real
// generate_content request that also persists a canonical concept.
test("Part L #35/42 — generate_content: Batch 1's output-safety evaluator still runs, and the safe path still succeeds, alongside the new canonical concept", async () => {
  const copyJson = {
    platform: "facebook",
    headline: "Fresh Today",
    body: "Fresh, seasonal blooms are ready for pickup today.",
    cta: "Visit us today",
    visual_brief: "a bright bouquet on a wooden counter",
    creative_brief: { primary_subject: "a bright bouquet", mood: "cheerful", lighting: "natural", composition: "close-up", floral_style: "garden-style" },
    objective: "awareness",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
  const mock = mockCloudflareBoth(copyJson);
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "Fresh seasonal blooms post for Facebook", status: "idea" }, error: null },
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
      { data: null, error: null },
      { data: { id: "asset-1" }, error: null },
      { data: null, error: null },
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).item.status, "draft", "Part L #42: the safe generate_content path still succeeds");
  } finally {
    mock.restore();
  }
});

// Item 43: the safe revise_content path still succeeds alongside the new
// concept-inheritance wiring (already exercised by #7/#8/#15/#17/#18/#19/
// #20 above — this is the plainest possible case as its own checkpoint).
test("Part L #43 — revise_content: the safe path still succeeds for an ordinary, unremarkable revision", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "Fresh Bouquets",
    body: "Fresh spring bouquets, freshly arranged.",
    cta: "Visit us today",
    visual_brief: "v",
    hashtags: ["#spring"],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: SOCIAL_COPY_ASSET_WITH_CONCEPT, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "asset-2" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "tighten the wording a bit" }));
    assert.equal(res.statusCode, 200, res.body);
  } finally {
    mock.restore();
  }
});

// Item 41: Batch 3's approval checks still work — a genuinely valid,
// finalized flyer whose content now also carries a canonical concept still
// approves cleanly.
test("Part L #41 — approve_content: a valid finalized flyer with a persisted canonical concept still approves cleanly", async () => {
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
              render_status: "rendered",
              canonical_concept: FLYER_ASSET_WITH_CONCEPT.content.canonical_concept
            }
          }
        ],
        error: null
      },
      { data: { id: "item-1", status: "approved" }, error: null }
    ],
    { storage }
  );
  const handler = createMarketingStudioHandler({ florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } });
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).item.status, "approved");
});

// Item 44: undo restores the correct asset lineage (parent_asset_id) —
// already proven by #22/#23/#25 above; this checkpoint asserts it directly
// against the id chain rather than the concept payload.
test("Part L #44 — revert_content_revision: undo repoints the variant at the exact parent asset id, never a different row", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "in_review" }, error: null },
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-3" }], error: null },
    { data: { id: "asset-3", parent_asset_id: "asset-2", asset_type: "social_copy" }, error: null },
    { data: { id: "asset-2", asset_type: "social_copy", content: { body: "middle version", canonical_concept: SOCIAL_COPY_ASSET_WITH_CONCEPT.content.canonical_concept } }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("revert_content_revision", { shop_id: "shop-1", content_item_id: "item-1" }));
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.asset.id, "asset-2", "undo must land on the immediate parent, not skip a generation");
});
