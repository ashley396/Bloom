import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

/**
 * Batch 3, Part D/E/F — fail-closed approval. approve_content must refuse
 * when any required current state (variant, asset, render, storage) can't
 * be verified — "unreadable state is not valid state." Server remains the
 * sole authority; never UI-only blocking.
 */

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

const VALID_FLYER_CONTENT = {
  url: "https://fake.storage/website-media/shop-1/flyers/flyer-asset-1.png",
  storage_path: "shop-1/flyers/flyer-asset-1.png",
  mime: "image/png",
  render_status: "rendered"
};

function storageFindingFile(filename = "flyer-asset-1.png") {
  return createFakeSupabaseStorage({ listResponses: [{ data: [{ name: filename }], error: null }] });
}

// APPROVAL 12
test("APPROVAL 12: a variant query error blocks approval — never silently treated as 'no variants'", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null }, // current item
    { data: null, error: { message: "connection reset" } } // reviewVariantAssets query fails
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 502, `an unreadable variant state must block approval with a retryable error: ${res.body}`);
  const statusUpdate = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.equal(statusUpdate, undefined, "the item must never be approved while its current variants can't even be read");
});

// APPROVAL 14
test("APPROVAL 14: an asset query error blocks approval", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-1" }], error: null }, // reviewVariantAssets: a real reference exists
    { data: null, error: { message: "connection reset" } } // ai_generated_assets query fails
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 502, `an unreadable asset state must block approval: ${res.body}`);
  const statusUpdate = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.equal(statusUpdate, undefined);
});

// APPROVAL 13/15/23: a variant references a real asset_id, but that asset
// cannot be found (deleted, cross-shop, or a genuine data gap) — the exact
// same fixture shape covers all three framings: "missing required current
// variant" in the sense that its linked asset is gone, "missing required
// current asset," and "wrong/outdated asset does not satisfy the current
// asset requirement" (a stale/foreign id is indistinguishable from "not
// found" once the read is correctly shop-scoped).
test("APPROVAL 13/15/23: a variant's referenced asset can't be found — blocks approval rather than silently skipping validation", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-DELETED" }], error: null }, // references a real id
    { data: [], error: null } // ...but the asset lookup (shop-scoped) finds nothing — deleted, or belongs to another shop
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 409, `a referenced-but-missing asset must block approval: ${res.body}`);
  assert.match(JSON.parse(res.body).error, /couldn't be found/i);
  const statusUpdate = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.equal(statusUpdate, undefined);
});

// APPROVAL 16
test("APPROVAL 16: a missing final flyer PNG (no url/render_status at all) blocks approval", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-1" }], error: null },
    { data: [{ id: "flyer-asset-1", asset_type: "flyer", status: "completed", content: { headline: "h" } }], error: null } // no render fields at all
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /hasn't finished rendering/i);
});

// APPROVAL 17
test("APPROVAL 17: incomplete render metadata (missing storage_path) blocks approval even with a real-looking url and render_status", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-1" }], error: null },
    {
      data: [
        {
          id: "flyer-asset-1",
          asset_type: "flyer",
          status: "completed",
          content: { headline: "h", url: VALID_FLYER_CONTENT.url, render_status: "rendered", mime: "image/png" } // storage_path missing
        }
      ],
      error: null
    }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /hasn't finished rendering/i);
});

// APPROVAL 18
test("APPROVAL 18: a quarantined asset (the REAL status field, not the unused content.quarantined placeholder) blocks approval", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-1" }], error: null },
    { data: [{ id: "flyer-asset-1", asset_type: "flyer", status: "quarantined", content: { ...VALID_FLYER_CONTENT } }], error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 409, `a quarantined asset must never be approvable: ${res.body}`);
  assert.match(JSON.parse(res.body).error, /flagged/i);
});

test("APPROVAL 18b: rejecting a quarantined asset is never blocked — the gate only applies to approval", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-1" }], error: null },
    { data: [{ id: "flyer-asset-1", asset_type: "flyer", status: "quarantined", content: { ...VALID_FLYER_CONTENT } }], error: null },
    { data: { id: "item-1", status: "archived" }, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "rejected" }));
  assert.equal(res.statusCode, 200, `rejecting a quarantined asset must still work: ${res.body}`);
});

// APPROVAL 19
test("APPROVAL 19: a flyer whose DB row looks fully finalized but whose stored object was actually deleted blocks approval", async () => {
  const storage = createFakeSupabaseStorage({ listResponses: [{ data: [], error: null }] }); // the file genuinely isn't there
  const client = createFakeSupabaseClient(
    [
      { data: { id: "item-1", status: "draft" }, error: null },
      { data: [{ asset_id: "flyer-asset-1" }], error: null },
      { data: [{ id: "flyer-asset-1", asset_type: "flyer", status: "completed", content: { ...VALID_FLYER_CONTENT } }], error: null }
    ],
    { storage }
  );
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 409, `a deleted/missing storage object must block approval even though the DB row claims it's rendered: ${res.body}`);
  assert.match(JSON.parse(res.body).error, /stored file couldn't be found/i);
  const statusUpdate = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.equal(statusUpdate, undefined);
});

