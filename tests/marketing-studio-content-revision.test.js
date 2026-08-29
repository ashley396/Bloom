import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";
import { mockCloudflareGenerate } from "./helpers/mock-cloudflare-generate.mjs";

// Continuing PR #177 — the conversational revision loop: "make it →
// talk to Lily about changes → keep refining → Save/Approve when
// satisfied." A revision is just another real generation call producing a
// NEW child asset (parent_asset_id set), never an in-place edit of the
// asset being revised.

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
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

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

function mockImageGen() {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) });
  return { restore: () => (globalThis.fetch = originalFetch) };
}

function mockSocialPostGen(jsonResult) {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) });
  return { restore: () => (globalThis.fetch = originalFetch) };
}

const IMAGE_ASSET = {
  id: "asset-1",
  asset_type: "image",
  content: { url: "https://fake.storage/old.jpg", caption: "Order your fall bouquet today!", visual_brief: "a rose bouquet on a wooden counter", brand_traits_used: [], visual_traits_used: [] }
};

test("revise_content (image): creates a NEW child asset, never overwrites the one being revised, and preserves the caption for a visual-only edit", async () => {
  const mock = mockImageGen();
  try {
    const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
    const client = createFakeSupabaseClient(
      [
        superAdminRow(),
        { data: { id: "item-1", content_type: "image_post", title: "Fall Bouquet", brief: "b", status: "draft" }, error: null }, // currentItem
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null }, // variants
        { data: IMAGE_ASSET, error: null }, // current asset
        { data: { name: "Test Florals" }, error: null }, // shopRow
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: { id: "asset-2" }, error: null }, // website_media insert
        { data: { id: "asset-2", parent_asset_id: "asset-1", content: { url: "https://fake.storage/website-media/new.jpg", caption: "Order your fall bouquet today!" } }, error: null }, // ai_generated_assets insert
        { data: null, error: null }, // variant update
        { data: null, error: null } // audit insert
      ],
      { storage }
    );
    const handler = createMarketingStudioHandler(baseDeps(client));
    // Unambiguous image-only instruction — the exact phrasing the real
    // "Regenerate image" one-click button sends (see the flyer branch's
    // own test for the same instruction), so instructionAffectsFlyerImage
    // is true and instructionAffectsFlyerWording is false: this must NOT
    // also call generateSocialPost.
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "Regenerate the background image — keep the exact same wording." }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.asset.parent_asset_id, "asset-1", "the new asset must reference the one it revised");
    assert.notEqual(body.asset.id, "asset-1", "a revision must be a NEW row, never the same id");

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.equal(assetInsert.payload.parent_asset_id, "asset-1");
    assert.equal(assetInsert.payload.content.caption, "Order your fall bouquet today!", "a background-only revision must not alter the copy/caption");

    // The ORIGINAL asset row is never touched by an update/delete — only ever read.
    const assetOps = client.calls.filter((c) => c.table === "ai_generated_assets");
    assert.ok(assetOps.every((c) => !c.ops.some((op) => op[0] === "update" || op[0] === "delete")), "the parent asset must never be mutated by a revision");

    const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
    assert.equal(variantUpdate.payload.asset_id, "asset-2");
    assert.equal(variantUpdate.payload.hashtags, undefined, "hashtags must stay untouched by a visual-only revision");
  } finally {
    mock.restore();
  }
});

