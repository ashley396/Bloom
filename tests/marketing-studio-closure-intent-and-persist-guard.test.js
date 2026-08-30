import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  detectPersistIntent,
  requestSignalsTemporaryClosure,
  requestSignalsPermanentClosure,
  textReadsAsPermanentClosure,
  detectPermanentClosureMismatch,
  requestSignalsPlainOperationalNotice,
  textAddsInventedEmbellishment,
  detectInventedOperationalContent,
  buildDeterministicNoticeContent,
  requestNeedsFlyerWording,
  detectWeakMarketingCopy,
  findHollowSentences,
  detectSympathyProductHeadline,
  detectSympathyProductOpening,
  isPlaceholderPhoneNumber,
  detectPlaceholderContactNumbers,
  stripFabricatedContactNumbers,
  detectFabricatedContactNumbers,
  extractShopNameFromRequestText,
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
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(copyJson) } }) };
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  delete process.env.FLORISYN_FLAG_MARKETING_STUDIO;
});
test.after(() => {
  process.env = { ...savedEnv };
});

test("generate_content (real dispatch): a temporary-closing brief that comes back reading permanent is caught, replaced with the safe deterministic fallback, and completes as a real draft — never left stuck as an unfinished idea", async () => {
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
      { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset — the mismatch recovered, generation completes
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null } // final content_items update -> draft
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected the mismatch to recover into a completed draft, not a 400/500: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.item.status, "draft");
    assert.doesNotMatch(body.copy.body.toLowerCase(), /sadness|gratitude|years of support/, "the invented permanent-closure language must never survive into the saved content");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.ok(assetInsert, "a real asset must be persisted — the mismatch recovers into a real draft");
    const revertCall = client.calls.find(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "idea")
    );
    assert.equal(revertCall, undefined, "the item must NEVER be reverted to idea when a safe fallback is available");
  } finally {
    mock.restore();
  }
});

// Architecture fix (Ashley's second real branch-deploy test): a "safe"
// (non-invented) AI paraphrase of a plain operational notice still
// silently dropped the actual closing time — a paraphrase that drops a
// fact isn't "invented," so the old reactive guards never caught it. The
// real fix is proactive, not reactive: a plain operational notice with
// extractable facts never reaches the AI wording call at all — the ONE
// authoritative deterministic object is used directly. This test proves
// exactly that: the mocked AI response is deliberately supplied to prove
// it's never even called, not just that its (this time honest) content
// happens to survive.
test("generate_content (real dispatch): a plain temporary-closing post never calls the AI wording model at all — the authoritative deterministic content is used directly, and the exact time/phone number survive", async () => {
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
      { data: null, error: null }, // recordUsage("copy") — the deterministic path still records real usage
      { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null } // final content_items update
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `a legitimate temporary-closing post must not be blocked: ${res.body}`);
    const body = JSON.parse(res.body);
    // The real facts survive — but as the deterministic content's own
    // phrasing ("2:30", not the AI mock's reformatted "2:30 PM"), proving
    // this is genuinely the authoritative object, not a lucky match
    // against whatever the (unused) AI mock happened to return.
    assert.match(body.copy.body, /2:30/);
    assert.match(body.copy.body, /606-506-4039/);
    assert.doesNotMatch(body.copy.body, /2:30 PM/, "must be the deterministic content's own wording, never the AI mock's");
    assert.doesNotMatch(body.copy.body, /back to normal hours tomorrow/i, "must never contain the AI mock's own added phrasing");
    // The mocked AI text-generation endpoint must never have been called
    // at all — the deterministic content is used proactively, not as a
    // reactive check-then-fallback after an AI call that happened anyway.
    assert.equal(mock.calls.length, 0, "the AI wording model must never be called for a plain operational notice with extractable facts");
  } finally {
    mock.restore();
  }
});

// Security correction (Ashley, before the live visual test): an earlier
// fix for the shop-name-lost-to-"We" defect recovered the missing name
// from the REQUEST TEXT when the shops-table lookup came back empty.
// That was wrong — the request text is untrusted, and could name another
// business entirely. The real fix is upstream: when the trusted shop
// lookup can't be verified, generate_content must fail closed (a
// recoverable error, no content generated, the item reverted) rather
// than falling back to anything untrusted. These tests lock that in.
test("generate_content (real dispatch): if the shops-table lookup comes back with no row at all, the request fails closed — no content generated, no AI call, item reverted to idea, never falls back to request text or 'We'", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "unused",
    body: "unused — must never be called",
    cta: "unused",
    hashtags: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      {
        data: { id: "item-1", content_type: "text_post", title: "t", brief: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.", status: "idea" },
        error: null
      },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: null, error: null }, // -> generating
      { data: null, error: null }, // shopRow — no matching row (the real failure mode)
      { data: null, error: null } // -> revertToIdea's own update call
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 502, `an unverifiable shop lookup must fail closed with a recoverable error, never a fabricated 200: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.ok(body.error, "must return a real, recoverable error message");
    assert.equal(mock.calls.length, 0, "no AI call — the request never reaches content generation at all");

    const revertCall = client.calls.find(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "idea")
    );
    assert.ok(revertCall, "the item must be reverted to idea, never left stuck in 'generating' or silently completed");

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets");
    assert.equal(assetInsert, undefined, "nothing must ever be persisted from an unverified-shop request");
  } finally {
    mock.restore();
  }
});

// Tenant-isolation / anti-spoofing test (Ashley, explicit requirement):
// the request text names a DIFFERENT real business than the authenticated
// shop. The finished content must use the authenticated shop's own real
// name — never the name the untrusted request text happens to mention.
test("generate_content (real dispatch): a request that names a different florist by name still produces content branded with the AUTHENTICATED shop's real name — the request text is never trusted for branding", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "unused",
    body: "unused — must never be called",
    cta: "unused",
    hashtags: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    // The authenticated session is for "Lilies in Bloom" (floristDeps'
    // real shop), but the florist's own message names a totally different
    // business — "Rose City Florals is closing at 2:30 today." A confused
    // florist copy-pasting a competitor's post, or a deliberate spoofing
    // attempt, must land the same way: the AUTHENTICATED shop's name wins.
    const spoofingBrief = "Rose City Florals is closing at 2:30 today. Customers can call 606-506-4039 to place an order.";
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: spoofingBrief, status: "idea" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: null, error: null }, // -> generating
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null }, // shopRow — the REAL authenticated shop
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
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
    assert.equal(res.statusCode, 200, `must still complete successfully — this is not an error case, just untrusted text to ignore for branding: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.item.status, "draft");
    assert.match(body.copy.body, /^Lilies in Bloom is closing at 2:30 today\./, "the AUTHENTICATED shop's real name must be used");
    assert.doesNotMatch(body.copy.body, /Rose City Florals/, "the untrusted request-text name must NEVER become the branding authority");
    assert.equal(mock.calls.length, 0, "still the deterministic path — no AI call");
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

// A THIRD real live-beta defect (Ashley's own real branch-deploy test,
// 2026-08-26): "closing at 2:30, call to order" — a plain operational
// notice — came back with invented wording never asked for ("Place your
// final orders now," "Prepare for a special event," "We look forward to
// serving you again soon"). None of that is permanent-closure language
// (the guard above wouldn't catch it) — a separate, deterministic
// backstop for a distinct failure mode: preserving meaning, not just
// avoiding one specific bad framing.

test("invented-embellishment guard: a plain operational notice is recognized, a sale/event request is not (festive/urgent language is legitimate there)", () => {
  assert.equal(requestSignalsPlainOperationalNotice("closing at 2:30 today, call 606-506-4039 to order"), true);
  assert.equal(requestSignalsPlainOperationalNotice("new hours starting Monday"), true);
  assert.equal(requestSignalsPlainOperationalNotice("order by Thursday for Mother's Day delivery"), true);
  assert.equal(requestSignalsPlainOperationalNotice("20% off sale this weekend"), false, "a real sale invites urgency — not this guard's job");
  assert.equal(requestSignalsPlainOperationalNotice("join us for our anniversary event"), false, "a real event invites festive language — not this guard's job");
  assert.equal(requestSignalsPlainOperationalNotice("post about our fresh roses"), false, "no operational signal at all");
});

test("invented-embellishment guard: the real invented phrases from the live defect are all caught", () => {
  for (const phrase of [
    "Place your final orders now",
    "final orders",
    "Prepare for a special event",
    "get ready for something wonderful",
    "We look forward to serving you again soon",
    "see you again soon",
    "We appreciate your understanding",
    "Thank you for your patience",
    "coming soon",
    "last chance"
  ]) {
    assert.equal(textAddsInventedEmbellishment(phrase), true, `"${phrase}" must be recognized as invented embellishment`);
  }
});

