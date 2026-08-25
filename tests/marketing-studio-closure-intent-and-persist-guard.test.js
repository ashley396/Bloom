import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPersistIntent,
  requestSignalsTemporaryClosure,
  requestSignalsPermanentClosure,
  textReadsAsPermanentClosure,
  detectPermanentClosureMismatch,
  factsPreserved
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Two real live-beta defects (found via Ashley's actual authenticated
// Marketing Studio use, after the storage RLS fix let Generate succeed):
//
// 1. "Ask Lily to change something" produced "Tell me specifically what to
//    keep... so Lily can save it as your style" instead of a normal
//    revision. Root cause traced to two things: (a) the florist-facing UI
//    had no real revision composer at all — just a native prompt() dialog
//    (fixed in marketing-studio-shop-ui.js); (b) detectPersistIntent's own
//    regex was too narrow to recognize real persist phrases like "remember
//    this" and "always do this" (fixed below) — and, separately, was
//    already correctly narrow enough to NOT fire on ordinary revisions
//    like "make it clear we are only closing early today" (verified below,
//    not just assumed).
//
// 2. Lily turned "closing at 2:30 today" into "it's with a mix of sadness
//    and gratitude that we announce we will be closing today" — a
//    permanent going-out-of-business announcement, from a purely temporary
//    one. Fixed with a deterministic backstop (detectPermanentClosureMismatch)
//    that generate_content/revise_content now enforce, on top of a
//    strengthened prompt instruction — never trusting prompt wording alone
//    for a real safety property.

test("detectPersistIntent: ordinary one-time revisions never trigger My Style persistence", () => {
  for (const instruction of [
    "Make it shorter",
    "Make the flowers softer.",
    "Use less pink.",
    "Change the image.",
    "Make it more cheerful.",
    "Make it clear we are only closing early today.",
    "Make the phone number more noticeable."
  ]) {
    assert.equal(detectPersistIntent(instruction), false, `"${instruction}" must never be read as a persist-intent signal`);
  }
});

test("detectPersistIntent: real persistence phrases are recognized, including the two the old regex missed", () => {
  for (const instruction of [
    "Use this style from now on.",
    "Save this as my style.",
    "That's my style now.",
    "Keep this going forward.",
    "Remember this style.", // previously unmatched — the live gap
    "Always do this.", // previously unmatched — the live gap
    "From now on, make my posts like this." // previously unmatched — the live gap
  ]) {
    assert.equal(detectPersistIntent(instruction), true, `"${instruction}" must be recognized as real persist intent`);
  }
});

test("closure guard: 'closing at 2:30 today' is recognized as a temporary-closure signal, never a permanent one", () => {
  const request = "Create a Facebook post for the shop letting customers know we are closing at 2:30 today. If they need to place an order, call 606-506-4039.";
  assert.equal(requestSignalsTemporaryClosure(request), true);
  assert.equal(requestSignalsPermanentClosure(request), false);
});

test("closure guard: the real bad output ('sadness and gratitude... closing') is caught as a mismatch against a temporary request", () => {
  const request = "letting customers know we are closing at 2:30 today";
  const badOutput = "It's with a mix of sadness and gratitude that we announce we will be closing at 2:30 PM today. Thank you for years of support.";
  assert.equal(textReadsAsPermanentClosure(badOutput), true);
  assert.equal(detectPermanentClosureMismatch(request, badOutput), true);
});

test("closure guard: a genuinely temporary-appropriate output is NOT flagged", () => {
  const request = "letting customers know we are closing at 2:30 today";
  const goodOutput = "Heads up — we're closing early today at 2:30 PM! Need something before then? Call 606-506-4039 and we'll take care of you. Back to our normal hours tomorrow.";
  assert.equal(detectPermanentClosureMismatch(request, goodOutput), false);
});

test("closure guard: an explicit, real permanent-closing request is never blocked, even with farewell language", () => {
  const request = "We are closing permanently after 20 wonderful years — write a heartfelt farewell post.";
  const output = "It is with a heavy heart that we announce our last day in business will be Friday. Thank you to this incredible community.";
  assert.equal(requestSignalsPermanentClosure(request), true);
  assert.equal(detectPermanentClosureMismatch(request, output), false, "an explicit permanent request must never be blocked by the guard");
});

test("closure guard: an ordinary aesthetic request is never flagged just because the word 'closing' isn't involved at all", () => {
  assert.equal(detectPermanentClosureMismatch("make it more cheerful", "Bright spring colors to brighten your day!"), false);
});

test("facts preservation: the exact time and phone number from the real scenario survive a revision", () => {
  const original = "We're closing at 2:30 PM today — call 606-506-4039 to place an order before then!";
  const revisedGood = "Closing early today at 2:30 PM — call 606-506-4039 now to get your order in!";
  const revisedBad = "Closing early today — call us to get your order in!"; // dropped both facts
  assert.equal(factsPreserved(original, revisedGood), true);
  assert.equal(factsPreserved(original, revisedBad), false);
});

// ── Handler-level: the real generate_content/revise_content dispatch via
// deps.florist (the actual florist-reachable path), proving the guard is
// really wired in, not just correct in isolation.

function floristDeps(client) {
  return { florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function mockCloudflareCopyOnce(copyJson) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(copyJson) } }) });
  return { restore: () => { globalThis.fetch = originalFetch; } };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  delete process.env.FLORISYN_FLAG_MARKETING_STUDIO;
});
test.after(() => {
  process.env = { ...savedEnv };
});

