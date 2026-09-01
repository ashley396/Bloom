import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Final database + integration verification pass (continuing PR #177): one
// continuous, real handler-driven sequence proving the full lifecycle —
// revise -> revise again -> undo -> undo -> revise from the original into a
// new branch -> approve — with every claim verified against the literal DB
// payloads the real handler would send (insert/update bodies captured by
// the fake client), not DOM behavior. Also proves version history is a
// real GRAPH (branching), not a forced linear chain: undoing twice off C
// and re-revising the ORIGINAL produces a second child of A alongside
// B/C — nothing is deleted, nothing is overwritten.
//
//   A (original) -> B (revise: soft luxury bg) -> C (revise: elegant)
//    \-> D (revise from A again, after two undos: marble bg)
//
// Approving at the end must approve whatever the CURRENT asset actually is
// (D) — never A/B/C.
//
// Asset A is SEEDED directly rather than produced by a real
// generate_content call, simply so this test can exercise the
// revise/undo/branch/approve lifecycle in isolation without also standing
// up a full generate_content fixture. (generate_content briefly routed
// every image_post through the flyer/poster pipeline instead — Ashley's
// own later, more specific feedback reverted that: an ordinary decorative
// request goes back to a plain photo-only image, and only a request that
// actually needs exact on-image wording, like a closing notice, takes the
// flyer path. Either way, this lifecycle exercises revise_content's own
// "image" branch, which was never touched by any of that.)

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
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
});
test.after(() => {
  process.env = { ...savedEnv };
});

function event(action, body, { method = "POST" } = {}) {
  return { httpMethod: method, queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

// One mock covering BOTH real Cloudflare call shapes this lifecycle uses:
// the text/copy model (generateSocialPost, used by an ambiguous
// revise_content instruction) and the image model (generateImage, used by
// every image-affecting revision) — distinguished by the real, different
// model slug each one's real URL path contains.
function mockCloudflareBoth({ socialPostResult }) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("flux-1-schnell")) {
      return { ok: true, json: async () => ({ success: true, result: { image: TINY_JPEG_BASE64 } }) };
    }
    // runMarketingImageQuality's own vision-check call (florist-ai-vision.js,
    // llava/uform/llama-vision model URLs) must never be confused with the
    // real text/copy model call — a well-formed PASS reply here, or the
    // gate correctly treats it as unreadable and never persists the photo.
    if (/llava|uform|llama-3\.2-11b-vision/i.test(String(url))) {
      return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean, matches the brief" } }) };
    }
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(socialPostResult) } }) };
  };
  return { restore: () => (globalThis.fetch = originalFetch) };
}