test("invented-embellishment guard: an honest, plain temporary-closing message is never flagged", () => {
  const goodOutput = "Closing early today at 2:30 PM. Need to place an order? Call 606-506-4039.";
  assert.equal(textAddsInventedEmbellishment(goodOutput), false);
  assert.equal(detectInventedOperationalContent("closing at 2:30 today, call 606-506-4039", goodOutput), false);
});

test("invented-embellishment guard: the exact live failure is caught end to end", () => {
  const request = "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.";
  const badOutput =
    "We're closing at 2:30 today. Place your final orders now! Prepare for a special event — we look forward to serving you again soon. Call 606-506-4039.";
  assert.equal(detectInventedOperationalContent(request, badOutput), true);
});

test("invented-embellishment guard: never fires on a request that already invites that language (a real sale/event)", () => {
  const request = "We're having a 20% off sale this weekend — join us!";
  const output = "Don't miss out — last chance for 20% off this weekend! We look forward to seeing you soon.";
  assert.equal(detectInventedOperationalContent(request, output), false, "a real sale/event request legitimately invites urgency/festive language");
});

// A FOURTH real live-beta defect (Ashley's own real branch-deploy test,
// re-tested after the invented-embellishment guard shipped): the guard
// correctly rejected the bad wording, but the item was simply reverted to
// "idea" — the florist saw an unfinished draft and had to click again.
// buildDeterministicNoticeContent is the no-AI, safe-by-construction
// fallback that makes the guard's rejection invisible to the florist: one
// message still produces one finished draft.

test("buildDeterministicNoticeContent: the exact required fallback for Ashley's real test sentence", () => {
  const result = buildDeterministicNoticeContent({
    requestText: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.",
    shopName: "Lilies in Bloom",
    shopPhone: null
  });
  assert.equal(result.headline, "Closing Early Today");
  assert.equal(result.body, "Lilies in Bloom is closing at 2:30 today.");
  assert.equal(result.cta, "Call 606-506-4039 to place an order.");
  assert.equal(result.caption, "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.");
});

// extractShopNameFromRequestText is real, tested infrastructure — but per
// Ashley's explicit security correction (before the live visual test), it
// is used ONLY for comparison/audit (marketing-studio.js logs a warning
// when the request names a different business than the authenticated
// shop) and NEVER as a source of truth for branding. The request text is
// untrusted: a florist's message could name another business — a
// competitor, an event venue, anyone — and that must never become the
// flyer's identity. See "Security correction" comments in
// marketing-content-revision.js and marketing-studio.js.
test("extractShopNameFromRequestText: recognizes a plain '<Name> is closing...' sentence subject (for comparison/audit only, never branding)", () => {
  assert.equal(
    extractShopNameFromRequestText("Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order."),
    "Lilies in Bloom"
  );
});

test("extractShopNameFromRequestText: handles an ampersand shop name and a leading unrelated sentence", () => {
  assert.equal(
    extractShopNameFromRequestText("Create today's Facebook post. Rose & Thorn Florals will be closing early today."),
    "Rose & Thorn Florals"
  );
});

test("extractShopNameFromRequestText: never invents a name out of a generic pronoun subject — 'We are closing' stays null", () => {
  assert.equal(extractShopNameFromRequestText("We are closing at 2:30 today. Customers can call 606-506-4039 to place an order."), null);
});

test("extractShopNameFromRequestText: no clear sentence-subject pattern at all returns null, never a wrong guess", () => {
  assert.equal(extractShopNameFromRequestText("closing early today, call to order"), null);
  assert.equal(extractShopNameFromRequestText(""), null);
});

test("buildDeterministicNoticeContent: NEVER uses the request text as a name source, even when the shopName param is empty — falls back to 'We', not to a name mentioned in the untrusted text", () => {
  const text = "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.";
  const result = buildDeterministicNoticeContent({ requestText: text, shopName: null, shopPhone: null });
  assert.equal(result.body, "We are closing at 2:30 today.", "must fall back to the generic pronoun, never a name pulled from untrusted request text");
  assert.doesNotMatch(result.body, /Lilies in Bloom/, "the request text must never become the branding authority");
});

test("buildDeterministicNoticeContent: even when the request text names a DIFFERENT business than the trusted shopName param, the trusted param wins completely", () => {
  const text = "Rose City Florals is closing at 2:30 today. Call 606-506-4039.";
  const result = buildDeterministicNoticeContent({ requestText: text, shopName: "Lilies in Bloom", shopPhone: null });
  assert.equal(result.body, "Lilies in Bloom is closing at 2:30 today.");
  assert.doesNotMatch(result.body, /Rose City Florals/, "the untrusted request-text name must never override the authenticated shop's name");
});

test("buildDeterministicNoticeContent: with no shopName param at all, still falls back to 'We' rather than throwing or trusting the text", () => {
  const result = buildDeterministicNoticeContent({ requestText: "We are closing at 2:30 today. Call 606-506-4039.", shopName: null, shopPhone: null });
  assert.equal(result.body, "We are closing at 2:30 today.");
});

test("buildDeterministicNoticeContent: never hardcodes a shop name, time, or phone number — a different shop/time/number produces genuinely different output", () => {
  const result = buildDeterministicNoticeContent({
    requestText: "Petal & Stem will be closing at 4:15 this afternoon. Reach us at 212-555-0199.",
    shopName: "Petal & Stem",
    shopPhone: null
  });
  assert.equal(result.body, "Petal & Stem is closing at 4:15 this afternoon.");
  assert.equal(result.cta, "Call 212-555-0199 to place an order.");
  assert.doesNotMatch(result.body, /Lilies in Bloom|2:30|606-506-4039/);
});

test("buildDeterministicNoticeContent: falls back to the shop's own real phone when the request doesn't repeat one", () => {
  const result = buildDeterministicNoticeContent({
    requestText: "We're closing early today.",
    shopName: "Test Florals",
    shopPhone: "555-000-1111"
  });
  assert.equal(result.cta, "Call 555-000-1111 to place an order.");
});

test("buildDeterministicNoticeContent: an hours-change notice gets its own honest category, not misread as a closing", () => {
  const result = buildDeterministicNoticeContent({ requestText: "We have new hours starting Monday at 9am.", shopName: "Test Florals" });
  assert.equal(result.headline, "New Store Hours");
  assert.doesNotMatch(result.body, /closing/i);
});

test("buildDeterministicNoticeContent: an order-deadline notice uses the real date given, never a placeholder", () => {
  const result = buildDeterministicNoticeContent({ requestText: "Order by March 5th for weekend delivery.", shopName: "Test Florals" });
  assert.equal(result.headline, "Order Deadline");
  assert.match(result.body, /march 5th/i);
});

test("buildDeterministicNoticeContent: never invents a reason, urgency, farewell, or future plan — none of the banned phrases appear anywhere in the output", () => {
  const result = buildDeterministicNoticeContent({
    requestText: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.",
    shopName: "Lilies in Bloom"
  });
  const all = `${result.headline} ${result.body} ${result.cta} ${result.caption}`;
  assert.equal(textAddsInventedEmbellishment(all), false, "the deterministic fallback itself must never trip its own invented-embellishment guard");
});

test("buildDeterministicNoticeContent: returns null (never a fabricated guess) when the request carries no operational facts or category at all", () => {
  const result = buildDeterministicNoticeContent({ requestText: "hello", shopName: "Test Florals" });
  assert.equal(result, null);
});

// Ashley's required regression-test list (second real branch-deploy
// report) — items 6-14: late opening, changed hours, order deadline
// (already covered above), the "no invented X" guarantees, and the
// permanent-closure/never-invented checks against the deterministic
// content's own output specifically (not just the AI-guard functions in
// isolation).

test("buildDeterministicNoticeContent (late-opening notice): the real opening time and phone survive, headline is honest, never read as permanent", () => {
  const result = buildDeterministicNoticeContent({
    requestText: "We will be opening late today at 10:00am due to weather. Call 555-123-4567.",
    shopName: "Test Florals"
  });
  assert.equal(result.headline, "Opening Late Today");
  assert.match(result.body, /10:00am/);
  assert.match(result.cta, /555-123-4567/);
  assert.equal(textReadsAsPermanentClosure(`${result.headline} ${result.body} ${result.cta}`), false);
  assert.equal(textAddsInventedEmbellishment(`${result.headline} ${result.body} ${result.cta}`), false);
});

test("buildDeterministicNoticeContent (changed-hours notice): the real new time and phone survive, never a generic non-answer", () => {
  const result = buildDeterministicNoticeContent({
    requestText: "Our business hours have changed this week — now open until 8:00pm. Call 555-123-4567.",
    shopName: "Test Florals"
  });
  assert.equal(result.headline, "New Store Hours");
  assert.match(result.body, /8:00pm/);
  assert.match(result.cta, /555-123-4567/);
});

