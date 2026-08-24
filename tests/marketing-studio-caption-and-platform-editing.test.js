import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Priority 7 ("as far as technically possible" pass): the two disclosed
// UI gaps — caption editing during review, and add/remove target
// platforms before approval/scheduling.

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

// ── update_variant_caption ──────────────────────────────────────────────

test("update_variant_caption: persists a real edited caption, scoped to the requesting shop", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "variant-1", status: "pending", platform: "facebook" }, error: null }, // current variant lookup
    { data: { id: "variant-1", platform: "facebook", caption: "New caption text", hashtags: ["#wedding"], status: "pending" }, error: null } // update
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_variant_caption", { shop_id: "shop-1", platform_variant_id: "variant-1", caption: "New caption text", hashtags: ["#wedding"] }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.variant.caption, "New caption text");

  const lookupCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "select"));
  const shopEq = lookupCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.equal(shopEq[1][1], "shop-1");
  const updateCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.caption, "New caption text");
});

test("update_variant_caption: rejects an empty caption rather than persisting a blank post", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_variant_caption", { shop_id: "shop-1", platform_variant_id: "variant-1", caption: "   " }));
  assert.equal(res.statusCode, 400);
});

test("update_variant_caption: never silently modifies an already-published variant", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "variant-1", status: "published", platform: "facebook" }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_variant_caption", { shop_id: "shop-1", platform_variant_id: "variant-1", caption: "Trying to sneak an edit in" }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /published/i);
  const updateCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall, undefined, "no update should ever be attempted against a published variant");
});

test("update_variant_caption: a variant actively 'publishing' is also protected — the race window itself is closed, not just the final state", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "variant-1", status: "publishing", platform: "instagram" }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_variant_caption", { shop_id: "shop-1", platform_variant_id: "variant-1", caption: "edit" }));
  assert.equal(res.statusCode, 400);
});

test("update_variant_caption: a variant belonging to a different shop is reported as not found, never edited", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_variant_caption", { shop_id: "shop-1", platform_variant_id: "someone-elses-variant", caption: "edit" }));
  assert.equal(res.statusCode, 404);
});

// ── add_content_platform ────────────────────────────────────────────────

test("add_content_platform: copies caption/asset/AI-usage facts from an existing sibling variant and recomputes disclosure for the NEW platform", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null }, // content item lookup
    {
      data: [
        {
          id: "variant-fb",
          platform: "facebook",
          status: "ready",
          scheduled_at: null,
          asset_id: "asset-1",
          caption: "Order your wedding bouquet today",
          hashtags: ["#wedding"],
          ai_content_type: "generative_image",
          avatar_used: false,
          voice_used: false,
          generative_video_used: false,
          generative_image_used: true,
          human_edited: false
        }
      ],
      error: null
    }, // existing variants
    { data: { id: "variant-ig", platform: "instagram", caption: "Order your wedding bouquet today", hashtags: ["#wedding"], status: "pending", ai_disclosure_required: true }, error: null } // insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("add_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "instagram" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.variant.platform, "instagram");
  assert.equal(body.copiedFromExisting, true);

  const insertCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insertCall.payload.shop_id, "shop-1");
  assert.equal(insertCall.payload.caption, "Order your wedding bouquet today", "must copy the real existing caption, never invent one");
  assert.equal(insertCall.payload.asset_id, "asset-1");
  assert.equal(insertCall.payload.generative_image_used, true, "the real AI-usage fact must be preserved, not reset to false");
  assert.equal(typeof insertCall.payload.ai_disclosure_required, "boolean", "disclosure must be recomputed for the new platform, not left at a DB default");
});

test("add_content_platform: with no existing content to copy from, the new variant starts with no caption and no disclosure requirement — never fabricated", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "idea" }, error: null },
    { data: [], error: null }, // no existing variants at all
    { data: { id: "variant-fb", platform: "facebook", caption: null, hashtags: [], status: "pending", ai_disclosure_required: false }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("add_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "facebook" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.copiedFromExisting, false);
  const insertCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insertCall.payload.caption, null);
  assert.equal(insertCall.payload.ai_disclosure_required, false, "nothing AI-generated exists yet, so disclosure is honestly not required");
});

test("add_content_platform: refuses a platform that's already a target for this content item", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ id: "v-1", platform: "facebook", status: "pending", scheduled_at: null }], error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("add_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "facebook" }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /already a target platform/);
});

test("add_content_platform: refuses once the content item is approved — the platform set is locked", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "item-1", status: "approved" }, error: null }, { data: [{ id: "v-1", platform: "facebook", status: "ready", scheduled_at: null }], error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("add_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "instagram" }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /locked/i);
});

test("add_content_platform: a concurrent duplicate insert (DB unique-constraint race) is reported as the same friendly 400, not a raw 500", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ id: "v-1", platform: "facebook", status: "pending", scheduled_at: null }], error: null }, // this call's own read sees no instagram row yet...
    { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } } // ...but a concurrent request won the race
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("add_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "instagram" }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /already a target platform/);
});

test("add_content_platform: refuses once ANY variant already has a real schedule — 'before approval/scheduling' means either boundary, not just approval", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null }, // status itself is still pre-approval...
    { data: [{ id: "v-1", platform: "facebook", status: "scheduled", scheduled_at: "2026-09-01T18:00:00.000Z" }], error: null } // ...but this platform is already scheduled
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("add_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "instagram" }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /locked/i);
});

test("add_content_platform: rejects an unsupported platform name", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("add_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "myspace" }));
  assert.equal(res.statusCode, 400);
});

// ── remove_content_platform ─────────────────────────────────────────────

test("remove_content_platform: removes a real pre-approval platform variant, scoped to the requesting shop", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null },
    {
      data: [
        { id: "v-fb", platform: "facebook", status: "pending", scheduled_at: null },
        { id: "v-ig", platform: "instagram", status: "pending", scheduled_at: null }
      ],
      error: null
    },
    { data: { id: "v-ig" }, error: null } // delete
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("remove_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "instagram" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body.remainingPlatforms, ["facebook"]);

  const deleteCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "delete"));
  const shopEq = deleteCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.equal(shopEq[1][1], "shop-1");
});

test("remove_content_platform: refuses to remove the last remaining platform", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "item-1", status: "draft" }, error: null }, { data: [{ id: "v-fb", platform: "facebook", status: "pending", scheduled_at: null }], error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("remove_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "facebook" }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /last remaining platform/);
});

test("remove_content_platform: 404s on a platform that isn't actually a target of this content item", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "item-1", status: "draft" }, error: null }, { data: [{ id: "v-fb", platform: "facebook", status: "pending", scheduled_at: null }], error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("remove_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "tiktok" }));
  assert.equal(res.statusCode, 404);
});

test("remove_content_platform: refuses once the content item is scheduled — platform selection is locked", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "item-1", status: "scheduled" }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("remove_content_platform", { shop_id: "shop-1", content_item_id: "item-1", platform: "facebook" }));
  assert.equal(res.statusCode, 400);
});
