import test from "node:test";
import assert from "node:assert/strict";
import {
  requestNeedsFlyerWording,
  instructionAffectsFlyerWording,
  instructionAffectsFlyerImage,
  factsPreserved,
  buildDeterministicNoticeContent
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { buildImagePrompt } from "../netlify/functions/_shared/ai-image-engine.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

/**
 * Live beta defect (third occurrence): the AI IMAGE model was asked, via
 * visual_brief, to paint a real business message onto a marketing graphic
 * ("CLOSING EARLY... Lilies in Bloom will close at 2:30 today... Call
 * 606-506-4039") and produced garbled nonsense ("Reserve you with whote
 * striding," "6.13:19:30") instead — a diffusion model can't spell. Fixed
 * by wiring Florisyn's existing, previously-unused deterministic flyer
 * system (generateFlyerContent + public/flyer-renderer.js — already built
 * and tested for the older general-Lily-chat path) into Marketing
 * Studio's real generate_content/revise_content for the first time. Any
 * request whose important information needs to be visible and exact on
 * the graphic routes there; the AI image model is never asked to render
 * words at all, for ANY marketing-post image (see buildImagePrompt's own
 * unconditional no-text guarantee).
 */

const CLOSING_BRIEF =
  "Create a Facebook post letting customers know Lilies in Bloom will close at 2:30 today. Need to place an order? Call 606-506-4039.";

// A minimal, real (CRC-agnostic — flyer-render.js's validator never checks
// chunk CRCs, only the signature and IHDR) PNG buffer for
// finalize_flyer_render tests — real enough to pass the actual hardened
// validator, not a fake placeholder string.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function pngDataUrl(width = 1080, height = 1080) {
  const buf = Buffer.alloc(33);
  buf.set(PNG_SIGNATURE, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

test("requestNeedsFlyerWording: routes real operational/promotional signals to the deterministic flyer path", () => {
  for (const text of [
    CLOSING_BRIEF,
    "We're having a 20% off sale this weekend only.",
    "Reminder: order by Thursday for Mother's Day delivery.",
    "Join us for our anniversary event on June 5th.",
    "New hours starting Monday: 9am-6pm.",
    "We've moved! Find us at 123 Main Street.",
    "Announcing our new wedding package."
  ]) {
    assert.equal(requestNeedsFlyerWording(text), true, `"${text}" must route to the deterministic flyer path`);
  }
});

test("requestNeedsFlyerWording: an ordinary decorative/celebratory request stays a plain photo — no flyer signal", () => {
  for (const text of ["I have 40 roses I need to sell — a bright, romantic bouquet post for Facebook", "Post about our beautiful spring arrangements", "Show off today's fresh delivery"]) {
    assert.equal(requestNeedsFlyerWording(text), false, `"${text}" must NOT be routed to the flyer path`);
  }
});

test("instructionAffectsFlyerWording: a revision that changes a fact or explicitly targets the graphic regenerates the text layer", () => {
  for (const instruction of ["Actually we're closing at 3, not 2:30", "Make the headline shorter", "Fix the wording on the flyer", "Change the phone number to 606-506-9999"]) {
    assert.equal(instructionAffectsFlyerWording(instruction), true, `"${instruction}" must trigger a flyer text regeneration`);
  }
});

test("instructionAffectsFlyerWording: an ordinary caption-only revision leaves the flyer's exact wording untouched", () => {
  for (const instruction of ["Make it more cheerful", "Shorter and warmer, please", "Use a friendlier tone"]) {
    assert.equal(instructionAffectsFlyerWording(instruction), false, `"${instruction}" must NOT trigger a flyer text regeneration`);
  }
});

test("instructionAffectsFlyerImage: a request to change the visual re-rolls the AI-generated background — the 'Regenerate image' action, typed or one-click", () => {
  for (const instruction of [
    "Change the image",
    "Regenerate the background image — keep the exact same wording.",
    "Try a different photo",
    "Can I get a new picture behind the text?",
    "Swap the background",
    "I want different flowers shown in the background"
  ]) {
    assert.equal(instructionAffectsFlyerImage(instruction), true, `"${instruction}" must trigger a background regeneration`);
  }
});

test("instructionAffectsFlyerImage: an ordinary wording or caption revision never re-rolls the background", () => {
  for (const instruction of ["Make the headline shorter", "Make it more cheerful", "Actually we're closing at 3, not 2:30", "Use a friendlier tone"]) {
    assert.equal(instructionAffectsFlyerImage(instruction), false, `"${instruction}" must NOT trigger a background regeneration`);
  }
});

test("buildImagePrompt: unconditionally forbids on-image text, even when visual_brief explicitly asks for it", () => {
  const withNoBrief = buildImagePrompt({ occasion: "Spring", shopName: "Lilies in Bloom" });
  const withInnocentBrief = buildImagePrompt({ visualBrief: "A bright bouquet of roses on a marble counter." });
  const withTextAskingBrief = buildImagePrompt({ visualBrief: "A flyer with the headline CLOSING EARLY and the phone number 606-506-4039 printed on it." });
  for (const prompt of [withNoBrief, withInnocentBrief, withTextAskingBrief]) {
    assert.match(prompt, /no legible text, words, letters, numbers, or signage/i, "every image prompt must carry the unconditional no-text directive");
  }
});

// ── Handler-level: the real generate_content/revise_content/
// revert_content_revision dispatch via deps.florist.

function floristDeps(client) {
  return { florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
/** Mocks every Cloudflare AI call (both the text/copy endpoint AND the
 * image endpoint go through the same fetch) and records every call's URL
 * and parsed body so a test can prove which provider actually got called —
 * the real proof that "no operational wording was sent to the diffusion
 * model," not an assumption. Text-generation calls (copy, then flyer
 * content, in that real call order) consume `textJsonQueue` in order —
 * the same order-sensitive-queue convention the fake DB client already
 * uses — so a copy call and a flyer-content call can return genuinely
 * different content, proving they're really two separate calls, not one
 * value read twice. */
function mockCloudflare(textJsonQueue) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const queue = [...textJsonQueue];
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    calls.push({ url: String(url), body });
    if (String(url).includes("black-forest-labs") || "prompt" in body) {
      // The image-generation endpoint — never expected to be called for a
      // flyer-routed request.
      return { ok: true, json: async () => ({ success: true, result: { image: "ZmFrZS1pbWFnZS1ieXRlcw==" } }) };
    }
    const next = queue.length ? queue.shift() : textJsonQueue[textJsonQueue.length - 1];
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(next) } }) };
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

const CLOSING_COPY = {
  platform: "facebook",
  headline: "Closing early today!",
  body: "Heads up — Lilies in Bloom will close at 2:30 PM today. Need to place an order? Call 606-506-4039. Back to normal hours tomorrow!",
  cta: "Call 606-506-4039",
  visual_brief: "A bright, professional shot of the shop's fresh flower display.",
  hashtags: [],
  asset_requirements: [],
  brand_traits_used: [],
  visual_traits_used: []
};
// Also doubles as the flyer-content response — generateFlyerContent only
// ever reads headline/body/cta off whatever the mocked model returns, so
// the same fixture legitimately exercises both call sites.
const CLOSING_FLYER = { headline: "CLOSING EARLY", body: "Lilies in Bloom will close at 2:30 today.", cta: "Need to place an order? Call 606-506-4039." };

function generateFlyerFixtureQueue({ shopPhone = "606-506-4039" } = {}) {
  return [
    { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief: CLOSING_BRIEF, status: "idea" }, error: null }, // currentItem
    { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
    { data: { marketing_monthly_budget_cents: null }, error: null }, // budget check
    { data: null, error: null }, // -> generating
    { data: { name: "Lilies in Bloom", phone: shopPhone }, error: null }, // shopRow
    { data: null, error: null }, // loadBrandBrain
    { data: null, error: null }, // loadStyleMemory
    { data: [], error: null }, // loadGroundedInventory
    { data: [], error: null }, // audience customers
    { data: [], error: null }, // audience orders
    { data: null, error: null }, // recordUsage("copy") — copyGen
    { data: null, error: null }, // recordUsage("copy") — flyerGen
    { data: { id: "flyer-asset-1" }, error: null }, // persistGeneratedAsset (flyer)
    { data: null, error: null }, // variant update
    { data: { id: "item-1", status: "draft" }, error: null } // final content_items update
  ];
}