test("buildDeterministicNoticeContent: a notice with NO phone number anywhere (request or shop record) never invents one", () => {
  const result = buildDeterministicNoticeContent({ requestText: "We're closing early today.", shopName: "Test Florals", shopPhone: null });
  assert.equal(result.cta, "Contact us for details.");
  assert.doesNotMatch(result.caption, /\d{3}[-.\s]\d{3}[-.\s]\d{4}/, "no phone-shaped number must appear anywhere if none was ever given");
});

test("buildDeterministicNoticeContent: a notice with NO business name anywhere never invents one", () => {
  const result = buildDeterministicNoticeContent({ requestText: "We're closing early today. Call 555-123-4567.", shopName: null, shopPhone: null });
  assert.match(result.body, /^We are closing/, "falls back to a generic, honest 'We' rather than inventing a shop name");
});

test("buildDeterministicNoticeContent: a notice with no stated reason never invents one — only the plain fact is stated", () => {
  const result = buildDeterministicNoticeContent({
    requestText: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.",
    shopName: "Lilies in Bloom"
  });
  for (const inventedReason of ["renovation", "holiday", "family", "emergency", "maintenance", "staff", "weather"]) {
    assert.doesNotMatch(result.body.toLowerCase(), new RegExp(inventedReason), `must never invent a reason like "${inventedReason}" the request never gave`);
  }
});

// Real, live-found failure (re-tested by Ashley after the guard shipped):
// the guard correctly rejected the invented wording, but the item was
// simply reverted to "idea" — a broken one-message experience, the exact
// bug this test now proves is fixed. The safety rejection must never save
// the invented copy, but it also must never leave the florist stuck.
test("generate_content (real dispatch): a plain closing notice that comes back with invented urgency/future-plans wording is caught, replaced with the SAFE deterministic fallback, and the draft completes automatically — never reverted to idea", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "Closing early today",
    body: "We're closing at 2:30 today. Place your final orders now! Prepare for a special event — we look forward to serving you again soon. Call 606-506-4039.",
    cta: "Call 606-506-4039",
    visual_brief: "A bright, professional shot of the shop's fresh flower display.",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.", status: "idea" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: null, error: null },
      { data: { name: "Lilies in Bloom" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset — the rejection recovered, generation completes normally
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null } // final content_items update -> draft, NEVER reverted to idea
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected the rejection to recover into a completed draft, not a 400: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.item.status, "draft", "the item must complete as a real draft — never left at/reverted to idea");
    // The exact, required safe wording — built from the request's own
    // verified facts, never the invented text the model returned.
    assert.equal(body.copy.headline, "Closing Early Today");
    assert.equal(body.copy.body, "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.");
    assert.equal(body.copy.cta, "Call 606-506-4039 to place an order.");
    for (const banned of ["final orders", "prepare for a special event", "look forward to serving you again"]) {
      assert.doesNotMatch(body.copy.body.toLowerCase(), new RegExp(banned), `the invented phrase "${banned}" must never survive into the saved content`);
    }
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.ok(assetInsert, "a real asset must be persisted — the safety rejection recovers, it doesn't abandon the draft");
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.body, "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.", "the invented copy must never reach the database — only the safe fallback");
    const revertCall = client.calls.find(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "idea")
    );
    assert.equal(revertCall, undefined, "the item must NEVER be reverted to idea when a safe fallback is available");
  } finally {
    mock.restore();
  }
});

test("generate_content (real dispatch): when NO operational facts exist to build a safe fallback from, the rejection still refuses outright rather than guessing — the one legitimate case where reverting to idea is correct", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "An update",
    body: "Place your final orders now! We appreciate your understanding.",
    cta: "",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      // A real plain-operational-notice signal ("hours") but no
      // extractable fact and no recognized specific category (not a
      // closing, not a recognized hours-change phrasing, not a deadline)
      // — buildDeterministicNoticeContent genuinely has nothing safe to
      // build from here, so the handler must fail closed rather than
      // guess, exactly like before this fix for every OTHER case.
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "Our store is opening this weekend.", status: "idea" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: null, error: null },
      // A real, verified shop (shops.name is NOT NULL in production — a
      // row with no name can't actually occur; that unverifiable-shop
      // case is covered separately, see the "fails closed" test above).
      // This test is specifically about the OTHER refusal case: a real,
      // verified shop, but no operational facts to build a safe fallback
      // from at all.
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: null }, // recordUsage("copy")
      { data: null, error: null } // revertToIdea's own update
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 400, `expected a genuine no-fallback-available case to still refuse: ${res.body}`);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.equal(assetInsert, undefined, "no asset must ever be persisted when there's no safe fallback to fall back to");
    const revertCall = client.calls.find(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "idea")
    );
    assert.ok(revertCall, "the item must be reverted back to idea in this one genuine no-facts case");
  } finally {
    mock.restore();
  }
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

// Regression test #9 (late-opening notice, end to end): proves the
// proactive determinism wiring isn't special-cased to "closing" — a
// genuinely different operational category reaches the same authoritative
// content path, no AI wording call, real draft, never idea.
test("generate_content (real dispatch): a late-opening notice never calls the AI wording model — the real opening time and phone survive into the saved draft", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "We're running behind!",
    body: "Sorry for the inconvenience — we'll be opening a bit later than usual. Call 555-123-4567 for questions.",
    cta: "Call us",
    hashtags: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "We will be opening late today at 10:00am due to weather. Call 555-123-4567.", status: "idea" }, error: null },
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
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected the late-opening notice to complete normally: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.item.status, "draft");
    assert.match(body.copy.headline, /Opening Late Today/);
    assert.match(body.copy.body, /10:00am/);
    assert.match(body.copy.body, /555-123-4567/);
    assert.equal(mock.calls.length, 0, "the AI wording model must never be called for a late-opening notice with extractable facts");
  } finally {
    mock.restore();
  }
});

// Regression test #18: normal, non-operational creative posts (no
// closing/opening/hours/deadline/announcement signal) must be completely
// unaffected by any of this — Lily still writes the caption normally, no
// determinism, no template, exactly as before this whole fix.
test("generate_content (real dispatch): an ordinary creative post ('40 roses to sell') is untouched by the operational-notice determinism — Lily's real AI copy is used as-is", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "Fresh Roses Just Arrived!",
    body: "We've got 40 gorgeous fresh roses ready for their forever vase — stop by today and treat yourself (or someone special) to a bouquet.",
    cta: "Shop now",
    hashtags: ["#freshflowers"],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "I have 40 roses I need to sell — a bright, romantic bouquet post for Facebook", status: "idea" }, error: null },
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
      { data: { id: "copy-asset-1" }, error: null },
      { data: null, error: null },
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected the ordinary creative post to succeed normally: ${res.body}`);
    const body = JSON.parse(res.body);
    // The real AI-authored copy is used verbatim — never replaced by any
    // deterministic template, proving the operational-notice fix left
    // ordinary creative marketing generation completely alone.
    assert.equal(body.copy.headline, "Fresh Roses Just Arrived!");
    assert.match(body.copy.body, /forever vase/);
    assert.equal(mock.calls.length, 1, "the AI wording model must still be called normally for an ordinary creative post");
  } finally {
    mock.restore();
  }
});

// Real, live-found data case (found by resolving the authenticated shop
// through the real server path before Ashley's live visual test): the
// shops row exists and reads back cleanly, but its `name` is an EMPTY
// STRING — the florist simply hasn't saved a shop name yet. The old code
// lumped this in with a genuine lookup failure and returned the same 502
// telling the florist to "Try Generate again in a moment" — advice that
// could never work, because nothing about retrying sets a shop name. UI
// wording has to match real backend state, so this is now its own
// actionable 409. The fail-CLOSED guarantee is unchanged: still no AI
// call, still nothing persisted, still reverted to idea.
test("generate_content (real dispatch): a shop row whose name is empty fails closed with an ACTIONABLE error (not a misleading 'try again'), generates nothing and persists nothing", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "unused",
    body: "unused — must never be called",
    cta: "unused",
    hashtags: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      {
        data: {
          id: "item-1",
          content_type: "text_post",
          title: "t",
          brief: "We are closing at 2:30 today. Call 555-123-4567 to place an order.",
          status: "idea"
        },
        error: null
      },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: null, error: null }, // -> generating
      // The real shape observed in the live database: a real row, real
      // brand colours, but no name saved.
      { data: { name: "", phone: "", primary_color: "#8f3f68", accent_color: "#6f8f72" }, error: null },
      { data: null, error: null } // -> revertToIdea's own update call
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));

    assert.equal(res.statusCode, 409, `an unset shop name is a permanent, fixable condition — not a retryable 502: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.match(body.error, /shop name/i, "the message must name the actual problem");
    assert.match(body.error, /settings/i, "the message must tell the florist where to fix it");
    assert.ok(
      !/try (generate )?again in a moment/i.test(body.error),
      "must not advise retrying — retrying can never set a shop name"
    );

    assert.equal(mock.calls.length, 0, "no AI call — the request never reaches content generation at all");
    const revertCall = client.calls.find(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "idea")
    );
    assert.ok(revertCall, "the item must be reverted to idea, never left stuck in 'generating'");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets");
    assert.equal(assetInsert, undefined, "nothing may be persisted when the shop's identity can't be established");
  } finally {
    mock.restore();
  }
});