test("generate_content (real dispatch): a temporary-closing brief that comes back reading permanent is rejected (400) and the item is reverted to idea — nothing bad is ever saved", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "A bittersweet announcement",
    body: "It's with a mix of sadness and gratitude that we announce we will be closing at 2:30 PM today. Thank you for years of support.",
    cta: "Call 606-506-4039",
    visual_brief: "A quiet, sentimental florist storefront at dusk.",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "Create a Facebook post letting customers know we are closing at 2:30 today. Call 606-506-4039 to order.", status: "idea" }, error: null }, // currentItem
      { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
      { data: { marketing_monthly_budget_cents: null }, error: null }, // budget
      { data: null, error: null }, // -> generating
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: [], error: null }, // loadGroundedInventory
      { data: [], error: null }, // audience customers
      { data: [], error: null }, // audience orders
      { data: null, error: null }, // recordUsage("copy")
      { data: null, error: null } // revertToIdea's own update
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 400, `expected the mismatch to be rejected: ${res.body}`);
    assert.match(JSON.parse(res.body).error, /permanent closing/i);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.equal(assetInsert, undefined, "no asset must ever be persisted for a rejected generation");
    const revertCall = client.calls.find(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "idea")
    );
    assert.ok(revertCall, "the item must be reverted back to idea");
  } finally {
    mock.restore();
  }
});

