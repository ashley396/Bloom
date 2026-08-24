import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

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
        { data: { id: "asset-2" }, error: null }, // website_media insert
        { data: { id: "asset-2", parent_asset_id: "asset-1", content: { url: "https://fake.storage/website-media/new.jpg", caption: "Order your fall bouquet today!" } }, error: null }, // ai_generated_assets insert
        { data: null, error: null }, // variant update
        { data: null, error: null } // audit insert
      ],
      { storage }
    );
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("revise_content", { shop_id: "shop-1", content_item_id: "item-1", instruction: "use a luxury flower shop background instead" }));
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
  const mock = mockImageGen();
  try {
    const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
    const client = createFakeSupabaseClient(
      [
        superAdminRow(),
        { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
        { data: IMAGE_ASSET, error: null },
        { data: { name: "Test Florals" }, error: null },
        { data: { id: "media-1" }, error: null },
        { data: { id: "asset-2", parent_asset_id: "asset-1", content: { url: "https://fake.storage/website-media/new.jpg", caption: "Order your fall bouquet today!" } }, error: null },
        { data: null, error: null },
        { data: null, error: null }
      ],
      { storage }
    );
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
  const mock = mockImageGen();
  try {
    const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
    const client = createFakeSupabaseClient(
      [
        superAdminRow(),
        { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "draft" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
        { data: IMAGE_ASSET, error: null },
        { data: { name: "Real Tenant Florals" }, error: null },
        { data: { id: "media-1" }, error: null },
        { data: { id: "asset-2", parent_asset_id: "asset-1", content: {} }, error: null },
        { data: null, error: null },
        { data: null, error: null }
      ],
      { storage }
    );
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