test("full lifecycle on a pre-existing image asset: revise -> revise -> undo -> undo -> revise (new branch) -> approve — real persisted-data proof, branching preserved, nothing ever overwritten or deleted", async () => {
  const mock = mockCloudflareBoth({
    socialPostResult: {
      platform: "facebook",
      headline: "Spring is here!",
      body: "Order your spring bouquet today!",
      cta: "Order now",
      visual_brief: "a spring bouquet on a wooden counter",
      hashtags: ["#spring"],
      asset_requirements: [],
      brand_traits_used: [],
      visual_traits_used: []
    }
  });
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });

  const client = createFakeSupabaseClient(
    [
      // ── STEP 2: revise_content A -> B ("change the background to a soft luxury look instead") ──
      // Asset A is a pre-existing asset_type "image" row (seeded directly —
      // see the file header comment for why generate_content no longer
      // produces one), already attached to item-1 before this test starts.
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "Spring Bouquet", brief: "b", status: "draft" }, error: null }, // currentItem
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-A" }], error: null }, // variantsResult
      {
        data: {
          id: "asset-A",
          asset_type: "image",
          parent_asset_id: null,
          content: { url: "https://fake.storage/a.jpg", caption: "Order your spring bouquet today!", visual_brief: "a spring bouquet on a wooden counter", brand_traits_used: [], visual_traits_used: [] }
        },
        error: null
      }, // assetResult -> A's real row
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "usage-img-b" }, error: null }, // reserveProviderCall(image) insert
      { data: null, error: null }, // completeProviderCall(image) update
      { data: { id: "usage-vision-b" }, error: null }, // reserveProviderCall(vision) insert
      { data: null, error: null }, // completeProviderCall(vision) update
      { data: { id: "media-b" }, error: null }, // website_media insert
      { data: { id: "asset-B" }, error: null }, // persistGeneratedAsset -> B (parent=A)
      { data: null, error: null }, // variant update -> asset B
      { data: null, error: null }, // audit insert

      // ── STEP 3: revise_content B -> C ("make this more elegant") ─────
      // Ambiguous under the real classifier (names neither the image nor
      // the wording explicitly) — the caption revises via generateSocialPost
      // (the mock's non-flux fallback branch answers it), the photo does
      // not, so there is no website_media insert here.
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "Spring Bouquet", brief: "b", status: "draft" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-B" }], error: null },
      {
        data: {
          id: "asset-B",
          asset_type: "image",
          parent_asset_id: "asset-A",
          content: { url: "https://fake.storage/b.jpg", caption: "Order your spring bouquet today!", visual_brief: "change the background to a soft luxury look instead a spring bouquet on a wooden counter", brand_traits_used: [], visual_traits_used: [{ category: "background_style", text: "soft luxury", polarity: "positive" }] }
        },
        error: null
      }, // assetResult -> B's real row
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "asset-C" }, error: null }, // persistGeneratedAsset -> C (parent=B)
      { data: null, error: null },
      { data: null, error: null },

      // ── STEP 4: revert_content_revision — undo C -> B ─────────────────
      superAdminRow(),
      { data: { id: "item-1", status: "draft" }, error: null }, // currentItem
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-C" }], error: null }, // variantsResult
      { data: { id: "asset-C", parent_asset_id: "asset-B", asset_type: "image" }, error: null }, // assetResult (current = C)
      {
        data: {
          id: "asset-B",
          parent_asset_id: "asset-A",
          asset_type: "image",
          content: { url: "https://fake.storage/b.jpg", caption: "Order your spring bouquet today!", hashtags: [] }
        },
        error: null
      }, // parentResult -> B's full row
      { data: null, error: null }, // variant update -> back to B
      { data: null, error: null }, // audit insert

      // ── STEP 5: revert_content_revision — undo B -> A ─────────────────
      superAdminRow(),
      { data: { id: "item-1", status: "draft" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-B" }], error: null }, // variants now point at B (from step 4)
      { data: { id: "asset-B", parent_asset_id: "asset-A", asset_type: "image" }, error: null }, // assetResult (current = B)
      {
        data: {
          id: "asset-A",
          parent_asset_id: null,
          asset_type: "image",
          content: { url: "https://fake.storage/a.jpg", caption: "Order your spring bouquet today!", hashtags: [] }
        },
        error: null
      }, // parentResult -> A's full row
      { data: null, error: null }, // variant update -> back to A
      { data: null, error: null }, // audit insert

      // ── STEP 6: revise_content from A -> D (NEW branch — "change the background to a marble countertop look instead") ──
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "Spring Bouquet", brief: "b", status: "draft" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-A" }], error: null }, // variants now point at A again (from step 5)
      {
        data: {
          id: "asset-A",
          asset_type: "image",
          parent_asset_id: null,
          content: { url: "https://fake.storage/a.jpg", caption: "Order your spring bouquet today!", visual_brief: "a spring bouquet on a wooden counter", brand_traits_used: [], visual_traits_used: [] }
        },
        error: null
      }, // assetResult -> A's real row again
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "usage-img-d" }, error: null }, // reserveProviderCall(image) insert
      { data: null, error: null }, // completeProviderCall(image) update
      { data: { id: "usage-vision-d" }, error: null }, // reserveProviderCall(vision) insert
      { data: null, error: null }, // completeProviderCall(vision) update
      { data: { id: "media-d" }, error: null },
      { data: { id: "asset-D" }, error: null }, // persistGeneratedAsset -> D (parent=A, sibling of B)
      { data: null, error: null },
      { data: null, error: null },

      // ── STEP 7: approve_content — must approve whatever is CURRENT (D) ─
      superAdminRow(),
      { data: { id: "item-1", status: "draft" }, error: null }, // current
      { data: [{ asset_id: "asset-D" }], error: null }, // reviewVariantAssets
      {
        data: [{ id: "asset-D", content: { brand_traits_used: [], visual_traits_used: [{ category: "background_style", text: "marble countertop", polarity: "positive" }] } }],
        error: null
      }, // reviewAssets -> D's traits_used (brand empty -> loadBrandBrain/saveBrandBrain never queried below); also the durability gate's own read — D is asset_type "image", not "flyer", so it's never blocked here
      { data: { id: "item-1", status: "approved" }, error: null }, // status update
      { data: null, error: null }, // loadStyleMemory
      { data: null, error: null }, // saveStyleMemory upsert
      { data: null, error: null } // audit insert
    ],
    { storage }
  );

  try {
    const handler = createMarketingStudioHandler(baseDeps(client));

    // STEP 2 (asset A already exists — seeded directly, see file header)
    const revise1 = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "change the background to a soft luxury look instead" }));
    assert.equal(revise1.statusCode, 200, `revise A->B failed: ${revise1.body}`);
    let insert = client.calls.filter((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert")).at(-1);
    assert.equal(insert.payload.parent_asset_id, "asset-A", "B's parent must be A");
    assert.equal(insert.payload.content.caption, "Order your spring bouquet today!", "a visual-only revision must never alter the caption");

    // STEP 3
    const revise2 = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "make this more elegant" }));
    assert.equal(revise2.statusCode, 200, `revise B->C failed: ${revise2.body}`);
    insert = client.calls.filter((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert")).at(-1);
    assert.equal(insert.payload.parent_asset_id, "asset-B", "C's parent must be B");

    // STEP 4: undo C -> B
    const undo1 = await handler(event("revert_content_revision", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(undo1.statusCode, 200, `undo C->B failed: ${undo1.body}`);
    assert.equal(JSON.parse(undo1.body).asset.id, "asset-B");
    let variantUpdate = client.calls.filter((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update")).at(-1);
    assert.equal(variantUpdate.payload.asset_id, "asset-B", "content must point back to B after the first undo");

    // STEP 5: undo B -> A
    const undo2 = await handler(event("revert_content_revision", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(undo2.statusCode, 200, `undo B->A failed: ${undo2.body}`);
    assert.equal(JSON.parse(undo2.body).asset.id, "asset-A");
    variantUpdate = client.calls.filter((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update")).at(-1);
    assert.equal(variantUpdate.payload.asset_id, "asset-A", "content must point back to the ORIGINAL (A) after the second undo");

    // STEP 6: revise A again -> D, a NEW branch/sibling of B (B and C still exist untouched)
    const revise3 = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "change the background to a marble countertop look instead" }));
    assert.equal(revise3.statusCode, 200, `revise A->D failed: ${revise3.body}`);
    insert = client.calls.filter((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert")).at(-1);
    assert.equal(insert.payload.parent_asset_id, "asset-A", "D's parent is ALSO A — a real branch, B is not D's ancestor");

    // Branching proof: exactly 3 real asset rows were inserted by this test
    // (B, C, D — A was seeded directly, not created via a real call) —
    // never fewer (nothing collapsed/overwritten) and never an
    // update/delete against ai_generated_assets at any point (a revision
    // NEVER mutates a prior version's row).
    const allAssetInserts = client.calls.filter((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.equal(allAssetInserts.length, 3, "exactly B, C, D were created by this test — nothing collapsed");
    assert.ok(
      client.calls.filter((c) => c.table === "ai_generated_assets").every((c) => !c.ops.some((op) => op[0] === "update" || op[0] === "delete")),
      "no asset row is ever updated or deleted by a revision or an undo — version history is append-only"
    );

    // STEP 7: approve — must approve whatever is CURRENT (D), not A/B/C
    const approveRes = await handler(event("approve_content", { shop_id: "shop-1", content_item_id: "item-1", decision: "approved" }));
    assert.equal(approveRes.statusCode, 200, `approve failed: ${approveRes.body}`);
    assert.equal(JSON.parse(approveRes.body).item.status, "approved");
    // The style signal recorded on approval must trace back to D's own
    // real traits_used (marble countertop) — never A/B/C's.
    const styleUpsert = client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert"));
    assert.equal(styleUpsert.payload.preferences.background_style.traits[0].text, "marble countertop");
    // Brand Brain was never WRITTEN by the approval — D's brand_traits_used
    // was empty (a visual-only revision never carries writing-voice
    // traits), so approve_content must never call saveBrandBrain here even
    // though generate_content itself did read Brand Brain earlier (that's
    // the normal generation-time default-loading, unrelated to this check).
    assert.equal(client.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert")), undefined);
  } finally {
    mock.restore();
  }
});