// A whitespace-only name is the same defect wearing a different hat — it
// would render as an invisible "shop name" on a customer-facing flyer.
test("generate_content (real dispatch): a whitespace-only shop name is treated as no name at all, not silently drawn as blank branding", async () => {
  const mock = mockCloudflareCopyOnce({
    platform: "facebook",
    headline: "unused",
    body: "unused",
    cta: "unused",
    hashtags: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      {
        data: { id: "item-1", content_type: "text_post", title: "t", brief: "We are closing at 2:30 today.", status: "idea" },
        error: null
      },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: null, error: null },
      { data: { name: "   ", phone: "555-123-4567" }, error: null },
      { data: null, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 409, `a whitespace-only name must fail closed too: ${res.body}`);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// What counts as a request for a DESIGNED piece.
//
// Ashley asked Marketing Studio, live: "Crate me a facebook post to generate
// more funeral work." It came back as a bare AI photograph — no shop name, no
// message, no phone number, nothing drawn on it at all. The gate deciding
// designed-poster versus plain-photo only fired on operational words
// (closing, hours, sale, deadline) or a hard fact like a time or a price, so
// an advertisement asking for more business had no signal at all. "Make me a
// FLYER to get more funeral business" did not produce a flyer either.
//
// An advertisement with no shop name and no phone number on it is a stock
// photo. But a request for a picture must still stay a picture — the point is
// to tell those apart, not to put type on everything.
// ---------------------------------------------------------------------------

test("a post whose job is to win business is a designed piece, not a bare photo", () => {
  const asked = [
    "Crate me a facebook post to generate more funeral work.",
    "Create me a facebook post to generate more funeral work.",
    "make me a flyer to get more funeral business",
    "post to bring in more wedding bookings",
    "something to attract more corporate clients",
    "I want to drive more orders this month",
    "advertise our sympathy arrangements",
    "promote our valentines specials",
    "let customers know about our new subscription"
  ];
  for (const request of asked) {
    assert.equal(requestNeedsFlyerWording(request), true,
      `"${request}" came back as a photograph with no shop name, message or phone number on it`);
  }
});

test("naming the artefact is enough on its own — a flyer request produces a flyer", () => {
  for (const request of ["I need a flyer", "make me a poster", "design a graphic for facebook", "a banner for the shop", "run an ad for us"]) {
    assert.equal(requestNeedsFlyerWording(request), true,
      `the florist asked for a ${request.split(" ").pop()} and would not have got one`);
  }
});

test("a request for a PICTURE still stays a picture — type is not put on everything", () => {
  // Requirement 10, and Ashley's own examples of what she wants the engine to
  // be able to make. These are images, not advertisements.
  const pictures = [
    "make me an image of a jaguar holding a dozen roses saying go team",
    "make me a wedding image with Hydrangea's, Peonies and snapdragons in white and pink",
    "a pretty picture of todays arrangement",
    "photo of the new spring tulips",
    "something seasonal and cheerful for the feed"
  ];
  for (const request of pictures) {
    assert.equal(requestNeedsFlyerWording(request), false,
      `"${request}" asked for a picture and would have had a poster layout imposed on it`);
  }
});

test("the existing operational and fact signals still fire", () => {
  for (const request of [
    "Lilies in Bloom is closing at 2:30 today.",
    "we open late tomorrow",
    "20% off this weekend",
    "order deadline is Friday",
    "call 606-506-4039"
  ]) {
    assert.equal(requestNeedsFlyerWording(request), true, `regression: "${request}"`);
  }
});

// ---------------------------------------------------------------------------
// Copy that is wrong in TONE while every fact in it is true.
//
// Ashley asked for a post to bring in funeral work and was shown this:
//
//   "At Lilies in Bloom, we understand the importance of celebrating life's
//    milestones, including funerals and memorial services. Our experienced
//    florists create beautiful, meaningful arrangements to help you express
//    your condolences and honor your loved ones. From classic bouquets to
//    custom designs, we're here to support you during this difficult time.
//    Contact us today to discuss your needs and let us help you create a
//    lasting tribute."
//
// Nothing in it is invented, so every guard in this file passed it. It frames
// a funeral as a milestone to celebrate, and the rest would suit any business
// on earth. Sympathy work is the most delicate writing a florist does.
// ---------------------------------------------------------------------------

const ASHLEYS_FUNERAL_POST =
  "At Lilies in Bloom, we understand the importance of celebrating life's milestones, including " +
  "funerals and memorial services. Our experienced florists create beautiful, meaningful arrangements " +
  "to help you express your condolences and honor your loved ones. From classic bouquets to custom " +
  "designs, we're here to support you during this difficult time. Contact us today to discuss your " +
  "needs and let us help you create a lasting tribute.";

test("the exact post Ashley was shown is caught, and for the right reasons", () => {
  const reasons = detectWeakMarketingCopy("Crate me a facebook post to generate more funeral work.", ASHLEYS_FUNERAL_POST);
  assert.ok(reasons.length >= 2, `only found: ${JSON.stringify(reasons)}`);
  assert.ok(reasons.some((r) => /celebratory language/i.test(r)), "the celebratory framing of a death was not caught");
  assert.ok(reasons.some((r) => /any business in any industry/i.test(r)), "the stock filler was not caught");
});

test("a death is never framed as a celebration, a milestone or an occasion", () => {
  const offenders = [
    "We love celebrating life's milestones with you, including funerals.",
    "Funerals are a special occasion and we are delighted to help.",
    "We're excited to offer new sympathy arrangements!",
    "It's a joyful thing to honour a loved one at a memorial."
  ];
  for (const copy of offenders) {
    assert.ok(detectWeakMarketingCopy("funeral flowers", copy).some((r) => /celebratory/i.test(r)),
      `not caught: "${copy}"`);
  }
});

test("'celebration of life' is a real memorial term and is left alone", () => {
  // Flagging it would push the model away from the correct word for the thing.
  const copy = "We are honoured to make the flowers for a celebration of life. Call 606-506-4039 and we will look after it.";
  assert.deepEqual(detectWeakMarketingCopy("memorial service", copy), []);
});

test("writing only this florist could have written passes untouched", () => {
  const good =
    "When a family comes to us after a loss, we sit down and listen first. Standing sprays, casket " +
    "flowers and small arrangements for the service, made here in the shop by hand. Call 606-506-4039 " +
    "and we will take care of the rest.";
  assert.deepEqual(detectWeakMarketingCopy("post to generate more funeral work", good), []);
});

test("celebratory language is fine when nothing about the request is a bereavement", () => {
  const copy = "We're so excited for Valentine's Day! Celebrating with a fresh batch of red roses this week.";
  assert.ok(!detectWeakMarketingCopy("valentines post", copy).some((r) => /celebratory/i.test(r)));
});

// Real, live-found failure: a real caption ("Whether it's a special
// occasion or just because, we've got you covered.") shipped untouched
// because this used to require TWO stock phrases before flagging anything
// — the phrase list exists precisely because each entry is recognizable
// stock copy on its own; one is enough.
test("even a single recognized stock phrase is flagged — ordinary, phrase-free copy is not", () => {
  const clean = "Our Freedom roses just came in and they're gorgeous today — stop by before they're gone.";
  assert.ok(!detectWeakMarketingCopy("post", clean).some((r) => /any business/i.test(r)),
    "copy with none of the recognized stock phrases should not be flagged");
  const one = "We have a wide range of bouquets ready today. Come and see us on Main Street.";
  assert.ok(detectWeakMarketingCopy("post", one).some((r) => /any business/i.test(r)),
    "\"a wide range of\" is on the recognized stock-phrase list — one match is enough to flag it");
  const many = "We understand the importance of flowers. Our experienced florists are here to support you. Whether you're looking for roses or lilies, we've got you covered.";
  assert.ok(detectWeakMarketingCopy("post", many).some((r) => /any business/i.test(r)));
});

// Real, live-found failure (found by reading Ashley's own real generated
// content in the production database): "Make me a post to remind everyone
// that flowers say I care without saying a word" — a plain, universal,
// non-bereavement sentiment — came back reading "we've seen families ask
// for our Freedom roses and leatherleaf to express their love and
// condolences in the most delicate moments," treating an ordinary
// feel-good post as a sympathy/funeral message. Nothing in the request was
// about a death or a loss; the model invented that framing on its own, and
// no existing guard caught it (the sympathy checks above only ever guard
// the OTHER direction — a genuine sympathy request written too
// celebratory — never a plain request written as if it were sympathy).
test("an ordinary, non-bereavement request that comes back reading as sympathy/funeral wording is flagged", () => {
  const request = "Make me a post to remind everyone that flowers say I care without saying a word";
  const copy =
    "At Lilies in Bloom, we've seen families ask for our Freedom roses and leatherleaf to express their " +
    "love and condolences in the most delicate moments. These tender blooms, paired with our spray roses " +
    "and alstroemeria, can convey emotions and show care without saying a word.";
  const reasons = detectWeakMarketingCopy(request, copy);
  assert.ok(
    reasons.some((r) => /condolences/i.test(r) && /death or a loss/i.test(r)),
    `the invented sympathy framing was not caught: ${JSON.stringify(reasons)}`
  );
});

test("a genuine sympathy request is never wrongly flagged for using real sympathy wording", () => {
  // The new guard above must never fire on an actual funeral/sympathy
  // request just because it correctly used sympathy words — only on a
  // request that never asked for that at all.
  const request = "Make me a post about our funeral flower arrangements";
  const copy = "At Lilies in Bloom, we craft gentle sympathy arrangements to honor your loved one during this time.";
  const reasons = detectWeakMarketingCopy(request, copy);
  assert.ok(
    !reasons.some((r) => /never about a death or a loss/i.test(r)),
    `a genuine sympathy request was wrongly told its own sympathy wording was invented: ${JSON.stringify(reasons)}`
  );
});

test("a wall of text is flagged as too long for a social post", () => {
  const long = Array.from({ length: 8 }, (_, i) => `This is a reasonably long sentence number ${i} about our lovely flowers and our shop.`).join(" ");
  assert.ok(detectWeakMarketingCopy("post", long).some((r) => /too long/i.test(r)));
});

test("empty or missing copy yields no reasons rather than throwing", () => {
  assert.deepEqual(detectWeakMarketingCopy("funeral", ""), []);
  assert.deepEqual(detectWeakMarketingCopy(null, null), []);
});

// ---------------------------------------------------------------------------
// A florist supplies the FLOWERS for a funeral.
//
// Ashley, reading a generated flyer that said "Funeral / SERVICES AVAILABLE"
// above her shop name and phone number: "it reads like I'm going to hold
// funeral services here at the flower shop."
//
// She is right, and it is worse than an awkward phrase. A grieving family
// reading that could ring a flower shop believing it arranges the funeral.
// The service is held by a funeral home, a church, a crematorium — never at
// the flower shop.
// ---------------------------------------------------------------------------

test("the flyer wording Ashley was shown is caught", () => {
  const onTheFlyer = "Funeral SERVICES AVAILABLE. Call us at 606-506-4039 to discuss your funeral arrangements.";
  const reasons = detectWeakMarketingCopy("Crate me a facebook post to generate more funeral work.", onTheFlyer);
  assert.ok(reasons.some((r) => /holds the service itself/i.test(r)),
    `not caught: ${JSON.stringify(reasons)}`);
});

test("no wording may imply the shop holds the service", () => {
  for (const copy of [
    "Funeral services available.",
    "Memorial services for your loved one.",
    "We offer graveside services.",
    "Cremation service packages from Lilies in Bloom.",
    "Burial services arranged with care."
  ]) {
    assert.ok(detectWeakMarketingCopy("funeral", copy).some((r) => /holds the service itself/i.test(r)),
      `not caught: "${copy}"`);
  }
});

test("the correct florist phrasing passes untouched", () => {
  // These are what the shop actually does, and the retry must not chase them.
  for (const copy of [
    "Funeral flowers, made by hand. Standing sprays and casket flowers. Call 606-506-4039.",
    "Sympathy flowers for the service. Call 606-506-4039 and we will look after it.",
    "Flowers for the service, delivered to the funeral home. Call 606-506-4039.",
    "Wreaths, sprays and posies for a memorial. Call 606-506-4039."
  ]) {
    assert.deepEqual(detectWeakMarketingCopy("funeral work", copy), [], `wrongly flagged: "${copy}"`);
  }
});

test("'funeral arrangements' is only safe when the copy says what is being arranged", () => {
  // To a florist it means flower arrangements; to everyone else it means the
  // undertaking. The word "arrangements" alone does not disambiguate itself.
  assert.ok(detectWeakMarketingCopy("funeral", "We can help with funeral arrangements. Call 606-506-4039.")
    .some((r) => /undertaking/i.test(r)));
  assert.deepEqual(
    detectWeakMarketingCopy("funeral", "Our funeral arrangements use fresh lilies and white roses. Call 606-506-4039."),
    []
  );
});

test("a shop that genuinely is not a funeral home is not accused of other things", () => {
  // Guard against the check spreading: an ordinary post must stay clean.
  assert.deepEqual(detectWeakMarketingCopy("valentines", "Fresh red roses in the shop today. Call 606-506-4039."), []);
});

// ---------------------------------------------------------------------------
// A phone number nobody gave the model.
//
// Ashley's flyer came back reading "CALL US AT 555-1234 FOR CUSTOM FUNERAL
// ARRANGEMENTS TODAY" above her own real number. Every fact guard in this file
// passed it, because they all check that supplied facts SURVIVE — not one of
// them asked whether a fact had been ADDED.
//
// This is the worst kind of invention. It is actionable, it looks
// authoritative, and a grieving family ringing it does not reach the shop.
// ---------------------------------------------------------------------------

test("the fabricated number on Ashley's flyer is caught", () => {
  const flyer = "Funeral FLOWERS AVAILABLE AT LILIES IN BLOOM. CALL US AT 555-1234 FOR CUSTOM FUNERAL ARRANGEMENTS TODAY 606-506-4039";
  assert.deepEqual(
    detectFabricatedContactNumbers({
      requestText: "Crate me a facebook post to generate more funeral work.",
      shopPhone: "606-506-4039",
      copyText: flyer
    }),
    ["555-1234"]
  );
});

test("the shop's own number is never mistaken for an invented one, however it is written", () => {
  // Formatting differences must not read as a different number, or the guard
  // would fire on every correct flyer and the retry would chase its own tail.
  for (const [shopPhone, copy] of [
    ["606-506-4039", "Call 606-506-4039 to order."],
    ["6065064039", "Call (606) 506-4039 today."],
    ["606-506-4039", "Call 1-606-506-4039."],
    ["1-606-506-4039", "Call 606.506.4039."],
    ["(606) 506-4039", "Ring us on 606 506 4039."],
    // A number stored with an international or dialling prefix, written in
    // the copy in its plain local form. Only normalising the COPY side would
    // miss this and report the shop's own number as invented.
    ["011-606-506-4039", "Call 606-506-4039 to order."],
    ["+1 (606) 506-4039", "Call 606 506 4039."]
  ]) {
    assert.deepEqual(detectFabricatedContactNumbers({ shopPhone, copyText: copy }), [],
      `the shop's own number was reported as invented: ${copy}`);
  }
});

test("a number the florist supplied themselves is theirs to use", () => {
  assert.deepEqual(
    detectFabricatedContactNumbers({
      requestText: "put our new order line 555-201-8890 on it",
      shopPhone: "606-506-4039",
      copyText: "Call 555-201-8890 to order."
    }),
    []
  );
});

test("times, dates, prices and percentages are not phone numbers", () => {
  assert.deepEqual(
    detectFabricatedContactNumbers({
      shopPhone: "606-506-4039",
      copyText: "Closing at 2:30 on 08/22/2026. 20% off. Bouquets from $45.00. Since 1998."
    }),
    []
  );
});

test("an invented number is reported through the main copy check too", () => {
  const reasons = detectWeakMarketingCopy(
    "funeral work",
    "Call us at 555-1234 for funeral flowers.",
    { shopPhone: "606-506-4039" }
  );
  assert.ok(reasons.some((r) => /nobody gave you/i.test(r)), JSON.stringify(reasons));
});

test("the caption Ashley was shown after the first fix is still caught as filler", () => {
  // "At Lilies in Bloom, we understand that losing a loved one is never easy.
  // That's why we're here to help..." — the tone was right this time and the
  // wording no longer claimed the shop holds services, but the writing is
  // still the same stock opener.
  const caption =
    "At Lilies in Bloom, we understand that losing a loved one is never easy. That's why we're here to " +
    "help with beautiful funeral flowers, including standing sprays and casket flowers. Our experienced " +
    "florists will work with you to create a meaningful arrangement that honors your loved one's memory.";
  assert.ok(detectWeakMarketingCopy("funeral work", caption, { shopPhone: "606-506-4039" })
    .some((r) => /any business in any industry/i.test(r)));
});

test("without the shop's own number the check gives no opinion rather than a wrong one", () => {
  // Guessing here would flag every correct flyer — the shop's real number
  // would look invented — and the retry would chase its own tail forever.
  const copy = "Call 606-506-4039 for funeral flowers.";
  assert.deepEqual(detectWeakMarketingCopy("funeral work", copy), []);
  assert.deepEqual(detectWeakMarketingCopy("funeral work", copy, {}), []);
});

// ---------------------------------------------------------------------------
// Filler that has not been seen before.
//
// Three rounds of real output made the case: each time a stock phrase was
// banned, the next attempt wrote the same empty sentence in a new shape. "We
// understand the importance of" became "we understand that". A phrase list can
// only ever ban the sentence that has already been shown to somebody.
//
// These posts contain NONE of the banned phrases. They are still unpublishable
// for the same reason, and they must be caught without anyone adding a line to
// the list first.
// ---------------------------------------------------------------------------

test("empty writing is caught even when it uses none of the banned phrases", () => {
  const unseen = [
    "We know how much it matters to get this right for the people you love. " +
      "Every family who comes to us deserves care and attention at a time like this. " +
      "We would be glad to talk it through with you whenever you are ready.",
    "Nothing means more to us than getting the details right for you and yours. " +
      "There is real thought behind everything that leaves our door each morning. " +
      "Reach out and one of us will walk you through all of the choices."
  ];
  for (const copy of unseen) {
    for (const phrase of ["we understand", "here to support", "experienced florists", "wide range", "high-quality"]) {
      assert.ok(!copy.toLowerCase().includes(phrase), `this test is worthless if the copy contains "${phrase}"`);
    }
    assert.ok(
      detectWeakMarketingCopy("funeral work", copy, { shopName: "Lilies in Bloom" })
        .some((r) => /pictured or acted on/i.test(r)),
      `not caught: "${copy}"`
    );
  }
});

test("writing with real detail in it is left alone by the hollow check", () => {
  const specific = [
    // Genuinely about the service/funeral home, so the request itself must
    // say so too — otherwise the newer "invented bereavement framing" guard
    // (below) would rightly read this as sympathy wording invented onto a
    // request that never asked for it. A real caller always passes the
    // florist's own actual brief here, which would itself say "funeral".
    {
      request: "post about our funeral flowers for the service",
      copy:
        "White lilies, cream roses and eucalyptus, made up as a standing spray for the service. " +
        "We can have it at the funeral home by Friday morning if you call today. " +
        "Ring 606-506-4039 and ask for whoever is on the bench."
    },
    {
      request: "post",
      copy:
        "There are still buckets of red roses in the cooler and we are conditioning more tonight. " +
        "Hand-tied and wrapped, ready to pick up from Saturday. " +
        "Twelve stems is $45.00 and we will hold one back for you."
    }
  ];
  for (const { request, copy } of specific) {
    assert.deepEqual(detectWeakMarketingCopy(request, copy, { shopName: "Lilies in Bloom" }), [],
      `wrongly flagged: "${copy}"`);
  }
});

test("one general sentence among specific ones is ordinary writing, not filler", () => {
  // The check must fire on copy that is MOSTLY hollow. A single warm, general
  // line is how people actually write, and flagging it would send the retry
  // chasing a post that was already fine.
  const copy =
    "We know how hard the first few days are for a family. " +
    "White lilies and cream roses, made up as a casket spray here in the shop. " +
    "Call 606-506-4039 and we will have it at the funeral home for Friday.";
  assert.deepEqual(detectWeakMarketingCopy("funeral work", copy, { shopName: "Lilies in Bloom" }), []);
});

test("a short line is brevity, never filler", () => {
  const copy = "Open until five. Come and see us. Roses are in.";
  assert.deepEqual(findHollowSentences(copy, "Lilies in Bloom"), []);
  assert.deepEqual(detectWeakMarketingCopy("post", copy, { shopName: "Lilies in Bloom" }), []);
});

test("naming your own shop is not specificity, even when the name is a flower", () => {
  // "At Lilies in Bloom, we understand that losing a loved one is never easy"
  // is the exact sentence this check exists to catch. If the shop's own name
  // counted as a flower mention, that sentence would read as specific and the
  // check would pass it.
  const sentence = "At Lilies in Bloom, we understand that losing a loved one is never easy.";
  assert.deepEqual(findHollowSentences(sentence, "Lilies in Bloom"), [sentence]);
  // And the same sentence about a shop whose name is not a flower behaves the
  // same way — nothing here is specific to one shop.
  const other = "At The Petal Bar, we understand that losing a loved one is never easy.";
  assert.deepEqual(findHollowSentences(other, "The Petal Bar"), [other]);
});

test("the hollow check never fires on copy the stock-phrase check already condemned", () => {
  // Two reasons saying the same thing in different words would read as two
  // separate faults to the model on the retry.
  const reasons = detectWeakMarketingCopy("funeral work", ASHLEYS_FUNERAL_POST, { shopName: "Lilies in Bloom" });
  const overlapping = reasons.filter((r) => /any business in any industry|pictured or acted on/i.test(r));
  assert.equal(overlapping.length, 1, JSON.stringify(reasons));
});

test("findHollowSentences is pure and survives missing input", () => {
  assert.deepEqual(findHollowSentences("", ""), []);
  assert.deepEqual(findHollowSentences(null, null), []);
  const copy = "We know how much it matters to get this right for the people you love.";
  assert.deepEqual(findHollowSentences(copy, "Lilies in Bloom"), findHollowSentences(copy, "Lilies in Bloom"));
});

// ---------------------------------------------------------------------------
// A sympathy flyer never leads with the product.
//
// Ashley, on a flyer headed "Funeral / FLOWERS AVAILABLE": "Funeral Flowers
// doesn't at all sound sympathetic. That would make you lose sales. Think if
// you lost a loved one would you buy from someone who just says we have
// funeral flowers, NO."
//
// Every guard in this file passed that headline. They check tone, stock
// phrasing, invented facts, and whether the shop claims to hold the service —
// and nothing is wrong with "Funeral Flowers Available" except the only thing
// that matters: it is a supply notice, printed largest, to someone who buried
// a parent on Tuesday.
// ---------------------------------------------------------------------------

test("the headline Ashley was shown is caught", () => {
  assert.ok(detectSympathyProductHeadline("Crate me a facebook post to generate more funeral work.", "Funeral Flowers Available"),
    "the headline she rejected still passes");
  // And it reaches the retry through the main check, which is what actually
  // changes what a florist is shown.
  const reasons = detectWeakMarketingCopy(
    "Crate me a facebook post to generate more funeral work.",
    "Funeral Flowers Available. We offer a variety of funeral flowers, including standing sprays and casket flowers.",
    { headline: "Funeral Flowers Available", shopName: "Lilies in Bloom" }
  );
  assert.ok(reasons.some((r) => /product label, not a sympathy headline/i.test(r)), JSON.stringify(reasons));
});

test("no sympathy headline may be a bare category or a supply notice", () => {
  for (const headline of [
    "Funeral Flowers", "Sympathy Flowers", "Memorial Flowers Now Available",
    "Funeral Arrangements", "Our Funeral Flowers", "Funeral Sprays For Sale",
    "Order Your Funeral Flowers Now", "Casket Flowers Available", "Sympathy Designs In Stock"
  ]) {
    assert.ok(detectSympathyProductHeadline("funeral work", headline), `not caught: "${headline}"`);
  }
  // And the shape a model reaches for once it has been told not to write
  // "Funeral Flowers Available": the same supply notice with the give-away
  // word removed. It carries nothing to recognise it by except the request it
  // was written for.
  assert.ok(detectSympathyProductHeadline("Crate me a facebook post to generate more funeral work.", "Now Available"),
    "a bare supply notice on a funeral flyer was not caught");
  assert.ok(detectSympathyProductHeadline("funeral work", "Order Now"));
  assert.equal(detectSympathyProductHeadline("valentines day", "Now Available"), null,
    "an ordinary flyer may say Now Available");
});

test("a headline that leads with the person may still name the flowers", () => {
  // "In Loving Memory — Sympathy Flowers Available" advertises, but it leads
  // with the person, which is the whole point. Only the bare label is a fault.
  assert.equal(detectSympathyProductHeadline("funeral work", "In Loving Memory — Sympathy Flowers Available"), null);
  assert.equal(detectSympathyProductHeadline("funeral work", "With Sympathy: Standing Sprays Available"), null);
});

test("a shop that wakes people up in the morning is not holding a funeral", () => {
  // The shared bereavement test cannot tell the two senses of "wake" apart,
  // and here the cost of getting it wrong is a spring post rewritten as a
  // sympathy piece.
  assert.equal(
    detectSympathyProductHeadline("spring post", "Now Available", "Wake up to fresh flowers every Monday morning."),
    null
  );
});

test("a headline addressed to the bereaved passes untouched", () => {
  // These are what a sympathy card actually says. Flagging them would push the
  // model away from the correct words for the thing.
  for (const headline of [
    "With Sympathy", "In Loving Memory", "Thinking of You", "With Deepest Sympathy",
    "When Words Aren't Enough", "For the Family", "A Celebration of Life",
    "In Remembrance", "Our Deepest Condolences",
    // Naming the flowers as well is fine — this one leads with the person.
    "With Sympathy — Funeral Flowers"
  ]) {
    assert.equal(detectSympathyProductHeadline("funeral work", headline), null, `wrongly flagged: "${headline}"`);
  }
});

test("an ordinary occasion may advertise availability like any shop", () => {
  // "Roses Available" is a correct headline for Valentine's Day. This check is
  // for bereavement work and must never spread beyond it.
  for (const [request, headline] of [
    ["valentines day", "Valentine's Roses Available"],
    ["valentines day", "Roses Now Available"],
    ["mothers day", "Mother's Day Bouquets"],
    ["spring", "Tulips In Stock"],
    ["closing early", "Closing Early Today"],
    ["wedding", "Wedding Flowers"]
  ]) {
    assert.equal(detectSympathyProductHeadline(request, headline), null, `wrongly flagged: "${headline}"`);
  }
});

test("the headline check gives no opinion when there is no headline", () => {
  // A caption has none, and judging its first sentence as one would be judging
  // something the florist never wrote.
  assert.equal(detectSympathyProductHeadline("funeral work", ""), null);
  assert.equal(detectSympathyProductHeadline("funeral work", null), null);
  assert.equal(detectSympathyProductHeadline(null, null), null);
  const caption = "We know the first few days are the hardest. White lilies and cream roses, made up as a casket spray here in the shop. Call 606-506-4039.";
  assert.deepEqual(detectWeakMarketingCopy("funeral work", caption, { shopName: "Lilies in Bloom" }), []);
});

test("the wording rules the model is given actually carry this instruction", () => {
  // A detector that only rejects is a detector that makes the florist wait
  // through two generations for the same fault. The prompt has to say what to
  // write instead, or the retry is a coin flip.
  const engine = fs.readFileSync(new URL("../netlify/functions/_shared/ai-creative-engine.js", import.meta.url), "utf8");
  for (const phrase of ["SYMPATHY HEADLINES ARE NOT PRODUCT LABELS", "SYMPATHY OPENINGS ARE NOT PRODUCT LABELS", "With Sympathy", "In Loving Memory"]) {
    assert.ok(engine.includes(phrase), `the model is never told: ${phrase}`);
  }
});

test("a caption that opens by advertising stock is caught too", () => {
  // The same fault as the headline, written out as a sentence — and the
  // caption is the part that actually gets posted to Facebook. Each of these
  // is specific, invents nothing, uses no stock phrase, and passed every other
  // check in this file.
  for (const copy of [
    "We have funeral flowers available. White lilies and cream roses, made up as a casket spray. Call 606-506-4039.",
    "Funeral flowers are now available at Lilies in Bloom. Standing sprays and casket flowers, made here. Call 606-506-4039.",
    "We offer a variety of sympathy arrangements. Wreaths, sprays and posies. Call 606-506-4039.",
    "Sympathy flowers in stock. White lilies and cream roses. Call 606-506-4039."
  ]) {
    assert.ok(detectSympathyProductOpening("post to generate more funeral work", copy),
      `not caught: "${copy}"`);
    assert.ok(detectWeakMarketingCopy("funeral work", copy, { shopName: "Lilies in Bloom", shopPhone: "606-506-4039" })
      .some((r) => /opens by advertising stock/i.test(r)), `never reached the retry: "${copy}"`);
  }
});

test("an opening that speaks to the family, or to the shop's own history, is left alone", () => {
  for (const copy of [
    "When a family comes to us after a loss we sit down and listen first. Standing sprays and casket flowers, made here in the shop. Call 606-506-4039.",
    // "we have" alone is not a supply notice.
    "We have been making funeral flowers for thirty years. White lilies and cream roses. Call 606-506-4039.",
    "With sympathy from all of us. Standing sprays and casket flowers, delivered to the funeral home. Call 606-506-4039.",
    "We know the first few days are the hardest. White lilies, made up as a casket spray. Call 606-506-4039."
  ]) {
    assert.deepEqual(detectWeakMarketingCopy("funeral work", copy, { shopName: "Lilies in Bloom", shopPhone: "606-506-4039" }), [],
      `wrongly flagged: "${copy}"`);
  }
});

test("an opening that leads with the person may still name what is in stock", () => {
  // Same allowance as the headline: leading with the person is the whole
  // point, and mentioning stock after that is ordinary, useful writing.
  assert.equal(
    detectSympathyProductOpening("funeral work", "With sympathy from all of us — funeral flowers available today. Call 606-506-4039."),
    null
  );
  assert.equal(
    detectSympathyProductOpening("funeral work", "In loving memory: we offer standing sprays and casket flowers. Call 606-506-4039."),
    null
  );
});

test("one fault stays one fault however the flyer text was assembled", () => {
  // The strip only fires when the copy literally begins with the headline. A
  // flyer whose headline is stored differently from the way it is concatenated
  // — uppercased, re-spaced — would otherwise have the headline judged twice,
  // once as a headline and once as the opening, and the retry would be told it
  // made two mistakes when it made one.
  const reasons = detectWeakMarketingCopy(
    "funeral work",
    "FUNERAL FLOWERS AVAILABLE. Standing sprays and casket flowers, made here. Call 606-506-4039.",
    { headline: "Funeral Flowers Available", shopName: "Lilies in Bloom", shopPhone: "606-506-4039" }
  );
  const supply = reasons.filter((r) => /product label, not a sympathy headline|opens by advertising stock/i.test(r));
  assert.equal(supply.length, 1, JSON.stringify(reasons));
});

test("an ordinary occasion may open by advertising stock like any shop", () => {
  for (const copy of [
    "Red roses are now available for Valentine's Day. Twelve hand-tied is $65.00. Call 606-506-4039.",
    "We offer a variety of Mother's Day baskets. Peonies and stock. Call 606-506-4039."
  ]) {
    assert.equal(detectSympathyProductOpening("valentines day", copy), null, `wrongly flagged: "${copy}"`);
  }
});

test("one fault is never reported twice in different words", () => {
  // On a flyer the concatenated text begins with the headline, so the headline
  // check and the opening check would both fire on the same fault and the
  // retry would read it as two separate problems.
  const reasons = detectWeakMarketingCopy(
    "funeral work",
    "Funeral Flowers Available. Standing sprays and casket flowers, made here. Call 606-506-4039.",
    { headline: "Funeral Flowers Available", shopName: "Lilies in Bloom", shopPhone: "606-506-4039" }
  );
  const supply = reasons.filter((r) => /product label, not a sympathy headline|opens by advertising stock/i.test(r));
  assert.equal(supply.length, 1, JSON.stringify(reasons));
});

test("a flyer whose HEADLINE is right but whose message opens with stock is still caught", () => {
  // The headline is stripped before the opening is judged, so the message's
  // own first sentence is what gets read — not the headline a second time.
  const reasons = detectWeakMarketingCopy(
    "funeral work",
    "With Sympathy We offer a variety of funeral flowers. Call 606-506-4039.",
    { headline: "With Sympathy", shopName: "Lilies in Bloom", shopPhone: "606-506-4039" }
  );
  assert.ok(reasons.some((r) => /opens by advertising stock/i.test(r)), JSON.stringify(reasons));
});

// ---------------------------------------------------------------------------
// A number nobody can ring.
//
// Ashley's funeral flyer, generated through the real path on the test site,
// carried "(555) 555-5555" twice — on the ribbon and in the contact panel.
// A grieving family reads that, dials it, and does not reach the shop.
//
// The guard written to catch exactly this did not fire, and the reason was not
// the one it looked like. CONTACT_NUMBER_RE was greedy across sentence
// boundaries, so printing the number TWICE a few characters apart — which is
// precisely what a flyer does — merged both into one 20-digit match that every
// caller then discarded as too long. A shop WITH its number on file would have
// been missed in the same way.
// ---------------------------------------------------------------------------

test("the flyer Ashley was shown is caught — the same number printed twice", () => {
  // The regression test for the greedy match. Before the fix this returned [].
  const onTheFlyer = "Contact us today at (555) 555-5555. (555) 555-5555";
  assert.deepEqual(
    detectFabricatedContactNumbers({ shopPhone: "606-506-4039", copyText: onTheFlyer }),
    ["(555) 555-5555"]
  );
  // And with no shop phone stored at all, which is the case that reached her.
  assert.deepEqual(detectPlaceholderContactNumbers({ copyText: onTheFlyer }), ["(555) 555-5555"]);
  assert.ok(detectWeakMarketingCopy("funeral work", onTheFlyer, {}).some((r) => /nobody gave you/i.test(r)),
    "with no shop phone on file the check still said nothing");
});

test("two different real numbers a sentence apart are two numbers, not one", () => {
  // The same greedy fault in its other form: a florist's own number beside a
  // supplied one must not merge into a single unrecognisable run.
  assert.deepEqual(
    detectFabricatedContactNumbers({
      shopPhone: "606-506-4039",
      copyText: "Call 606-506-4039. For deliveries call 555-555-5555."
    }),
    ["555-555-5555"]
  );
});

test("a placeholder number is fake on its face, whatever the shop's number is", () => {
  for (const n of ["(555) 555-5555", "555-1234", "(555) 123-4567", "555-0100", "123-4567", "111-1111", "1234567890"]) {
    assert.ok(isPlaceholderPhoneNumber(n), `not recognised as a placeholder: ${n}`);
  }
  for (const n of ["606-506-4039", "1-800-356-9377", "212-555-0100".replace("555-0100", "664-7665"), "0161 496 0000"]) {
    assert.ok(!isPlaceholderPhoneNumber(n), `a real number was called a placeholder: ${n}`);
  }
  // Not phone numbers at all.
  for (const n of ["2:30", "08/22/2026", "20%", "$45.00", "1998"]) {
    assert.ok(!isPlaceholderPhoneNumber(n), `${n} is not a phone number`);
  }
});

test("a number the florist typed themselves is theirs, placeholder-looking or not", () => {
  // Their stated fact outranks this, as every stated fact does.
  assert.deepEqual(
    detectPlaceholderContactNumbers({ requestText: "put our new line 555-0123 on it", copyText: "Call 555-0123." }),
    []
  );
});

test("an invented number never reaches the canvas — substituted when the shop's own is known", () => {
  const flyer = "Standing sprays and casket flowers. Contact us today at (555) 555-5555.";
  const out = stripFabricatedContactNumbers({ requestText: "funeral work", shopPhone: "606-506-4039", copyText: flyer });
  assert.deepEqual(out.removed, ["(555) 555-5555"]);
  assert.equal(out.substituted, true);
  assert.ok(out.text.includes("606-506-4039"), out.text);
  assert.ok(!out.text.includes("555"), out.text);
  // The florist's own words are otherwise untouched.
  assert.ok(out.text.startsWith("Standing sprays and casket flowers."), out.text);
});

test("an invented number never reaches the canvas — cut when there is nothing to put in its place", () => {
  // A flyer with no number is one a florist can fix. A flyer with a wrong
  // number sends a grieving family to a dead line.
  const flyer = "Standing sprays and casket flowers. Contact us today at (555) 555-5555.";
  const out = stripFabricatedContactNumbers({ requestText: "funeral work", copyText: flyer });
  assert.deepEqual(out.removed, ["(555) 555-5555"]);
  assert.equal(out.substituted, false);
  assert.ok(!/555/.test(out.text), out.text);
  // The clause goes with it — never "Contact us today at ."
  assert.ok(!/at\s*\.?$/.test(out.text.trim()), `a dangling clause was left: "${out.text}"`);
  assert.ok(out.text.includes("Standing sprays and casket flowers."), out.text);
});

test("a call to action that is nothing but an invented number leaves nothing behind", () => {
  const out = stripFabricatedContactNumbers({ copyText: "(555) 555-5555" });
  assert.deepEqual(out.removed, ["(555) 555-5555"]);
  assert.equal(out.text, "");
});

test("correct wording is never touched by the strip", () => {
  for (const copy of [
    "Standing sprays and casket flowers. Call 606-506-4039.",
    "Closing at 2:30 on 08/22/2026. 20% off. Bouquets from $45.00. Since 1998.",
    "White lilies and cream roses. Call 606-506-4039 and we will look after it."
  ]) {
    const out = stripFabricatedContactNumbers({ shopPhone: "606-506-4039", copyText: copy });
    assert.deepEqual(out.removed, [], `wrongly removed from: "${copy}"`);
    assert.equal(out.text, copy);
  }
});

test("the real handler strips an invented number from the flyer before it is rendered", () => {
  // The check that matters: not that the detector works, but that the wording
  // reaching the canvas has been through it. Both fields the flyer prints.
  const handler = fs.readFileSync(new URL("../netlify/functions/marketing-studio.js", import.meta.url), "utf8");
  const calls = handler.match(/stripFabricatedContactNumbers\(/g) || [];
  assert.ok(calls.length >= 2,
    `the strip runs ${calls.length} time(s) — the flyer wording and the caption both need it`);
  assert.ok(/for \(const field of \["headline", "body", "cta"\]\)/.test(handler),
    "the strip must cover every field that reaches the graphic, not just the call to action");
  // Calling it is not using it. An earlier version of this test counted the
  // calls and passed with the assignment deleted — the strip ran, its result
  // was thrown away, and the invented number still reached the canvas.
  const applied = handler.match(/if \(cleaned\.removed\.length\) \w+\.content\[field\] = cleaned\.text;/g) || [];
  assert.equal(applied.length, 2,
    `the strip's result is written back ${applied.length} time(s) — it must be applied to both the flyer wording and the caption, not merely computed`);
});

test("a number that ends a sentence is still a number", () => {
  // The seven-digit form's trailing guard once excluded "." outright, so a
  // number closing a sentence did not match at all — and every test wrote the
  // number mid-sentence, so nothing caught it.
  assert.deepEqual(detectPlaceholderContactNumbers({ copyText: "Call 555-1234." }), ["555-1234"]);
  assert.deepEqual(detectPlaceholderContactNumbers({ copyText: "Call 555-1234" }), ["555-1234"]);
  assert.deepEqual(
    detectFabricatedContactNumbers({ shopPhone: "606-506-4039", copyText: "Ring us on 606-506-4039." }),
    []
  );
  // And the things that are still not phone numbers, at a sentence end.
  assert.deepEqual(detectPlaceholderContactNumbers({ copyText: "Bouquets from $45.00. Since 1998. Closing at 2:30 on 08/22/2026." }), []);
});

test("the retry is told which exact phrases to cut, in the model's own words", () => {
  // Ashley's caption came back carrying three banned phrases at once, the
  // check fired, the retry ran, and the second attempt was just as stock — it
  // shipped anyway. "Cut the stock phrases" tells a model there is a problem
  // without telling it where; it can only guess which sentence offended.
  const caption =
    "At Lilies in Bloom, we understand the importance of creating meaningful funeral arrangements that " +
    "reflect the personality and spirit of your loved one. Our experienced florists work closely with " +
    "families to design and craft beautiful standing sprays, casket flowers, and other sympathy " +
    "arrangements using high-quality flowers such as roses, alstroemeria, and leatherleaf ferns.";
  const reason = detectWeakMarketingCopy("funeral work", caption, { shopName: "Lilies in Bloom", shopPhone: "606-506-4039" })
    .find((r) => /any business in any industry/i.test(r));
  assert.ok(reason, "the stock phrasing was not caught at all");
  for (const phrase of ["we understand the importance of", "Our experienced florists", "high-quality"]) {
    assert.ok(reason.includes(`"${phrase}"`), `the retry was never told about "${phrase}": ${reason}`);
  }
});

test("the phrases quoted back are the ones actually written, not the rules that matched", () => {
  // A rule can match text that differs from the rule — the shop-name opener
  // and the florists rule both do. Handing back the rule instead of the words
  // would tell the model to remove a phrase it never wrote.
  const copy = "At Petal & Stem, we believe every family deserves care. Our dedicated team is here to help you.";
  const reason = detectWeakMarketingCopy("funeral work", copy, { shopName: "Petal & Stem" })
    .find((r) => /any business in any industry/i.test(r));
  assert.ok(reason, JSON.stringify(detectWeakMarketingCopy("funeral work", copy, { shopName: "Petal & Stem" })));
  assert.ok(reason.includes('"At Petal & Stem, we believe"'), reason);
  assert.ok(reason.includes('"Our dedicated team"'), reason);
  // And nothing invented: every quoted phrase is genuinely in the copy.
  for (const quoted of reason.match(/"([^"]+)"/g) || []) {
    const phrase = quoted.slice(1, -1);
    assert.ok(copy.toLowerCase().includes(phrase.toLowerCase()), `quoted a phrase the florist never wrote: ${phrase}`);
  }
});

test("a shop with an ampersand in its name is not exempt from the filler rules", () => {
  // The opener rule's character class had no "&" or "-", so the single most
  // recognisable filler sentence there is stopped applying to shops called
  // "Rose & Thorn" or "Petal-and-Stem" — and only to those shops.
  for (const name of ["Rose & Thorn", "Petal-and-Stem", "Lilies in Bloom"]) {
    const copy = `At ${name}, we believe every family deserves care. Our dedicated team is here to help you.`;
    assert.ok(detectWeakMarketingCopy("funeral work", copy, { shopName: name }).some((r) => /any business/i.test(r)),
      `"${name}" escaped the filler rules`);
  }
});

// Superseded by "even a single recognized stock phrase is flagged —
// ordinary, phrase-free copy is not" above: a real caption shipped with
// exactly one recognized stock phrase, so the threshold that used to
// tolerate one no longer holds — see that test's own comment for the
// live-found failure that changed it.