// APPROVAL 20
test("APPROVAL 20: a temporary storage verification failure (a real error, not 'not found') blocks approval with a retryable error, not a hard rejection", async () => {
  const storage = createFakeSupabaseStorage({ listResponses: [{ data: null, error: { message: "storage temporarily unavailable" } }] });
  const client = createFakeSupabaseClient(
    [
      { data: { id: "item-1", status: "draft" }, error: null },
      { data: [{ asset_id: "flyer-asset-1" }], error: null },
      { data: [{ id: "flyer-asset-1", asset_type: "flyer", status: "completed", content: { ...VALID_FLYER_CONTENT } }], error: null }
    ],
    { storage }
  );
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 502, `a storage error must never be treated as 'verified' — fails closed with a retryable status: ${res.body}`);
  assert.match(JSON.parse(res.body).error, /couldn't verify/i);
});

test("APPROVAL 20b: a storage client that isn't configured at all (unavailable) also fails closed, never treated as verified", async () => {
  // No {storage} option at all — the fake client's default storage getter
  // throws, exactly like a real misconfigured environment would surface
  // as an exception rather than a clean {error}.
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-1" }], error: null },
    { data: [{ id: "flyer-asset-1", asset_type: "flyer", status: "completed", content: { ...VALID_FLYER_CONTENT } }], error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 502, `an unavailable storage client must fail closed, never silently pass: ${res.body}`);
});

// APPROVAL 21
test("APPROVAL 21: text-only content (social_copy) remains approvable without any flyer/image requirement", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "copy-asset-1" }], error: null },
    { data: [{ id: "copy-asset-1", asset_type: "social_copy", status: "completed", content: { body: "a real caption" } }], error: null },
    { data: { id: "item-1", status: "approved" }, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200, `text-only content must never be held to a flyer/image asset requirement: ${res.body}`);
});

test("APPROVAL 21b: a content item with genuinely zero variants (nothing to check) still approves cleanly — an empty variant list is a legitimate state, distinct from an unreadable one", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [], error: null }, // truly zero variants
    { data: { id: "item-1", status: "approved" }, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200);
  assert.equal(client.calls.find((c) => c.table === "ai_generated_assets"), undefined, "no asset_id was ever referenced, so no asset query should even run");
});

// APPROVAL 22
test("APPROVAL 22: a real, correctly-typed and fully finalized image asset passes approval", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "image-asset-1" }], error: null },
    { data: [{ id: "image-asset-1", asset_type: "image", status: "completed", content: { url: "https://fake.storage/website-media/shop-1/photo.jpg" } }], error: null },
    { data: { id: "item-1", status: "approved" }, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200, `a real, finished image post must approve cleanly: ${res.body}`);
});

test("APPROVAL 22b: an image asset with no real url yet is blocked, exactly like an unfinished flyer", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "image-asset-1" }], error: null },
    { data: [{ id: "image-asset-1", asset_type: "image", status: "completed", content: {} }], error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /hasn't finished/i);
});

// APPROVAL 24
test("APPROVAL 24: approval never silently treats an empty validation set as valid — an error-caused empty set blocks, a legitimately-empty one (21b) does not", async () => {
  // Contrast case: the asset lookup for a REAL reference returns an error
  // (not an empty array) — must never be conflated with "no assets to
  // check," which is only ever legitimate when there was no reference at
  // all (see APPROVAL 21b above).
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "asset-1" }], error: null }, // a real reference exists
    { data: null, error: { message: "read replica lagging" } } // the lookup itself failed — not "found nothing"
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 502, "an error must never be treated the same as a legitimately empty result");
  const statusUpdate = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.equal(statusUpdate, undefined);
});

// Full-lifecycle sanity, reusing the shared storageFindingFile() helper —
// proves the happy path through every new gate at once.
test("APPROVAL (happy path): a fully finalized, unquarantined flyer whose storage object genuinely exists approves cleanly", async () => {
  const client = createFakeSupabaseClient(
    [
      { data: { id: "item-1", status: "draft" }, error: null },
      { data: [{ asset_id: "flyer-asset-1" }], error: null },
      { data: [{ id: "flyer-asset-1", asset_type: "flyer", status: "completed", content: { ...VALID_FLYER_CONTENT } }], error: null },
      { data: { id: "item-1", status: "approved" }, error: null }
    ],
    { storage: storageFindingFile() }
  );
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200, `expected a real, complete flyer to approve cleanly: ${res.body}`);
});
