import test from "node:test";
import assert from "node:assert/strict";
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