test("generate_content (real dispatch): an operational closing notice routes to the deterministic flyer, and a real Tier-A floral background is generated — but the image model NEVER sees the actual business wording", async () => {
  const mock = mockCloudflare([CLOSING_COPY, CLOSING_FLYER]);
  try {
    const client = createFakeSupabaseClient(generateFlyerFixtureQueue(), { storage: createFakeSupabaseStorage({}) });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected the flyer path to succeed: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.asset.type, "flyer", "must persist a flyer asset, not a plain image");

    // Requirement: the AI image model DOES get called now (for the
    // decorative floral background, Ashley's explicit design direction),
    // but never with the real business wording — proven by inspecting the
    // actual prompt sent, not assumed.
    const imageCalls = mock.calls.filter((c) => c.url.includes("black-forest-labs") || "prompt" in c.body);
    assert.equal(imageCalls.length, 1, "exactly one background image call is expected for a flyer");
    const bgPrompt = imageCalls[0].body.prompt;
    assert.doesNotMatch(bgPrompt, /2:30/, "the exact time must never be sent to the image model");
    assert.doesNotMatch(bgPrompt, /606-506-4039/, "the exact phone number must never be sent to the image model");
    assert.match(bgPrompt, /no legible text, words, letters, numbers, or signage/i, "the background prompt must carry the same unconditional no-text guarantee");

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedRow = assetInsert.ops.find((op) => op[0] === "insert")[1][0];
    assert.equal(insertedRow.asset_type, "flyer");
    // Exact flyer wording and fact preservation: the real facts the
    // florist gave verbatim (the time and phone number) survive into the
    // on-image content exactly as given.
    assert.equal(insertedRow.content.headline, "CLOSING EARLY");
    assert.match(insertedRow.content.body, /2:30/);
    assert.match(insertedRow.content.cta, /606-506-4039/);
    assert.equal(insertedRow.content.caption, CLOSING_COPY.body, "the Facebook caption is separate from the on-image text");
    assert.match(insertedRow.content.caption, /606-506-4039/);
    assert.equal(insertedRow.content.brand.phone, "606-506-4039", "the shop's real phone rides along for the renderer's contact line");
    assert.equal(insertedRow.content.template_id, "notice", "a closing notice must pick the maximum-legibility template");
    assert.ok(insertedRow.content.regions, "the renderer needs the full region layout, not just a template id");
    assert.equal(insertedRow.content.style_tier, "generated", "a successful background generation must be recorded as Tier A");
    assert.ok(insertedRow.content.background_url, "the real generated background url must be persisted");
  } finally {
    mock.restore();
  }
});

test("generate_content (real dispatch): a flyer still generates successfully — with the exact real wording intact — even when the background image generation itself fails (Tier A never blocks the deterministic text)", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const textQueue = [CLOSING_COPY, CLOSING_FLYER];
  globalThis.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    if (String(url).includes("black-forest-labs") || "prompt" in body) {
      // The background generation call fails outright.
      return { ok: false, status: 503, json: async () => ({ success: false, errors: [{ message: "model unavailable" }] }) };
    }
    const next = textQueue.length ? textQueue.shift() : CLOSING_FLYER;
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(next) } }) };
  };
  try {
    const client = createFakeSupabaseClient(generateFlyerFixtureQueue(), { storage: createFakeSupabaseStorage({}) });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `a failed background must never fail the whole flyer: ${res.body}`);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedRow = assetInsert.ops.find((op) => op[0] === "insert")[1][0];
    assert.equal(insertedRow.content.style_tier, "template", "falls back to Tier B when the background call fails");
    assert.equal(insertedRow.content.background_url, null);
    assert.equal(insertedRow.content.headline, "CLOSING EARLY", "the real deterministic wording is completely unaffected by the background failure");
    assert.match(insertedRow.content.cta, /606-506-4039/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Architecture fix — Ashley's second real branch-deploy test: even a
// "safe" (non-invented, grounded) AI paraphrase of a plain operational
// notice still silently dropped the actual closing time from the
// rendered flyer ("Early Closing Notice" with no "2:30" anywhere) — a
// paraphrase dropping a fact isn't "invented," so the reactive
// invented-embellishment guard never caught it. The real, general fix:
// for a plain operational notice with extractable facts, there is ONE
// authoritative grounded content object (buildDeterministicNoticeContent)
// — built directly from the request's own facts, never asked of AI at
// all — and BOTH the caption and the flyer's on-image text consume it
// directly, proactively, before any AI wording call would even happen.
// This test proves the AI text-generation endpoint is never called even
// ONCE for this request (queuing a response that, if used, would fail
// every assertion below) — not just that a safe fallback recovers after
// the fact.
test("generate_content (real dispatch): a flyer-routed closing notice never calls the AI wording model at all — the ONE authoritative deterministic content object is used directly for both caption and on-image text, and the closing time survives onto the flyer", async () => {
  const UNUSED_AI_COPY = {
    platform: "facebook",
    headline: "Early Closing Notice",
    body: "Don't forget, Lilies in Bloom will be closing at 2:30 today. If you need to place an order, give us a call at 606-506-4039.",
    cta: "Call 606-506-4039",
    visual_brief: "A bright, professional shot of the shop's fresh flower display.",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
  // Queued but must NEVER be consumed — if the handler still called the
  // AI wording model, this fixture's own paraphrase ("Early Closing
  // Notice", no visible "2:30") is exactly the real live defect: safe,
  // non-invented, and still missing the material fact.
  const mock = mockCloudflare([UNUSED_AI_COPY]);
  try {
    const brief = "Create today's Florisyn Facebook post with an image. Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.";
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief, status: "idea" }, error: null }, // currentItem
        { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
        { data: { marketing_monthly_budget_cents: null }, error: null }, // budget check
        { data: null, error: null }, // -> generating
        { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null }, // shopRow
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: [], error: null }, // loadGroundedInventory
        { data: [], error: null }, // audience customers
        { data: [], error: null }, // audience orders
        { data: null, error: null }, // recordUsage("copy") — the ONE real copy call only
        { data: { id: "flyer-asset-1" }, error: null }, // persistGeneratedAsset (flyer)
        { data: null, error: null }, // variant update
        { data: { id: "item-1", status: "draft" }, error: null } // final content_items update -> draft, never idea
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected the rejection to recover into a completed flyer draft: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.item.status, "draft", "the item must complete as a real draft — never reverted to or left at idea");
    assert.equal(body.asset.type, "flyer");

    // The exact required safe fallback content — built from the real
    // verified facts in the request, matching buildDeterministicNoticeContent
    // directly (never hardcoded here, so this test also proves the
    // handler actually calls the shared builder, not a duplicated copy).
    const expected = buildDeterministicNoticeContent({ requestText: brief, shopName: "Lilies in Bloom", shopPhone: "606-506-4039" });
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.headline, expected.headline);
    assert.equal(insertedContent.body, expected.body);
    assert.equal(insertedContent.cta, expected.cta);
    assert.equal(insertedContent.caption, expected.caption);
    assert.equal(insertedContent.headline, "Closing Early Today");
    assert.equal(insertedContent.body, "Lilies in Bloom is closing at 2:30 today.");
    assert.equal(insertedContent.cta, "Call 606-506-4039 to place an order.");
    assert.equal(insertedContent.caption, "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.");
    for (const banned of ["final orders", "special event", "look forward to serving you again", "appreciate your understanding"]) {
      assert.doesNotMatch(`${insertedContent.headline} ${insertedContent.body} ${insertedContent.cta} ${insertedContent.caption}`.toLowerCase(), new RegExp(banned));
    }

    // A real floral background is still generated (Tier A) — the safety
    // recovery only replaces the WORDING, never blocks the visual.
    assert.equal(insertedContent.style_tier, "generated", "a real background must still be generated for the recovered draft");
    assert.ok(insertedContent.background_url, "a real generated background url must be persisted");
    const imageCalls = mock.calls.filter((c) => c.url.includes("black-forest-labs") || "prompt" in c.body);
    assert.equal(imageCalls.length, 1, "exactly one real background image call is still expected");

    // Neither the caption's nor the flyer's AI wording call ever runs —
    // this is a plain operational notice with extractable facts, so the
    // authoritative deterministic object is used directly and proactively
    // for both, never asking AI to write or reinterpret the notice at all.
    const textCalls = mock.calls.filter((c) => !(c.url.includes("black-forest-labs") || "prompt" in c.body));
    assert.equal(textCalls.length, 0, "the AI wording model must never be called at all — not for the caption, not for the flyer text");

    const revertCall = client.calls.find(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "idea")
    );
    assert.equal(revertCall, undefined, "the item must NEVER be reverted to idea — this is the exact live defect being fixed");
  } finally {
    mock.restore();
  }
});