test("generate_content (real dispatch): a genuinely good temporary-closing post is generated normally, and the exact time/phone number survive", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "Closing early today!",
    body: "Heads up — we're closing at 2:30 PM today. Need something before then? Call 606-506-4039 and we'll help you out. Back to normal hours tomorrow!",
    cta: "Call 606-506-4039",
    visual_brief: "A bright, professional shot of the shop's fresh flower display.",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "Create a Facebook post letting customers know we are closing at 2:30 today. Call 606-506-4039 to order.", status: "idea" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: null, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null } // final content_items update
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `a legitimate temporary-closing post must not be blocked: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.match(body.copy.body, /2:30 PM/);
    assert.match(body.copy.body, /606-506-4039/);
  } finally {
    mock.restore();
  }
});

test("revise_content (real dispatch): an ordinary instruction ('make it clear we are only closing early today') revises without writing My Style", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "Closing early today",
    body: "Just a reminder — we're closing early today at 2:30 PM! Call 606-506-4039 if you still need to place an order. Open as usual tomorrow.",
    cta: "Call now",
    hashtags: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "closing at 2:30 today, call 606-506-4039", status: "draft" }, error: null }, // currentItem
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null }, // variants
      { data: { id: "asset-1", asset_type: "social_copy", content: { body: "We're closing at 2:30 PM today — call 606-506-4039 to place an order before then!" } }, error: null }, // current asset
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "new-asset-1" }, error: null }, // persistGeneratedAsset
      { data: null, error: null }, // variant repoint update
      { data: null, error: null } // writeCommandAudit (goes through the real service-role fallback; unused here)
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("revise_content", { content_item_id: "item-1", instruction: "Make it clear we are only closing early today" }));
    assert.equal(res.statusCode, 200, `expected an ordinary revision to succeed: ${res.body}`);
    const styleWrite = client.calls.find(
      (c) => c.table && c.table.includes("style") && c.ops.some((op) => ["insert", "update", "upsert"].includes(op[0]))
    );
    assert.equal(styleWrite, undefined, "an ordinary revision must never WRITE to any style-memory table (a read, e.g. loadStyleMemory's own lookup, is fine)");
    const newAssetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert" && op[1][0]?.parent_asset_id === "asset-1"));
    assert.ok(newAssetInsert, "a real revision must create a NEW child asset pointing at the parent — never an in-place edit");
  } finally {
    mock.restore();
  }
});

test("revise_content (real dispatch): 'Use this style from now on' DOES persist — writes the current asset's own revision traits to My Style", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "draft" }, error: null }, // currentItem
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null }, // variants
    {
      data: { id: "asset-1", asset_type: "image", content: { revision_traits: [{ category: "colors", text: "pink", polarity: "negative" }] } },
      error: null
    }, // current asset — has traits from an earlier "less pink" revision
    { data: { preferences: {} }, error: null }, // loadStyleMemory
    { data: null, error: null } // saveStyleMemory upsert
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("revise_content", { content_item_id: "item-1", instruction: "I love this, use this style from now on" }));
  assert.equal(res.statusCode, 200, `expected persistence to succeed: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.equal(body.persisted, true);
  const styleUpsert = client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert"));
  assert.ok(styleUpsert, "an explicit persist-intent instruction must actually write to ai_style_memory");
});

test("revise_content (real dispatch): 'Remember this style' DOES persist — proves the regex fix works end to end, not just in isolation", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "draft" }, error: null },
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
    {
      data: { id: "asset-1", asset_type: "image", content: { revision_traits: [{ category: "mood", text: "elegant", polarity: "positive" }] } },
      error: null
    },
    { data: { preferences: {} }, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("revise_content", { content_item_id: "item-1", instruction: "Remember this style" }));
  assert.equal(res.statusCode, 200, `expected persistence to succeed: ${res.body}`);
  assert.equal(JSON.parse(res.body).persisted, true);
  const styleUpsert = client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert"));
  assert.ok(styleUpsert, "'Remember this style' must actually write to ai_style_memory, matching the task's required behavior");
});

test("revise_content (real dispatch): a wording revision that comes back reading as a permanent closure is rejected too, not just first-time generation", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "Farewell",
    body: "With heavy hearts, we announce we are shutting down. Thank you for your years of support.",
    cta: "",
    hashtags: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "closing at 2:30 today, call 606-506-4039", status: "draft" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "asset-1" }], error: null },
      { data: { id: "asset-1", asset_type: "social_copy", content: { body: "We're closing at 2:30 PM today — call 606-506-4039!" } }, error: null },
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null } // loadStyleMemory
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("revise_content", { content_item_id: "item-1", instruction: "Make it more heartfelt" }));
    assert.equal(res.statusCode, 400, `expected the mismatch to be rejected: ${res.body}`);
    const newAssetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.equal(newAssetInsert, undefined, "a rejected revision must never persist a new asset");
  } finally {
    mock.restore();
  }
});