// Real, live-found defect (Ashley's own screenshots, 2026-08-29): a
// generated Facebook post said "the Jacksonville Jaguars"; she asked to
// change it to "Floyd Central Jaguars" — a plain team-name correction with
// no image language in it at all — and got the photo regenerated with the
// SAME wrong name still in the caption, twice. Root cause: the "image"
// asset type's revise_content branch had no caption-revision code path at
// all. This is the regression guard for the fix: a plain fact/name
// correction now revises the caption, and — just as important — leaves the
// photo untouched, since nothing about the request asked for a new image.
test("revise_content (image): a plain wording/name correction ('change it to Floyd Central Jaguars') revises the CAPTION, not the photo — the exact bug Ashley reported", async () => {
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "Good luck!",
    body: "Good luck to the Floyd Central Jaguars this Friday! 🐾💐",
    cta: "Order now",
    visual_brief: "a jaguar holding a bouquet of flowers",
    hashtags: ["#gojaguars"],
    asset_requirements: []
  });
  try {
    const jaguarAsset = {
      id: "asset-1",
      asset_type: "image",
      content: {
        url: "https://fake.storage/jaguar.jpg",
        caption: "Good luck to the Jacksonville Jaguars this Friday! 🐾💐",
        visual_brief: "a jaguar holding a bouquet of flowers",
        brand_traits_used: [],
        visual_traits_used: []
      }
    };
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "Jaguars Post", brief: "b", status: "draft" }, error: null }, // currentItem
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null }, // variants
      { data: jaguarAsset, error: null }, // current asset
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      // No website_media insert queued — a pure name correction must never
      // call generateImage, so if it wrongly did, the next real DB call
      // (the asset insert below) would receive the wrong queued response
      // and this test would fail loudly rather than silently pass.
      { data: { id: "asset-2", parent_asset_id: "asset-1", content: { url: "https://fake.storage/jaguar.jpg", caption: "Good luck to the Floyd Central Jaguars this Friday! 🐾💐" } }, error: null }, // ai_generated_assets insert
      { data: null, error: null }, // variant update
      { data: null, error: null } // audit insert
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "change it to Floyd Central Jaguars" }));
    assert.equal(res.statusCode, 200, `expected the correction to succeed: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.match(body.asset.content.caption, /Floyd Central Jaguars/, "the caption must actually pick up the corrected team name");
    assert.doesNotMatch(body.asset.content.caption, /Jacksonville/, "the old, wrong team name must not survive the correction");
    assert.equal(body.asset.url, "https://fake.storage/jaguar.jpg", "a plain wording correction must leave the photo exactly as it was — never re-roll it");

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.match(assetInsert.payload.content.caption, /Floyd Central Jaguars/);
    assert.equal(assetInsert.payload.content.url, "https://fake.storage/jaguar.jpg", "the persisted asset's photo url must be carried forward unchanged");
    assert.equal(client.calls.find((c) => c.table === "website_media"), undefined, "no new photo may ever be generated/uploaded for a pure wording correction");

    // The photo itself is STILL an AI-generated photo — it just wasn't
    // re-rolled by this particular revision. A caption-only fix must never
    // silently clear the disclosure flags just because it didn't touch the
    // image this time (that photo still has to be disclosed when published).
    const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
    assert.equal(variantUpdate.payload.generative_image_used, true, "the photo is still AI-generated even though this revision only touched the caption");
    assert.equal(variantUpdate.payload.ai_content_type, "generative_image");
    assert.equal(variantUpdate.payload.ai_disclosure_required, true, "disclosure must not be silently cleared by a caption-only revision");
  } finally {
    mock.restore();
  }
});

// Second real, live-found defect from the same screenshots: a regenerated
// photo came back with the requested subject (a jaguar) missing entirely.
// Root cause: the real description that got the subject drawn was never
// persisted at generation time, AND buildImageRevisionBrief's own output
// became the next revision's input, nesting the whole history and
// eventually blowing the image prompt's length budget — since visual_brief
// is the only optional clause there, the ENTIRE thing (including the
// subject) got dropped in one piece, not trimmed. This proves the fix
// end-to-end across TWO successive image-only revisions — the subject must
// survive both, and the prompt actually sent to the provider must still
// name it on the second call, not just the first.
test("revise_content (image): the original subject survives across MULTIPLE successive photo regenerations — the exact 'no jaguar in it at all' bug", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  const capturedPrompts = [];
  globalThis.fetch = async (url, options) => {
    const parsedBody = JSON.parse(options?.body || "{}");
    capturedPrompts.push(parsedBody.prompt);
    return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
  };
  try {
    const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
    const jaguarAsset = {
      id: "asset-1",
      asset_type: "image",
      content: {
        url: "https://fake.storage/jaguar-1.jpg",
        caption: "Good luck to the Floyd Central Jaguars this Friday! 🐾💐",
        visual_brief: "A jaguar mascot holding a bouquet of flowers, playful sports-fan theme, bright stadium colors.",
        brand_traits_used: [],
        visual_traits_used: []
      }
    };
    const client = createFakeSupabaseClient(
      [
        // ── Revision 1: "Regenerate the background image — keep the exact same wording." ──
        superAdminRow(),
        { data: { id: "item-1", content_type: "image_post", title: "Jaguars Post", brief: "Good luck post for the game this week", status: "draft" }, error: null }, // currentItem
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null }, // variants
        { data: jaguarAsset, error: null }, // current asset (the ORIGINAL, has visual_brief but no base_visual_brief yet)
        { data: { name: "Test Florals" }, error: null }, // shopRow
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: { id: "media-2" }, error: null }, // website_media insert
        {
          data: {
            id: "asset-2",
            parent_asset_id: "asset-1",
            content: { url: "https://fake.storage/website-media/jaguar-2.jpg", caption: "Good luck to the Floyd Central Jaguars this Friday! 🐾💐" }
          },
          error: null
        }, // ai_generated_assets insert
        { data: null, error: null }, // variant update
        { data: null, error: null }, // audit insert

        // ── Revision 2: same instruction again, on the asset revision 1 just produced ──
        superAdminRow(),
        { data: { id: "item-1", content_type: "image_post", title: "Jaguars Post", brief: "Good luck post for the game this week", status: "draft" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-2" }], error: null },
        {
          data: {
            id: "asset-2",
            asset_type: "image",
            parent_asset_id: "asset-1",
            content: {
              url: "https://fake.storage/website-media/jaguar-2.jpg",
              caption: "Good luck to the Floyd Central Jaguars this Friday! 🐾💐",
              visual_brief: "Revise the visual as requested: Regenerate the background image — keep the exact same wording. Keep the same flowers/arrangement/product exactly as shown before — do not change, remove, or redesign the product itself unless the instruction explicitly asks for that. Only change what the instruction actually asks for; leave everything else about the composition the same. Previous version's visual concept, for reference only: A jaguar mascot holding a bouquet of flowers, playful sports-fan theme, bright stadium colors.",
              base_visual_brief: "A jaguar mascot holding a bouquet of flowers, playful sports-fan theme, bright stadium colors."
            }
          },
          error: null
        }, // current asset (asset-2, the child revision 1 just made — DOES carry base_visual_brief forward)
        { data: { name: "Test Florals" }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: { id: "media-3" }, error: null },
        { data: { id: "asset-3", parent_asset_id: "asset-2", content: {} }, error: null },
        { data: null, error: null },
        { data: null, error: null }
      ],
      { storage }
    );
    const handler = createMarketingStudioHandler(baseDeps(client));
    const instruction = "Regenerate the background image — keep the exact same wording.";

    const res1 = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction }));
    assert.equal(res1.statusCode, 200, `revision 1 failed: ${res1.body}`);

    const res2 = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction }));
    assert.equal(res2.statusCode, 200, `revision 2 failed: ${res2.body}`);

    assert.equal(capturedPrompts.length, 2, "both revisions must have actually called the image provider");
    assert.match(capturedPrompts[0], /jaguar/i, "revision 1's real prompt must still name the subject");
    assert.match(capturedPrompts[1], /jaguar/i, "revision 2's real prompt must STILL name the subject — this is the exact bug: it silently vanished by the second regeneration");

    const secondInsert = client.calls.filter((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert")).at(-1);
    assert.equal(
      secondInsert.payload.content.base_visual_brief,
      "A jaguar mascot holding a bouquet of flowers, playful sports-fan theme, bright stadium colors.",
      "base_visual_brief must carry forward UNCHANGED, never re-derived from the already-compounded visual_brief"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("revert_content_revision: restores the parent instantly — the variant is repointed back, nothing is deleted", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null }, // currentItem
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-2" }], error: null }, // variants (currently on the revised child)
    { data: { id: "asset-2", parent_asset_id: "asset-1", asset_type: "image" }, error: null }, // current asset lookup
    { data: { id: "asset-1", parent_asset_id: null, asset_type: "image", content: { url: "https://fake.storage/old.jpg", caption: "Order your fall bouquet today!" } }, error: null }, // parent asset
    { data: null, error: null }, // variant update
    { data: null, error: null } // audit insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("revert_content_revision", { shop_id: "shop-1", content_item_id: "item-1" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.asset.id, "asset-1");
  const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(variantUpdate.payload.asset_id, "asset-1");
  assert.equal(variantUpdate.payload.caption, "Order your fall bouquet today!");
  // Nothing was deleted — no delete op against ai_generated_assets at all.
  assert.ok(!client.calls.some((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "delete")));
});

test("revert_content_revision: refuses when already at the original version — nothing to undo", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
    { data: { id: "asset-1", parent_asset_id: null, asset_type: "image" }, error: null } // no parent at all
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("revert_content_revision", { shop_id: "shop-1", content_item_id: "item-1" }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /already the original version/i);
});

test("revise_content: a one-time style instruction ('make this more elegant') never writes My Style — only a revision happens", async () => {
  // "make this more elegant" names neither the image nor the wording
  // explicitly, so it is ambiguous under instructionAffectsFlyerImage/
  // instructionAffectsFlyerWording — the caption is revised (the safer
  // default for an "image" asset, which has no separate social_copy row
  // to fall back on), the photo is not.
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "Elegant Fall Blooms",
    body: "An elegant, refined bouquet styled for your table.",
    cta: "Order now",
    visual_brief: "a rose bouquet on a wooden counter",
    hashtags: ["#elegant"],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: IMAGE_ASSET, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "asset-2", parent_asset_id: "asset-1", content: { url: "https://fake.storage/old.jpg", caption: "An elegant, refined bouquet styled for your table." } }, error: null }, // ai_generated_assets insert
      { data: null, error: null }, // variant update
      { data: null, error: null } // audit insert
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "make this more elegant" }));
    assert.equal(res.statusCode, 200);
    // No My Style / Brand Brain write anywhere in this call — a one-time
    // instruction (no "from now on"/"always"/"keep it") never persists.
    assert.equal(client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert")), undefined);
    assert.equal(client.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert")), undefined);
  } finally {
    mock.restore();
  }
});

test("revise_content: explicit 'use this style from now on' with no new change updates My Style from the LAST revision's own applied trait — no new asset is generated", async () => {
  const assetWithRevisionHistory = {
    id: "asset-2",
    asset_type: "image",
    content: {
      url: "https://fake.storage/luxury.jpg",
      caption: "Order your fall bouquet today!",
      revision_instruction: "use a luxury flower shop background instead",
      revision_traits: [{ category: "background_style", text: "luxury flower shop", polarity: "positive" }]
    }
  };
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-2" }], error: null },
    { data: assetWithRevisionHistory, error: null },
    { data: null, error: null }, // loadStyleMemory
    { data: null, error: null }, // saveStyleMemory upsert
    { data: null, error: null } // audit insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "I like this better, use this style from now on" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.persisted, true);
  const styleUpsert = client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert"));
  assert.ok(styleUpsert, "the explicit 'use this from now on' signal must write a real, persistent My Style trait");
  assert.equal(styleUpsert.payload.preferences.background_style.traits[0].text, "luxury flower shop");
  assert.equal(styleUpsert.payload.preferences.background_style.traits[0].source, "explicit");
  assert.equal(styleUpsert.payload.preferences.background_style.traits[0].active, true, "an explicit statement is active immediately — no promotion threshold");
  // No new asset was generated — nothing else changed, so no image call/insert.
  assert.equal(client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert")), undefined);
});

test("revise_content: a bare 'use this from now on' with NOTHING to point back to is refused rather than saving a fabricated preference", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
    { data: IMAGE_ASSET, error: null } // no revision_traits recorded on it at all — it's the ORIGINAL generation
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "use this from now on" }));
  assert.equal(res.statusCode, 400);
  assert.equal(client.calls.find((c) => c.table === "ai_style_memory"), undefined);
});

const SOCIAL_COPY_ASSET = {
  id: "asset-1",
  asset_type: "social_copy",
  content: { headline: "h", body: "Order today! Call us at (555) 123-4567.", cta: "Order now", hashtags: ["#fall"] }
};

test("revise_content (wording): exact phone/date/price/URL facts are preserved through a real wording revision", async () => {
  const mock = mockSocialPostGen({
    platform: "facebook",
    headline: "h2",
    body: "Order today! Call us at (555) 123-4567 for same-day pickup.",
    cta: "Order now",
    visual_brief: "v",
    hashtags: ["#fall"],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: SOCIAL_COPY_ASSET, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "asset-2" }, error: null }, // persist new social_copy asset
      { data: null, error: null }, // variant update
      { data: null, error: null } // audit
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "mention same-day pickup" }));
    assert.equal(res.statusCode, 200);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.match(assetInsert.payload.content.body, /\(555\) 123-4567/);
  } finally {
    mock.restore();
  }
});

test("revise_content (wording): a revision that would DROP an exact fact is refused — nothing is persisted, the caller gets a clear error", async () => {
  const mock = mockSocialPostGen({
    platform: "facebook",
    headline: "h2",
    body: "Order today for same-day pickup!", // the real phone number is gone
    cta: "Order now",
    visual_brief: "v",
    hashtags: ["#fall"],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "in_review" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: SOCIAL_COPY_ASSET, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null }
      // No further responses queued — an insert here would prove the gate didn't hold.
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "mention same-day pickup" }));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /exact phone number, date, price, or link/i);
    assert.equal(client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert")), undefined);
    assert.equal(client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update")), undefined);
  } finally {
    mock.restore();
  }
});

test("revise_content: every read/write is scoped to the REQUESTING shop — cross-shop isolation", async () => {
  // "use a marble background instead" names neither the image nor the
  // wording explicitly under the real classifier ("use" isn't one of the
  // change/regenerate/try-different verbs) — ambiguous, so the caption
  // revises and the photo does not; only generateSocialPost is called.
  const mock = mockCloudflareGenerate({
    platform: "facebook",
    headline: "h",
    body: "A marble-styled bouquet, ready to order.",
    cta: "Order now",
    visual_brief: "a rose bouquet on a wooden counter",
    hashtags: [],
    asset_requirements: []
  });
  try {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: IMAGE_ASSET, error: null },
      { data: { name: "Real Tenant Florals" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "asset-2", parent_asset_id: "asset-1", content: {} }, error: null }, // ai_generated_assets insert
      { data: null, error: null }, // variant update
      { data: null, error: null } // audit insert
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    await handler(event("revise_content", { shop_id: "shop-9-real-tenant", content_item_id: "item-1", instruction: "use a marble background instead" }));
    for (const table of ["marketing_content_items", "marketing_platform_variants", "ai_generated_assets", "shops"]) {
      const calls = client.calls.filter((c) => c.table === table);
      for (const call of calls) {
        const shopEq = call.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
        if (shopEq) assert.equal(shopEq[1][1], "shop-9-real-tenant", `${table} call must be scoped to the requesting shop`);
      }
    }
  } finally {
    mock.restore();
  }
});

test("revise_content: refuses to revise an already-approved item — revision is only for draft/in_review, not a way to bypass review", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "approved" }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "use a marble background instead" }));
  assert.equal(res.statusCode, 400);
});

// Final integration/verification pass, section 6 (cross-shop isolation) —
// the OTHER half of the proof: the scoping-predicate tests above prove
// every query CARRIES the requesting shop's id; this proves what actually
// happens when that scoping legitimately finds nothing, which is exactly
// what a real Postgres `.eq("id", contentItemId).eq("shop_id", shopB)`
// returns for a content item that really belongs to shop A — direct-ID
// access by another tenant fails closed, not silently.
test("revise_content / revert_content_revision: a content_item_id belonging to a DIFFERENT shop is treated as not found — direct-ID access from another tenant never reaches any asset/style/brand-brain query", async () => {
  for (const action of ["revise_content", "revert_content_revision"]) {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      // The real, shop-scoped lookup (.eq("id", ...).eq("shop_id", "shop-B"))
      // finds nothing — shop A's row exists, but not under shop B's filter.
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event(action, { shop_id: "shop-B", content_item_id: "item-belongs-to-shop-A", ...(action === "revise_content" ? { instruction: "use a marble background instead" } : {}) }));
    assert.equal(res.statusCode, 404, `${action} must report not-found, never leak shop A's content`);
    assert.equal(client.calls.find((c) => c.table === "ai_generated_assets"), undefined, `${action} must never even query assets once the item lookup itself found nothing for this shop`);
    assert.equal(client.calls.find((c) => c.table === "ai_style_memory"), undefined);
    assert.equal(client.calls.find((c) => c.table === "marketing_brand_brain"), undefined);
  }
});

test("approve_content: a content_item_id belonging to a DIFFERENT shop cannot be approved — direct-ID access from another tenant fails closed", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: null, error: null } // the shop-scoped lookup finds nothing under shop B's filter
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("approve_content", { shop_id: "shop-B", content_item_id: "item-belongs-to-shop-A", decision: "approved" }));
  assert.equal(res.statusCode, 404);
  assert.equal(client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update")), undefined, "nothing about shop A's item may ever be updated by shop B's request");
});