// Phase 3 live-test report: Ashley reported the newest card STILL showed
// the exact old AI paraphrase and "Early Closing Notice" headline on
// commit c3ef58d, using the exact bare sentence she'd typed into the
// browser — not the longer fixture brief above ("Create today's Florisyn
// Facebook post with an image. ..."). Full code-path tracing (create_
// content_item -> generate_content, the only path the real UI's one-
// message create form and its "Ask Lily to create it" fallback both use;
// no separate compound-orchestrator route) turned up no bug in the wiring
// itself — buildDeterministicNoticeContent/requestSignalsPlainOperational
// Notice both verified correct in isolation for this precise sentence.
// This test locks in that exact bare sentence (word for word, no added
// framing) end to end, AND makes the result independently checkable
// without trusting this report: the persisted asset's `model` column
// (never previously selected by list_content) now round-trips to the
// client, so "which branch executed" is a real field Ashley can read
// off the browser's network tab or devtools on the next live test, not
// something that has to be taken on faith.
const EXACT_BROWSER_SENTENCE = "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.";

function exactSentenceFixtureQueue({ primaryColor = "#b93870", accentColor = "#6f8f72" } = {}) {
  return [
    { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief: EXACT_BROWSER_SENTENCE, status: "idea" }, error: null }, // currentItem
    { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
    { data: { marketing_monthly_budget_cents: null }, error: null }, // budget check
    { data: null, error: null }, // -> generating
    { data: { name: "Lilies in Bloom", phone: "606-506-4039", primary_color: primaryColor, accent_color: accentColor }, error: null }, // shopRow
    { data: null, error: null }, // loadBrandBrain
    { data: null, error: null }, // loadStyleMemory
    { data: [], error: null }, // loadGroundedInventory
    { data: [], error: null }, // audience customers
    { data: [], error: null }, // audience orders
    { data: null, error: null }, // recordUsage("copy") — the ONE real copy call only
    { data: { id: "flyer-asset-1" }, error: null }, // persistGeneratedAsset (flyer)
    { data: null, error: null }, // variant update
    { data: { id: "item-1", status: "draft" }, error: null } // final content_items update -> draft
  ];
}

test("generate_content (real dispatch): the EXACT bare sentence from Ashley's browser test — no added framing — uses the deterministic wording verbatim, persists model:\"deterministic\", and threads the shop's REAL brand color (not a hardcoded navy) onto the flyer", async () => {
  const UNUSED_AI_COPY = {
    platform: "facebook",
    headline: "Early Closing Notice",
    body: "Don't forget, Lilies in Bloom will be closing at 2:30 today. If you need to place an order, give us a call at 606-506-4039.",
    cta: "Call 606-506-4039",
    visual_brief: "A bright, professional shot of the shop's fresh flower display.",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
  const mock = mockCloudflare([UNUSED_AI_COPY]);
  try {
    const shopPrimaryColor = "#e2437a"; // a distinctive, deliberately non-default, non-navy brand pink
    const client = createFakeSupabaseClient(exactSentenceFixtureQueue({ primaryColor: shopPrimaryColor }), { storage: createFakeSupabaseStorage({}) });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected a completed draft: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.item.status, "draft");

    const expected = buildDeterministicNoticeContent({ requestText: EXACT_BROWSER_SENTENCE, shopName: "Lilies in Bloom", shopPhone: "606-506-4039" });
    assert.equal(expected.headline, "Closing Early Today");
    assert.equal(expected.body, "Lilies in Bloom is closing at 2:30 today.");
    assert.equal(expected.cta, "Call 606-506-4039 to place an order.");
    assert.equal(expected.caption, EXACT_BROWSER_SENTENCE);

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedRow = assetInsert.ops.find((op) => op[0] === "insert")[1][0];
    assert.equal(insertedRow.model, "deterministic", "the persisted asset must record which branch actually ran — checkable independently of this report");
    assert.equal(insertedRow.content.headline, expected.headline);
    assert.equal(insertedRow.content.body, expected.body);
    assert.equal(insertedRow.content.cta, expected.cta);
    assert.equal(insertedRow.content.caption, expected.caption);
    // The exact byte-for-byte old defect must never appear anywhere in the
    // persisted content — proves this isn't just "facts preserved," it's
    // the authoritative wording exactly, per Ashley's explicit requirement.
    assert.notEqual(insertedRow.content.headline, "Early Closing Notice");
    assert.doesNotMatch(insertedRow.content.caption, /Don't forget/);

    // The flyer color fix: the band is no longer a hardcoded navy — the
    // shop's own real primary_color/accent_color now rides along on the
    // persisted asset for the client-side renderer to actually use.
    assert.equal(insertedRow.content.brand.primaryColor, shopPrimaryColor, "the shop's real brand color must be threaded through, not a fixed navy");
    assert.equal(insertedRow.content.brand.accentColor, "#6f8f72");

    const textCalls = mock.calls.filter((c) => !(c.url.includes("black-forest-labs") || "prompt" in c.body));
    assert.equal(textCalls.length, 0, "the AI wording model must never be called at all for this exact sentence");

    // Full round trip through list_content — proves the client actually
    // RECEIVES model:"deterministic" and the real brand color, not just
    // that they were written to the DB.
    const listQueue = [
      { data: [{ id: "item-1", content_type: "image_post", title: "Closing early today", brief: EXACT_BROWSER_SENTENCE, status: "draft", uses_ai_clone: false, requires_human_approval: true, campaign_id: null, created_at: "2026-08-26T00:00:00Z", updated_at: "2026-08-26T00:00:00Z" }], error: null },
      { data: [{ id: "variant-1", content_item_id: "item-1", platform: "facebook", status: "pending", asset_id: "flyer-asset-1" }], error: null },
      { data: [{ id: "flyer-asset-1", asset_type: "flyer", content: insertedRow.content, parent_asset_id: null, model: insertedRow.model }], error: null }
    ];
    const listClient = createFakeSupabaseClient(listQueue);
    const listHandler = createMarketingStudioHandler(floristDeps(listClient));
    const listRes = await listHandler(event("list_content", {}));
    assert.equal(listRes.statusCode, 200, `list_content must succeed: ${listRes.body}`);
    const listBody = JSON.parse(listRes.body);
    assert.equal(listBody.items[0].asset.model, "deterministic", "the client must actually receive model:\"deterministic\", not just have it in the DB");
    assert.equal(listBody.items[0].asset.content.brand.primaryColor, shopPrimaryColor);
  } finally {
    mock.restore();
  }
});

test("generate_content (real dispatch): an ordinary decorative request stays a plain photo-only image — never routed to the flyer path", async () => {
  const decorativeCopy = { ...CLOSING_COPY, body: "Fresh roses just arrived! Stop by today.", visual_brief: "A bright, romantic bouquet of roses on a marble counter." };
  const mock = mockCloudflare([decorativeCopy]);
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-2", content_type: "image_post", title: "Fresh roses", brief: "I have 40 roses I need to sell — a bright, romantic bouquet post for Facebook", status: "idea" }, error: null },
      { data: [{ id: "variant-2", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: null, error: null },
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: null }, // recordUsage("copy")
      { data: null, error: null }, // recordUsage("image")
      { data: { id: "media-row-1" }, error: null }, // website_media insert
      { data: { id: "image-asset-1" }, error: null }, // persistGeneratedAsset
      { data: null, error: null }, // variant update
      { data: { id: "item-2", status: "draft" }, error: null }
    ], { storage: createFakeSupabaseStorage({}) });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-2" }));
    assert.equal(res.statusCode, 200, `expected the plain-photo path to succeed: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.asset.type, "image", "an ordinary decorative request must stay a plain image, never a flyer");
    const imageCalls = mock.calls.filter((c) => c.url.includes("black-forest-labs") || "prompt" in c.body);
    assert.equal(imageCalls.length, 1, "the AI image model IS expected to be called for a plain photo request");
    assert.match(imageCalls[0].body.prompt, /no legible text, words, letters, numbers, or signage/i, "the image prompt actually sent must carry the no-text directive");
  } finally {
    mock.restore();
  }
});

test("revise_content (real dispatch): a wording change ('make the headline shorter') regenerates BOTH the caption and the flyer's exact text, with the same real facts intact", async () => {
  const revisedCopy = { ...CLOSING_COPY, body: "Just a heads up — Lilies in Bloom will close at 2:30 PM today, so grab your flowers now! Call 606-506-4039 with any last-minute orders." };
  // Only the headline changes — body/cta (where the real facts live) are
  // carried over byte-for-byte, so the flyer's own facts-preserved check
  // passes on a real, non-trivial wording change, not just an untouched one.
  const revisedFlyer = { ...CLOSING_FLYER, headline: "CLOSING SOON" };
  const mock = mockCloudflare([revisedCopy, revisedFlyer]);
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief: CLOSING_BRIEF, status: "draft" }, error: null }, // currentItem
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "flyer-asset-1" }], error: null }, // variants
      {
        data: {
          id: "flyer-asset-1",
          asset_type: "flyer",
          // The PRIOR asset is already a finalized, durable flyer (a real
          // url from an earlier finalize_flyer_render call) — this is the
          // one that must NOT survive into the new revision, since the
          // on-image wording is about to change and the old rendered file
          // would no longer match it.
          content: { ...CLOSING_FLYER, caption: CLOSING_COPY.body, template_id: "notice", regions: { headline: {} }, palette: {}, canvas: { width: 1080, height: 1080 }, brand: { shopName: "Lilies in Bloom", phone: "606-506-4039" }, url: "https://fake.storage/website-media/shop-ashley/old-flyer.png", mime: "image/png", rendered_at: "2026-08-20T00:00:00.000Z" }
        },
        error: null
      }, // current asset
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "flyer-asset-2" }, error: null }, // persistGeneratedAsset
      { data: null, error: null } // variant repoint update
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("revise_content", { content_item_id: "item-1", instruction: "Make the headline shorter" }));
    assert.equal(res.statusCode, 200, `expected the flyer revision to succeed: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.asset.type, "flyer");
    assert.equal(body.asset.parent_asset_id, "flyer-asset-1", "a revision must create a NEW child asset — never an in-place edit");
    // Inspect the REAL insert payload the handler actually sent, not just
    // the response shape — the fake client's insert response doesn't echo
    // content back, so this is the honest way to see what was persisted.
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.headline, "CLOSING SOON", "the on-image headline DID change, per the instruction");
    assert.match(insertedContent.body, /2:30/, "the on-image body's real fact (the time) survives");
    assert.match(insertedContent.cta, /606-506-4039/, "the on-image cta's real fact (the phone number) survives");
    assert.match(insertedContent.caption, /606-506-4039/, "the caption's real fact also survives");
    // Durability: the new asset must start un-finalized — the old render
    // no longer matches the new wording, so it can't be approved until a
    // fresh finalize_flyer_render happens.
    assert.equal(insertedContent.url, null, "a wording-changing revision must clear the stale rendered file's url");
    assert.equal(insertedContent.mime, null, "a wording-changing revision must clear the stale rendered file's mime");
    assert.equal(insertedContent.rendered_at, null, "a wording-changing revision must clear the stale render timestamp");
  } finally {
    mock.restore();
  }
});

test("revise_content (real dispatch): an ordinary caption-only revision ('make it more cheerful') leaves the flyer's exact wording untouched, only the caption changes", async () => {
  const cheerfulCopy = { ...CLOSING_COPY, body: "Quick heads up, friends! 🌸 We're closing at 2:30 PM today — call 606-506-4039 if you need anything before then!" };
  const mock = mockCloudflare([cheerfulCopy]);
  try {
    // Already finalized (a real durable url from an earlier
    // finalize_flyer_render) — since this revision doesn't touch the
    // on-image wording at all, that rendered file is still visually
    // accurate and must survive into the new asset untouched, so the
    // florist isn't forced through a pointless re-render + re-upload.
    const originalFlyerContent = {
      ...CLOSING_FLYER,
      caption: CLOSING_COPY.body,
      template_id: "notice",
      regions: { headline: {} },
      palette: {},
      canvas: { width: 1080, height: 1080 },
      brand: { shopName: "Lilies in Bloom", phone: "606-506-4039" },
      url: "https://fake.storage/website-media/shop-ashley/still-good-flyer.png",
      mime: "image/png",
      rendered_at: "2026-08-20T00:00:00.000Z"
    };
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief: CLOSING_BRIEF, status: "draft" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook", asset_id: "flyer-asset-1" }], error: null },
      { data: { id: "flyer-asset-1", asset_type: "flyer", content: originalFlyerContent }, error: null },
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: { id: "flyer-asset-2" }, error: null }, // persistGeneratedAsset — no second brand/style load since instructionAffectsFlyerWording is false
      { data: null, error: null } // variant repoint update
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("revise_content", { content_item_id: "item-1", instruction: "Make it more cheerful" }));
    assert.equal(res.statusCode, 200, `expected the caption-only revision to succeed: ${res.body}`);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.headline, CLOSING_FLYER.headline, "the on-image headline must stay exactly what it was");
    assert.equal(insertedContent.body, CLOSING_FLYER.body, "the on-image body must stay exactly what it was");
    assert.equal(insertedContent.cta, CLOSING_FLYER.cta, "the on-image cta must stay exactly what it was");
    assert.notEqual(insertedContent.caption, originalFlyerContent.caption, "the caption itself DID change");
    // Durability: pixels didn't change, so the existing durable render
    // survives — no wasted re-render/re-upload, and the item stays
    // immediately approvable.
    assert.equal(insertedContent.url, originalFlyerContent.url, "an unchanged-wording revision must carry the existing durable url forward");
    assert.equal(insertedContent.mime, originalFlyerContent.mime, "an unchanged-wording revision must carry the existing mime forward");
  } finally {
    mock.restore();
  }
});

test("revise_content (real dispatch): 'Regenerate image' — a request to change the visual re-rolls ONLY the AI-generated background, leaving the exact on-image wording untouched, and invalidates the stale render", async () => {
  const cheerfulCopy = { ...CLOSING_COPY };
  const mock = mockCloudflare([cheerfulCopy]);
  try {
    const originalFlyerContent = {
      ...CLOSING_FLYER,
      caption: CLOSING_COPY.body,
      template_id: "notice",
      regions: { headline: {} },
      palette: {},
      canvas: { width: 1080, height: 1080 },
      brand: { shopName: "Lilies in Bloom", phone: "606-506-4039" },
      url: "https://fake.storage/website-media/shop-ashley/still-good-flyer.png",
      mime: "image/png",
      rendered_at: "2026-08-20T00:00:00.000Z",
      render_status: "rendered",
      style_tier: "template",
      background_url: null,
      // Real inventory grounding already saved on the current asset — the
      // regeneration must reuse this, never re-query inventory itself.
      grounded_in_inventory: [{ name: "garden roses" }, { name: "ranunculus" }]
    };
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief: CLOSING_BRIEF, status: "draft" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "flyer-asset-1" }], error: null },
        { data: { id: "flyer-asset-1", asset_type: "flyer", content: originalFlyerContent }, error: null },
        { data: { name: "Lilies in Bloom", phone: "606-506-4039", primary_color: "#7c3a58" }, error: null }, // shopRow
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: { id: "flyer-asset-2" }, error: null }, // persistGeneratedAsset
        { data: null, error: null } // variant repoint update
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("revise_content", { content_item_id: "item-1", instruction: "Regenerate the background image — keep the exact same wording." }));
    assert.equal(res.statusCode, 200, `expected the image-regeneration revision to succeed: ${res.body}`);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.headline, CLOSING_FLYER.headline, "the on-image headline must stay exactly what it was — this is a visual-only revision");
    assert.equal(insertedContent.body, CLOSING_FLYER.body, "the on-image body must stay exactly what it was");
    assert.equal(insertedContent.cta, CLOSING_FLYER.cta, "the on-image cta must stay exactly what it was");
    // Real, live-found failure: "Regenerate image" used to ALWAYS
    // regenerate the Facebook caption too, even though the instruction
    // explicitly says "keep the exact same wording" and never mentions the
    // caption. The caption must now be byte-for-byte identical — proven by
    // NO text-generation call happening at all (only the background image
    // call), not just by coincidentally matching text.
    assert.equal(insertedContent.caption, originalFlyerContent.caption, "the caption must be preserved BYTE-FOR-BYTE on a pure image-only revision");
    const textCalls = mock.calls.filter((c) => !(c.url.includes("black-forest-labs") || "prompt" in c.body));
    assert.equal(textCalls.length, 0, "a pure image-only revision must never call the text/caption model at all");
    assert.equal(insertedContent.style_tier, "generated", "a successful regeneration must be recorded as Tier A");
    assert.ok(insertedContent.background_url, "a real new background url must be persisted");
    // Durability: the background actually changed, so the previously
    // rendered file no longer matches — it must be invalidated exactly
    // like a wording-changing revision does, forcing a fresh
    // render + finalize before this can be approved again.
    assert.equal(insertedContent.url, null, "a background-changing revision must clear the stale rendered file's url");
    assert.equal(insertedContent.render_status, null, "a background-changing revision must clear the stale render status");
    // The prompt actually sent to the image model must use the REUSED
    // grounding from the current asset, not a fresh/empty one, and must
    // never ask the model to spell anything.
    const imageCall = mock.calls.find((c) => c.url.includes("black-forest-labs") || "prompt" in c.body);
    assert.ok(imageCall, "the image model must actually have been called");
    assert.match(imageCall.body.prompt, /garden roses, ranunculus/, "the reused inventory grounding must reach the actual prompt");
    assert.match(imageCall.body.prompt, /no legible text, words, letters, numbers, or signage/i, "the background prompt must still carry the no-text directive");
  } finally {
    mock.restore();
  }
});

test("revise_content (real dispatch): a background regeneration that fails silently keeps the flyer's current background/style_tier untouched — never a broken result", async () => {
  const cheerfulCopy = { ...CLOSING_COPY };
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const textQueue = [cheerfulCopy];
  globalThis.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    if (String(url).includes("black-forest-labs") || "prompt" in body) {
      return { ok: false, status: 503, json: async () => ({ success: false, errors: [{ message: "model unavailable" }] }) };
    }
    const next = textQueue.length ? textQueue.shift() : cheerfulCopy;
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(next) } }) };
  };
  try {
    const originalFlyerContent = {
      ...CLOSING_FLYER,
      caption: CLOSING_COPY.body,
      template_id: "notice",
      regions: { headline: {} },
      palette: {},
      canvas: { width: 1080, height: 1080 },
      brand: { shopName: "Lilies in Bloom", phone: "606-506-4039" },
      url: "https://fake.storage/website-media/shop-ashley/still-good-flyer.png",
      mime: "image/png",
      rendered_at: "2026-08-20T00:00:00.000Z",
      render_status: "rendered",
      style_tier: "template",
      background_url: null
    };
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief: CLOSING_BRIEF, status: "draft" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook", asset_id: "flyer-asset-1" }], error: null },
        { data: { id: "flyer-asset-1", asset_type: "flyer", content: originalFlyerContent }, error: null },
        { data: { name: "Lilies in Bloom", phone: "606-506-4039", primary_color: "#7c3a58" }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: { id: "flyer-asset-2" }, error: null }, // persistGeneratedAsset
        { data: null, error: null } // variant repoint update
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("revise_content", { content_item_id: "item-1", instruction: "Change the image" }));
    assert.equal(res.statusCode, 200, `a failed background regeneration must never fail the whole revision: ${res.body}`);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(insertedContent.style_tier, "template", "a failed regeneration must keep the CURRENT style_tier, never a broken/empty one");
    assert.equal(insertedContent.background_url, null, "a failed regeneration must keep the CURRENT background_url");
    // Nothing actually changed visually, so the render must NOT be
    // invalidated — no pointless re-render forced on the florist.
    assert.equal(insertedContent.url, originalFlyerContent.url, "a failed background regeneration must leave the existing durable render alone");
    assert.equal(insertedContent.render_status, "rendered", "a failed background regeneration must leave the existing render_status alone");
    assert.equal(insertedContent.caption, originalFlyerContent.caption, "a pure image-only revision must never touch the caption, success or failure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("revert_content_revision (real dispatch): undo restores BOTH the previous caption and the previous flyer wording together, in one atomic swap — including its durable render, with no re-render needed", async () => {
  // The ORIGINAL asset was already a finalized, durable flyer (a real url
  // from a real earlier finalize_flyer_render call) before it was
  // revised. revert_content_revision never mutates or deletes assets — it
  // only repoints variants at the parent row — so that real url must come
  // back completely intact, for free, with no fresh render/finalize call
  // required.
  const originalFlyerContent = {
    ...CLOSING_FLYER,
    caption: CLOSING_COPY.body,
    template_id: "notice",
    regions: { headline: {} },
    palette: {},
    canvas: { width: 1080, height: 1080 },
    brand: { shopName: "Lilies in Bloom", phone: "606-506-4039" },
    url: "https://fake.storage/website-media/shop-ashley/original-flyer.png",
    mime: "image/png",
    rendered_at: "2026-08-20T00:00:00.000Z"
  };
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null }, // currentItem
    { data: [{ id: "variant-1", platform: "facebook", asset_id: "flyer-asset-2" }], error: null }, // variants (pointing at the REVISED asset)
    { data: { id: "flyer-asset-2", parent_asset_id: "flyer-asset-1", asset_type: "flyer" }, error: null }, // current asset (revised)
    { data: { id: "flyer-asset-1", parent_asset_id: null, asset_type: "flyer", content: originalFlyerContent }, error: null }, // parent asset (original)
    { data: null, error: null } // variant repoint update
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("revert_content_revision", { content_item_id: "item-1" }));
  assert.equal(res.statusCode, 200, `expected undo to succeed: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.equal(body.asset.id, "flyer-asset-1", "must restore the ORIGINAL asset, not stay on the revised one");
  assert.equal(body.asset.content.headline, "CLOSING EARLY");
  assert.equal(body.asset.content.caption, CLOSING_COPY.body, "the original caption is restored alongside the original flyer wording");
  assert.equal(body.asset.content.url, originalFlyerContent.url, "undo restores the original's real durable url, with no re-render needed");
  const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  const updatePayload = variantUpdate.ops.find((op) => op[0] === "update")[1][0];
  assert.equal(updatePayload.asset_id, "flyer-asset-1");
  assert.equal(updatePayload.caption, CLOSING_COPY.body);
});

const VALID_FLYER_CONTENT_SHAPE = { url: "https://fake.storage/website-media/shop-ashley/flyers/flyer-asset-1.png", storage_path: "shop-ashley/flyers/flyer-asset-1.png", mime: "image/png", render_status: "rendered" };

test("finalize_flyer_render (real dispatch): uploads the client-rendered flyer through the real website-media storage pipeline, to a deterministic per-asset path, and persists a durable content.url", async () => {
  const priorContent = {
    headline: "CLOSING EARLY",
    body: "Lilies in Bloom will close at 2:30 today.",
    cta: "Need to place an order? Call 606-506-4039.",
    caption: CLOSING_COPY.body,
    url: null,
    storage_path: null,
    mime: null,
    width: null,
    height: null,
    render_status: null,
    rendered_at: null
  };
  const storage = createFakeSupabaseStorage({ uploadResponses: [{ data: { path: "shop-ashley/flyers/flyer-asset-1.png" }, error: null }] });
  const client = createFakeSupabaseClient(
    [
      { data: { id: "item-1" }, error: null }, // content item ownership check
      { data: [{ id: "variant-1", asset_id: "flyer-asset-1" }], error: null }, // variants lookup
      { data: { id: "flyer-asset-1", asset_type: "flyer", content: priorContent }, error: null }, // asset lookup
      { data: { id: "flyer-asset-1", content: { ...priorContent, ...VALID_FLYER_CONTENT_SHAPE, width: 1080, height: 1080, rendered_at: "now" } }, error: null } // update
    ],
    { storage }
  );
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("finalize_flyer_render", { content_item_id: "item-1", asset_id: "flyer-asset-1", data_url: pngDataUrl(1080, 1080) }));
  assert.equal(res.statusCode, 200, `expected finalize_flyer_render to succeed: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.match(body.asset.url, /^https:\/\/fake\.storage\/website-media\//, "must return a real, retrievable storage URL — not the client's transient data: URL");
  const uploadCall = storage.calls.find((c) => c.op === "upload");
  assert.ok(uploadCall && uploadCall.bucket === "website-media", "must actually upload through the same real website-media storage pipeline every other image asset uses — not a second, parallel storage path");
  assert.equal(uploadCall.path, "shop-ashley/flyers/flyer-asset-1.png", "the storage path must be deterministic — keyed by shop + asset id, never a fresh random path per attempt");
  assert.equal(uploadCall.options.upsert, true, "must overwrite the same key on retry (idempotency), never accumulate duplicates");
  const updateCall = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "update"));
  const updatedContent = updateCall.ops.find((op) => op[0] === "update")[1][0].content;
  assert.ok(updatedContent.url, "the persisted content.url must be set");
  assert.equal(updatedContent.storage_path, "shop-ashley/flyers/flyer-asset-1.png");
  assert.equal(updatedContent.mime, "image/png");
  assert.equal(updatedContent.width, 1080, "real width read from the PNG's own IHDR chunk, not trusted from the client");
  assert.equal(updatedContent.height, 1080);
  assert.equal(updatedContent.render_status, "rendered");
  assert.equal(updatedContent.headline, "CLOSING EARLY", "the rest of the flyer's content must survive untouched");
});

test("finalize_flyer_render (real dispatch): a malformed/oversized/wrong-format payload is rejected before any database write or storage call", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1" }, error: null },
    { data: [{ id: "variant-1", asset_id: "flyer-asset-1" }], error: null },
    { data: { id: "flyer-asset-1", asset_type: "flyer", content: {} }, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  // A real JPEG signature labeled as PNG — proves this is a real
  // byte-signature check, not just trusting the data: URL's own claim.
  const notPng = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
  const res = await handler(
    event("finalize_flyer_render", { content_item_id: "item-1", asset_id: "flyer-asset-1", data_url: `data:image/png;base64,${notPng.toString("base64")}` })
  );
  assert.equal(res.statusCode, 400);
  assert.equal(client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "update")), undefined, "must never write anything for an invalid file");
});

test("finalize_flyer_render (real dispatch): refuses to finalize a non-flyer asset", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-2" }, error: null },
    { data: [{ id: "variant-1", asset_id: "image-asset-1" }], error: null },
    { data: { id: "image-asset-1", asset_type: "image", content: { url: "https://fake.storage/website-media/shop-ashley/photo.jpg" } }, error: null }
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("finalize_flyer_render", { content_item_id: "item-2", asset_id: "image-asset-1", data_url: pngDataUrl() }));
  assert.equal(res.statusCode, 400, "must reject finalizing a non-flyer asset");
});

test("finalize_flyer_render (real dispatch): a foreign shop's content_item_id fails closed with 404 — never falls through to another shop's data", async () => {
  // The real RLS-scoped client would simply return no row for a
  // content_item_id that doesn't belong to this session's shop — modeled
  // here as the item lookup coming back empty.
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("finalize_flyer_render", { content_item_id: "someone-elses-item", asset_id: "flyer-asset-1", data_url: pngDataUrl() }));
  assert.equal(res.statusCode, 404);
  assert.equal(client.calls.length, 1, "must stop at the ownership check — never query variants/assets for an item that isn't this shop's");
});

test("finalize_flyer_render (real dispatch): a stale render for an asset a newer revision has already replaced is declined — the CURRENT item is never touched", async () => {
  const storage = createFakeSupabaseStorage({});
  const client = createFakeSupabaseClient(
    [
      { data: { id: "item-1" }, error: null },
      // The item was revised WHILE this browser tab was still rendering —
      // variants now point at flyer-asset-2, not the flyer-asset-1 this
      // (late) finalize call is for.
      { data: [{ id: "variant-1", asset_id: "flyer-asset-2" }], error: null }
    ],
    { storage }
  );
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("finalize_flyer_render", { content_item_id: "item-1", asset_id: "flyer-asset-1", data_url: pngDataUrl() }));
  assert.equal(res.statusCode, 409, `a stale finalize must be declined, not silently applied: ${res.body}`);
  assert.equal(JSON.parse(res.body).stale, true);
  assert.equal(storage.calls.length, 0, "must never upload bytes for a superseded revision");
  assert.equal(client.calls.find((c) => c.table === "ai_generated_assets"), undefined, "must never touch ai_generated_assets at all for a stale finalize — the current (flyer-asset-2) row is untouched");
});

test("finalize_flyer_render (real dispatch): an asset_id that never belonged to this content item at all fails closed the same way a stale one does", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "item-1" }, error: null }, { data: [{ id: "variant-1", asset_id: "flyer-asset-1" }], error: null }]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("finalize_flyer_render", { content_item_id: "item-1", asset_id: "some-other-shops-asset-id", data_url: pngDataUrl() }));
  assert.equal(res.statusCode, 409, "a foreign/mismatched asset_id must be rejected, never silently accepted");
});

test("finalize_flyer_render (real dispatch): retrying the exact same finalize call is idempotent — same deterministic storage path, no competing files", async () => {
  const storage = createFakeSupabaseStorage({});
  const priorContent = { headline: "CLOSING EARLY", url: null, storage_path: null, mime: null, render_status: null };
  const queueOneAttempt = () => [
    { data: { id: "item-1" }, error: null },
    { data: [{ id: "variant-1", asset_id: "flyer-asset-1" }], error: null },
    { data: { id: "flyer-asset-1", asset_type: "flyer", content: priorContent }, error: null },
    { data: { id: "flyer-asset-1", content: { ...priorContent, ...VALID_FLYER_CONTENT_SHAPE } }, error: null }
  ];
  const client = createFakeSupabaseClient([...queueOneAttempt(), ...queueOneAttempt()], { storage });
  const handler = createMarketingStudioHandler(floristDeps(client));
  const dataUrl = pngDataUrl();
  const first = await handler(event("finalize_flyer_render", { content_item_id: "item-1", asset_id: "flyer-asset-1", data_url: dataUrl }));
  const second = await handler(event("finalize_flyer_render", { content_item_id: "item-1", asset_id: "flyer-asset-1", data_url: dataUrl }));
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200, "a retry must succeed cleanly, not error out");
  const uploads = storage.calls.filter((c) => c.op === "upload");
  assert.equal(uploads.length, 2, "both attempts really do call upload");
  assert.equal(uploads[0].path, uploads[1].path, "both attempts must write to the exact same deterministic path — never a fresh random file per attempt");
  assert.ok(uploads.every((u) => u.options.upsert === true), "every write must overwrite the same key, never accumulate duplicates");
});

test("approve_content (real dispatch): a real, server-side gate refuses to approve a flyer whose durable render hasn't finished — never trusts a client-side flag alone", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null }, // current item
    { data: [{ asset_id: "flyer-asset-1" }], error: null }, // reviewVariantAssets
    { data: [{ id: "flyer-asset-1", asset_type: "flyer", content: { headline: "CLOSING EARLY", url: null, render_status: null } }], error: null } // reviewAssets
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 409, `expected the durability gate to block approval: ${res.body}`);
  const statusUpdate = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.equal(statusUpdate, undefined, "the item's status must NOT change while the flyer is unfinished");
});

test("approve_content (real dispatch): a forged non-null url with no render_status/storage_path is STILL blocked — checking url alone is not enough", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-1" }], error: null },
    { data: [{ id: "flyer-asset-1", asset_type: "flyer", content: { headline: "CLOSING EARLY", url: "https://fake.storage/website-media/shop-ashley/flyer.png" } }], error: null } // url set, but no render_status/storage_path/mime — never went through finalize_flyer_render
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 409, `a non-null url alone must not be enough to approve: ${res.body}`);
});

test("approve_content (real dispatch): approves normally once the flyer has a real, fully finalized content shape", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-1" }], error: null },
    { data: [{ id: "flyer-asset-1", asset_type: "flyer", content: { headline: "CLOSING EARLY", ...VALID_FLYER_CONTENT_SHAPE } }], error: null },
    { data: { id: "item-1", status: "approved" }, error: null } // the real status update
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200, `expected approval to succeed once the flyer is finalized: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.equal(body.item.status, "approved");
});

test("approve_content (real dispatch): rejecting an unfinished flyer is never blocked — the gate only applies to approval", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "flyer-asset-1" }], error: null },
    { data: [{ id: "flyer-asset-1", asset_type: "flyer", content: { headline: "CLOSING EARLY", url: null, render_status: null } }], error: null },
    { data: { id: "item-1", status: "archived" }, error: null } // the real status update
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "rejected" }));
  assert.equal(res.statusCode, 200, `rejecting an unfinished flyer must still work: ${res.body}`);
});

test("facts preservation: the flyer's exact time and phone number survive a caption revision, same guarantee as an ordinary social_copy asset", () => {
  assert.equal(factsPreserved(CLOSING_COPY.body, "Closing at 2:30 PM today — call 606-506-4039 for last-minute orders!"), true);
  assert.equal(factsPreserved(CLOSING_COPY.body, "Closing early today — call us for last-minute orders!"), false);
});

// ---------------------------------------------------------------------------
// Day/temporal facts: the flyer must never state a day the florist didn't.
//
// A real defect found by running the deterministic builder over requests
// other than the one example: every closing/opening branch defaulted its
// qualifier to the literal string "today" when its temporal-word list
// didn't match, and that list contained no "tomorrow" and no weekday. So
// "opening late tomorrow at 10:30" rendered as "Opening Late Today" /
// "…opening at 10:30 today" — a customer-facing flyer stating the WRONG
// DAY. Fabricating a fact is worse than dropping one.
//
// Deliberately exercised with arbitrary shops, times and days, never only
// the Lilies in Bloom example.
// ---------------------------------------------------------------------------

test("deterministic notice: 'tomorrow' is preserved in both headline and body — a flyer must never say today when the florist said tomorrow", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Ravenwood Blooms is closing at 4:15 tomorrow.",
    shopName: "Ravenwood Blooms",
    shopPhone: "555-222-3333"
  });
  assert.equal(out.headline, "Closing Early Tomorrow");
  assert.equal(out.body, "Ravenwood Blooms is closing at 4:15 tomorrow.");
  assert.ok(!/\btoday\b/i.test(`${out.headline} ${out.body} ${out.caption}`), "the word 'today' must appear nowhere");
});

test("deterministic notice: a late opening on a stated day keeps that day, not 'today'", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Cedar & Sage is opening late tomorrow at 10:30.",
    shopName: "Cedar & Sage",
    shopPhone: "555-444-5555"
  });
  assert.equal(out.headline, "Opening Late Tomorrow");
  assert.match(out.body, /10:30/);
  assert.match(out.body, /tomorrow/i);
  assert.ok(!/\btoday\b/i.test(`${out.headline} ${out.body}`));
});

test("deterministic notice: a named weekday survives and stays capitalized as a proper noun", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Bayside Petals is closing at 1:00 on Monday.",
    shopName: "Bayside Petals",
    shopPhone: "555-777-8888"
  });
  assert.match(out.headline, /Monday/);
  assert.match(out.body, /on Monday/, "a weekday is a proper noun — never lowercased into 'on monday'");
  assert.ok(!/\btoday\b/i.test(`${out.headline} ${out.body}`));
});

test("deterministic notice: when the florist names NO day, no day is invented anywhere", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Fern & Fig is closing early at 3:45.",
    shopName: "Fern & Fig",
    shopPhone: "555-999-0000"
  });
  assert.equal(out.headline, "Closing Early", "no day word may be appended when none was stated");
  assert.equal(out.body, "Fern & Fig is closing at 3:45.");
  assert.ok(!/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(out.body));
});

test("deterministic notice: 'today' is still preserved when the florist really did say today", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Marigold Lane is closing at 2:30 today.",
    shopName: "Marigold Lane",
    shopPhone: "555-111-2222"
  });
  assert.equal(out.headline, "Closing Early Today");
  assert.equal(out.body, "Marigold Lane is closing at 2:30 today.");
});

test("extractFactTokens trimming: a time followed by another word no longer gets re-appended to a body that already contains it", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Thistle & Thorn has an announcement. Doors open 9:15 tomorrow.",
    shopName: "Thistle & Thorn",
    shopPhone: "555-333-4444"
  });
  const times = (out.body.match(/9:15/g) || []).length;
  assert.equal(times, 1, `the time must appear exactly once, not duplicated: ${out.body}`);
});

// ---------------------------------------------------------------------------
// Phone precedence: a number supplied for THIS flyer is that flyer's number.
// ---------------------------------------------------------------------------

test("deterministic notice: a phone supplied in the request wins over the shop profile's stored phone, byte-for-byte", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Juniper Floral is closing at 2:30 today. Call 606-506-4039 to place an order.",
    shopName: "Juniper Floral",
    shopPhone: "16063319374"
  });
  assert.equal(out.cta, "Call 606-506-4039 to place an order.");
  assert.ok(!out.cta.includes("16063319374"), "the profile phone must not silently replace the requested one");
  assert.ok(!out.caption.includes("16063319374"));
});

test("deterministic notice: with no phone in the request the shop's own stored phone is used (the authorized fallback)", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Juniper Floral is closing at 2:30 today.",
    shopName: "Juniper Floral",
    shopPhone: "555-606-7070"
  });
  assert.equal(out.cta, "Call 555-606-7070 to place an order.");
});

// ---------------------------------------------------------------------------
// Tenant isolation / anti-spoofing
// ---------------------------------------------------------------------------

test("tenant isolation: a request naming a DIFFERENT florist never brands the flyer as that business — the authenticated shop name is the only identity", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Rose City Florals is closing at 2:30 today. Call 606-506-4039 to place an order.",
    shopName: "Juniper Floral",
    shopPhone: "555-606-7070"
  });
  const all = `${out.headline} ${out.body} ${out.cta} ${out.caption}`;
  assert.ok(all.includes("Juniper Floral"), "the authenticated shop must be the one named");
  assert.ok(!all.includes("Rose City Florals"), "a business named only in untrusted request text must never become the branding");
});

test("tenant isolation: Florisyn's own name never appears in a shop's customer-facing notice content", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Juniper Floral is closing at 2:30 today.",
    shopName: "Juniper Floral",
    shopPhone: "555-606-7070"
  });
  assert.ok(!/florisyn/i.test(`${out.headline} ${out.body} ${out.cta} ${out.caption}`));
});

// ---------------------------------------------------------------------------
// The exact acceptance request, asserted end to end on the content object.
// ---------------------------------------------------------------------------

test("acceptance: the real request produces exactly the required headline, body, CTA and caption for the authenticated shop", () => {
  const out = buildDeterministicNoticeContent({
    requestText:
      "Create today’s Facebook post with an image. Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.",
    // Sourced ONLY from the authenticated shops row in the real handler.
    shopName: "Lilies in Bloom",
    shopPhone: "606-506-4039"
  });
  assert.equal(out.headline, "Closing Early Today");
  assert.equal(out.body, "Lilies in Bloom is closing at 2:30 today.");
  assert.equal(out.cta, "Call 606-506-4039 to place an order.");
  assert.equal(out.caption, "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.");
  const all = `${out.headline} ${out.body} ${out.cta} ${out.caption}`;
  assert.ok(!/\bwe\b/i.test(out.body), "the shop name must never be replaced by 'we'");
  assert.ok(
    !/(sadly|unfortunately|thank you|grateful|final|last day|forever|for good|sale|special)/i.test(all),
    "no reason, gratitude, urgency or permanent-closure language may be invented"
  );
});

// ---------------------------------------------------------------------------
// Regressions caught by an independent review of the fixes above.
// ---------------------------------------------------------------------------

test("deterministic notice: a day named AFTER an 'early' modifier still survives — JS alternation is leftmost-first, so a single combined pattern silently dropped it", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Harbor Blooms is closing early on Friday at 2:30.",
    shopName: "Harbor Blooms",
    shopPhone: "555-808-9090"
  });
  assert.match(out.headline, /Friday/, `the named day must reach the headline: ${out.headline}`);
  assert.match(out.body, /on Friday/, `the named day must reach the body: ${out.body}`);
  assert.match(out.body, /2:30/);
  assert.ok(!/\btoday\b/i.test(`${out.headline} ${out.body} ${out.caption}`));
});

test("deterministic notice: 'closing early this Saturday' keeps Saturday, not a fabricated today", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Harbor Blooms is closing early this Saturday.",
    shopName: "Harbor Blooms",
    shopPhone: "555-808-9090"
  });
  assert.match(out.headline, /Saturday/);
  assert.match(out.body, /this Saturday/);
});

test("deterministic notice: a FULL-day closure is never announced as an early closing — that would misstate the shop's hours", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Harbor Blooms is closed on Monday for inventory.",
    shopName: "Harbor Blooms",
    shopPhone: "555-808-9090"
  });
  assert.equal(out.headline, "Closed Monday");
  assert.match(out.body, /is closed on Monday/);
  assert.ok(!/closing early/i.test(`${out.headline} ${out.body}`), "a full-day closure must not read as 'Closing Early'");
  assert.ok(!/inventory/i.test(out.body), "the florist's internal reason must not be republished as customer copy");
});

test("deterministic notice: 'we are closed today' reads as closed, not as closing early (a pre-existing misstatement)", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "We are closed today.",
    shopName: "Harbor Blooms",
    shopPhone: "555-808-9090"
  });
  assert.equal(out.headline, "Closed Today");
  assert.equal(out.body, "Harbor Blooms is closed today.");
});

test("deterministic notice: an early closing WITH a time still reads as Closing Early, not Closed", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Harbor Blooms is closing at 2:30 today.",
    shopName: "Harbor Blooms",
    shopPhone: "555-808-9090"
  });
  assert.equal(out.headline, "Closing Early Today");
  assert.match(out.body, /closing at 2:30 today/);
});

test("deterministic notice: a shop's bare-digit stored phone is formatted for the CTA too, never printed raw as the flyer's largest contact text", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Harbor Blooms is closing at 2:30 today.",
    shopName: "Harbor Blooms",
    shopPhone: "16063319374"
  });
  assert.equal(out.cta, "Call 1-606-331-9374 to place an order.");
  assert.ok(!out.cta.includes("16063319374"), "the raw digit string must never reach the flyer");
  assert.ok(!out.caption.includes("16063319374"));
});

test("deterministic notice: a phone the florist typed for THIS request is preserved byte-for-byte and never reformatted", () => {
  const out = buildDeterministicNoticeContent({
    requestText: "Harbor Blooms is closing at 2:30 today. Call (606) 506-4039 to order.",
    shopName: "Harbor Blooms",
    shopPhone: "16063319374"
  });
  assert.match(out.cta, /\(606\) 506-4039/, "the florist's own formatting is a fact and must survive verbatim");
});

// ---------------------------------------------------------------------------
// ACCEPTANCE, through the real generate_content dispatch.
//
// Pinned to the canonical authenticated shop as it will actually be once
// the shop name is saved through Settings: name "Lilies in Bloom", and an
// EMPTY stored phone — which is the real state of that row, and the reason
// the flyer must take its number from the request text alone.
//
// This is real-handler verification, not the live browser test. It proves
// the server path produces exactly the required strings; it proves nothing
// about a live provider image.
// ---------------------------------------------------------------------------

const ACCEPTANCE_REQUEST =
  "Create today’s Facebook post with an image. Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.";

test("ACCEPTANCE (real dispatch): the canonical shop with an empty stored phone produces exactly the required headline, body, CTA and caption — and exactly one phone number, taken from the request", async () => {
  // No text responses queued on purpose: a plain operational notice must
  // reach the deterministic builder without any AI text call. If the
  // handler ever regressed to paraphrasing this request, it would try to
  // consume a copy response and fail loudly here.
  const mock = mockCloudflare([]);
  try {
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief: ACCEPTANCE_REQUEST, status: "idea" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook" }], error: null },
        { data: { marketing_monthly_budget_cents: null }, error: null },
        { data: null, error: null },
        // The real canonical row: a saved name, and phone genuinely empty.
        { data: { name: "Lilies in Bloom", phone: "", primary_color: "#8f3f68", accent_color: "#6f8f72" }, error: null },
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: [], error: null }, // grounded inventory
        { data: [], error: null }, // audience customers
        { data: [], error: null }, // audience orders
        // Exactly ONE usage insert: this request is a plain operational
        // notice, so both the caption and the flyer wording come from
        // buildDeterministicNoticeContent and NO AI text call is made at
        // all. (An AI-written post records two.) Verified by probing the
        // handler's real call sequence, not assumed.
        { data: null, error: null },
        { data: { id: "flyer-asset-1" }, error: null }, // persistGeneratedAsset
        { data: null, error: null }, // variant update
        { data: { id: "item-1", status: "draft" }, error: null } // final update
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `the acceptance request must succeed: ${res.body}`);

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const row = assetInsert.ops.find((op) => op[0] === "insert")[1][0];
    const c = row.content;

    // The four required visible strings, exactly.
    assert.equal(c.headline, "Closing Early Today");
    assert.equal(c.body, "Lilies in Bloom is closing at 2:30 today.");
    assert.equal(c.cta, "Call 606-506-4039 to place an order.");
    assert.equal(
      c.caption,
      "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order."
    );

    // One shop name, and it is the authenticated shop's.
    assert.equal(c.brand.shopName, "Lilies in Bloom");
    assert.ok(!/florisyn/i.test(`${c.headline} ${c.body} ${c.cta} ${c.caption} ${c.brand.shopName}`));

    // Exactly one phone number anywhere on the flyer: the requested one.
    // brand.phone is empty on this row, so the contact line adds no second
    // number — the defect where a flyer advertised two different numbers
    // cannot occur here.
    assert.ok(!c.brand.phone, "the empty stored phone must not become a second number on the flyer");
    const allText = `${c.headline} ${c.body} ${c.cta} ${c.caption} ${c.brand.phone || ""}`;
    const numbers = new Set((allText.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g) || []).map((n) => n.replace(/\D/g, "")));
    assert.equal(numbers.size, 1, `exactly one distinct phone number must appear, found: ${[...numbers].join(", ")}`);
    assert.equal([...numbers][0], "6065064039");

    // No invented content, and the shop name is never replaced by "we".
    assert.ok(!/\bwe\b/i.test(c.body));
    assert.ok(
      !/(sadly|unfortunately|thank you|grateful|final|last day|forever|for good|sale|special|reopen)/i.test(allText),
      "no reason, gratitude, urgency or permanent-closure language may be invented"
    );

    // The image model still never sees the business wording.
    const imageCalls = mock.calls.filter((x) => x.url.includes("black-forest-labs") || "prompt" in x.body);
    assert.equal(imageCalls.length, 1);
    assert.doesNotMatch(imageCalls[0].body.prompt, /2:30/);
    assert.doesNotMatch(imageCalls[0].body.prompt, /606-506-4039/);
    assert.doesNotMatch(imageCalls[0].body.prompt, /Lilies in Bloom/i);
  } finally {
    mock.restore();
  }
});

test("ACCEPTANCE (real dispatch): with the shop's own phone NOW saved, the flyer still shows exactly one phone number — the same one in the CTA and the contact line, never two", async () => {
  // The canonical shop as it reads in the live database after the shop
  // name and phone were saved through Settings: name "Lilies in Bloom",
  // phone "606-506-4039". The request names the same number, so the CTA
  // and the contact line agree and the contact line keeps it — the
  // two-different-numbers defect required them to DISAGREE.
  const mock = mockCloudflare([]);
  try {
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Closing early today", brief: ACCEPTANCE_REQUEST, status: "idea" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook" }], error: null },
        { data: { marketing_monthly_budget_cents: null }, error: null },
        { data: null, error: null },
        { data: { name: "Lilies in Bloom", phone: "606-506-4039", primary_color: "#8f3f68", accent_color: "#6f8f72" }, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: null },
        { data: { id: "flyer-asset-1" }, error: null },
        { data: null, error: null },
        { data: { id: "item-1", status: "draft" }, error: null }
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `must succeed: ${res.body}`);

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const c = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;

    assert.equal(c.headline, "Closing Early Today");
    assert.equal(c.body, "Lilies in Bloom is closing at 2:30 today.");
    assert.equal(c.cta, "Call 606-506-4039 to place an order.");
    assert.equal(c.caption, "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.");
    assert.equal(c.brand.shopName, "Lilies in Bloom");
    assert.equal(c.brand.phone, "606-506-4039");

    // One distinct number across every customer-facing field on the flyer.
    const allText = `${c.headline} ${c.body} ${c.cta} ${c.caption} ${c.brand.phone}`;
    const numbers = new Set((allText.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g) || []).map((n) => n.replace(/\D/g, "")));
    assert.equal(numbers.size, 1, `exactly one distinct number, found: ${[...numbers].join(", ")}`);
    assert.equal([...numbers][0], "6065064039");

    // Exactly one shop name, and it is the authenticated shop's own.
    assert.ok(!/florisyn/i.test(allText));
    assert.ok(!/\bwe\b/i.test(c.body));
  } finally {
    mock.restore();
  }
});
