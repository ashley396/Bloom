import test from "node:test";
import assert from "node:assert/strict";
import { hasNoDrawableTextSlots, buildDeterministicCreativeDirection, GRAPHIC_TEXT_SLOTS_DEFAULT } from "../netlify/functions/_shared/marketing-creative-direction.js";
import { buildCanonicalConcept } from "../netlify/functions/_shared/marketing-canonical-concept.js";
import { requestNeedsFlyerWording, requestSignalsPlainOperationalNotice, evaluateMarketingOutput, BEREAVEMENT_CONTEXT_RE } from "../netlify/functions/_shared/marketing-content-revision.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// ---------------------------------------------------------------------------
// Photo-forward flyer-wording elimination (2026-09-12).
//
// The live Test C pass (item 939a3a53) spent 2 Cloudflare calls on the
// caption (attempt + bounded retry), 1 OpenAI call on the image, and 2
// MORE Cloudflare calls on on-image flyer wording — for a post whose
// resolved Creative Direction had every graphic text slot off, so the
// renderer could never draw a word of it. That wording was rejected,
// fell back to deterministic text, and was persisted but never rendered.
//
// This file proves the narrow fix: when the branch's own deterministic
// Direction has no drawable text slot, the wording provider path is
// skipped entirely — no call, no retry, no fallback wording — while every
// designed flyer (any slot on) and the operational-notice deterministic
// path keep the existing wording path unchanged, and caption/image
// generation are untouched.
// ---------------------------------------------------------------------------

const SHOP = "Lilies in Bloom";
const PHONE = "606-506-4039";
const TEST_C_BRIEF = "Create a Facebook post encouraging people to send flowers today.";
const PROMO_BRIEF = "Create a flyer: 20% off all bouquets this Saturday only.";
const NOTICE_BRIEF = "We are closing early at 3 PM today.";
// Subject-forward branch WITH drawable text: no exact facts (so not the
// exact-facts branch), holiday_seasonal → seasonal_feature (brand/headline/
// supporting on). This is the one case that proves the guard leaves the
// wording call alone on the very branch it lives in.
const SEASONAL_BRIEF = "Create a Facebook post for our Valentine's Day bouquets.";

const SOCIAL_MARKER = "You are writing the ACTUAL, FINISHED social media post";
const FLYER_MARKER = "FINISHED text content for a flyer";

const GOOD_CAPTION = "Your sister just finished her first week at a new job. A bouquet showing up on her doorstep today says more than a text ever could.";
const HOLLOW_CAPTION =
  "Sending flowers is a wonderful way to show someone you care. It's a gesture that speaks volumes and brightens any day. There's no better time than now to let someone special know you're thinking of them.";

function conceptFor(brief, { photoStrategy, ctaText = null } = {}) {
  const isSympathy = BEREAVEMENT_CONTEXT_RE.test(brief);
  return buildCanonicalConcept({
    requestText: brief,
    occasionTitle: brief,
    platform: "facebook",
    contentType: "image_post",
    assetType: "flyer",
    objective: "awareness",
    ctaText,
    bodyText: "",
    isSympathy,
    photoStrategy: photoStrategy || (requestNeedsFlyerWording(brief) ? "calm_backdrop" : "subject_forward"),
    styleTier: "generated"
  });
}
function directionFor(brief, opts) {
  return buildDeterministicCreativeDirection({ canonicalConcept: conceptFor(brief, opts), shopBrand: {} });
}

// ---------------------------------------------------------------------------
// The predicate.
// ---------------------------------------------------------------------------

test("hasNoDrawableTextSlots: true only when every slot in GRAPHIC_TEXT_SLOTS_DEFAULT is explicitly false; unknown or partial maps are never treated as text-free", () => {
  const allOff = Object.fromEntries(Object.keys(GRAPHIC_TEXT_SLOTS_DEFAULT).map((k) => [k, false]));
  assert.equal(hasNoDrawableTextSlots({ graphicTextSlots: allOff }), true);
  assert.equal(hasNoDrawableTextSlots({ graphicTextSlots: { ...allOff, headline: true } }), false);
  assert.equal(hasNoDrawableTextSlots({ graphicTextSlots: { ...allOff, serviceDetail: true } }), false, "serviceDetail counts even though no renderer draws it yet");
  const { serviceDetail, ...missingOne } = allOff;
  assert.equal(hasNoDrawableTextSlots({ graphicTextSlots: missingOne }), false, "a missing slot is not proof it is off");
  assert.equal(hasNoDrawableTextSlots({}), false);
  assert.equal(hasNoDrawableTextSlots(null), false);
});

test("real directions: Test C, birthday and sympathy SUBJECT-FORWARD posts are text-free; seasonal, promo, notice and any calm-backdrop designed flyer are not", () => {
  assert.equal(requestNeedsFlyerWording(SEASONAL_BRIEF), false, "sanity: the seasonal brief stays on the subject-forward branch");
  assert.equal(directionFor(SEASONAL_BRIEF).occasionTreatment, "seasonal_feature");
  assert.equal(hasNoDrawableTextSlots(directionFor(SEASONAL_BRIEF)), false);
  assert.equal(hasNoDrawableTextSlots(directionFor(TEST_C_BRIEF)), true);
  assert.equal(directionFor(TEST_C_BRIEF).occasionTreatment, "photo_forward_social");
  assert.equal(hasNoDrawableTextSlots(directionFor("Create a birthday Facebook post for a friend turning 40.")), true);
  assert.equal(hasNoDrawableTextSlots(directionFor("Create a gentle Facebook post letting families know we can help with funeral flowers.")), true);
  assert.equal(hasNoDrawableTextSlots(directionFor(PROMO_BRIEF)), false);
  assert.equal(hasNoDrawableTextSlots(directionFor(NOTICE_BRIEF)), false);
  // The same everyday request as a genuine designed flyer keeps its text.
  assert.equal(hasNoDrawableTextSlots(directionFor(TEST_C_BRIEF, { photoStrategy: "calm_backdrop" })), false);
});

test("the wording-free probe decides the same thing as the persisted direction: ctaText never changes the photo-forward slot map", () => {
  const withoutCta = directionFor(TEST_C_BRIEF);
  const withCta = directionFor(TEST_C_BRIEF, { ctaText: `Call ${PHONE} to place an order.` });
  assert.deepEqual(withCta.graphicTextSlots, withoutCta.graphicTextSlots);
  assert.equal(withCta.occasionTreatment, withoutCta.occasionTreatment);
  assert.equal(hasNoDrawableTextSlots(withCta), true);
});

// ---------------------------------------------------------------------------
// Real handler runs.
// ---------------------------------------------------------------------------

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function responsesFor(brief) {
  const fixed = [
    { data: { id: "item-1", content_type: "image_post", title: brief, brief, status: "idea" }, error: null },
    { data: [{ id: "item-1", status: "generating" }], error: null },
    { data: [{ id: "variant-1", platform: "facebook" }], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: { name: SHOP, phone: PHONE, logo_url: null }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null }
  ];
  const filler = Array.from({ length: 26 }, (_, i) => ({ data: { id: `x${i}` }, error: null }));
  return [...fixed, ...filler];
}

/** Runs generate_content with a fetch mock that answers the social task,
 * the flyer task, and the image model separately, and records every
 * provider call by which task it carried. */
async function runGenerate(brief, { captionBodies = [GOOD_CAPTION], flyerCopy = { headline: "Saturday Only", body: "Twenty percent off every bouquet this Saturday at Lilies in Bloom.", cta: `Call ${PHONE}.` } } = {}) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const calls = { social: 0, flyer: 0, image: 0, other: 0 };
  globalThis.fetch = async (url, options) => {
    const body = String(options?.body || "");
    if (String(url).includes("flux")) {
      calls.image++;
      return { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("fake-jpeg-bytes").toString("base64") } }) };
    }
    if (body.includes(SOCIAL_MARKER)) {
      const text = captionBodies[Math.min(calls.social, captionBodies.length - 1)];
      calls.social++;
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: {
            response: JSON.stringify({
              platform: "facebook",
              headline: "Sent With Thought",
              body: text,
              cta: "",
              visual_brief: "a lush arrangement of mixed fresh flowers on a marble counter",
              hashtags: [],
              asset_requirements: [],
              brand_traits_used: [],
              visual_traits_used: []
            })
          }
        })
      };
    }
    if (body.includes(FLYER_MARKER)) {
      calls.flyer++;
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(flyerCopy) } }) };
    }
    calls.other++;
    return { ok: true, json: async () => ({ success: true, result: { response: "{}" } }) };
  };
  try {
    const storage = createFakeSupabaseStorage({});
    const client = createFakeSupabaseClient(responsesFor(brief), { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const copyUsageInserts = client.calls.filter((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert" && op[1][0]?.purpose === "copy"));
    return { res, body: JSON.parse(res.body), calls, client, content: assetInsert?.payload?.content || null, copyUsageInserts };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("1 — photo-forward social with every text slot off makes ZERO flyer-wording provider calls, records no flyer-wording usage, and persists no fallback wording", async () => {
  const { res, body, calls, content, copyUsageInserts } = await runGenerate(TEST_C_BRIEF);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.flyer, 0, "no on-image wording call may be made for a text-free photo-forward post");
  assert.equal(calls.social, 1, "the accepted caption took exactly one call");
  assert.ok(calls.image >= 1, "image generation still happens (its own bounded quality retry is untouched)");
  assert.equal(copyUsageInserts.length, 1, "only the caption attempt recorded copy usage — nothing charged for a call that never happened");
  assert.equal(body.copy.body, GOOD_CAPTION, "caption copy is untouched");
  assert.equal(body.copy.creative_rescue_used, undefined);
  assert.ok(content, "the asset was persisted");
  assert.equal(content.creative_direction.occasionTreatment, "photo_forward_social");
  assert.equal(hasNoDrawableTextSlots(content.creative_direction), true, "the persisted direction agrees with the pre-wording probe");
  assert.equal(content.headline, "");
  assert.equal(content.body, "");
  assert.equal(content.cta, "");
  assert.equal(content.on_image_wording_skipped, "photo_forward_no_text_slots");
  assert.equal(content.creative_rescue_used, undefined, "no deterministic fallback wording was manufactured");
  // The photo path itself is untouched: still a subject-forward photo asset.
  assert.equal(content.photo_strategy, "subject_forward");
  assert.equal(content.creative_direction.graphicTextSlots.headline, false);
});

test("4 — a rejected first caption still gets its one bounded retry (caption max unchanged at 2) and the wording path is still skipped", async () => {
  const { res, calls, copyUsageInserts, body } = await runGenerate(TEST_C_BRIEF, { captionBodies: [HOLLOW_CAPTION, GOOD_CAPTION] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.social, 2, "attempt plus one bounded retry — the caption budget is unchanged");
  assert.equal(calls.flyer, 0);
  assert.equal(copyUsageInserts.length, 2, "exactly the two caption attempts recorded copy usage");
  assert.equal(body.copy.body, GOOD_CAPTION);
});

test("2 — an operational-notice designed flyer keeps the existing deterministic wording path: real on-image wording, no AI wording call (as before)", async () => {
  assert.equal(Boolean(requestSignalsPlainOperationalNotice(NOTICE_BRIEF)), true, "sanity: this is the deterministic-notice path");
  const { res, calls, content } = await runGenerate(NOTICE_BRIEF);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.flyer, 0, "the notice path never called the wording model before this change either");
  assert.ok(content, "the asset was persisted");
  assert.ok(String(content.headline || "").length > 0, "the notice's deterministic on-image headline is still present");
  assert.ok(String(content.body || "").length > 0, "and its on-image body");
  assert.equal(content.on_image_wording_skipped, undefined);
  assert.equal(hasNoDrawableTextSlots(content.creative_direction), false);
});

test("3b — SUBJECT-FORWARD post with drawable text (seasonal) still makes the wording call on the very branch the guard lives in, and persists real wording", async () => {
  const { res, calls, content } = await runGenerate(SEASONAL_BRIEF, { flyerCopy: { headline: "Valentine's Day Bouquets", body: "Hand-tied Valentine's bouquets from Lilies in Bloom.", cta: "" } });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(calls.flyer >= 1 && calls.flyer <= 2, `the wording call happens (attempt + at most one retry): ${calls.flyer}`);
  assert.ok(content, "the asset was persisted");
  assert.equal(content.photo_strategy, "subject_forward", "same branch as the photo-forward case");
  assert.equal(content.creative_direction.occasionTreatment, "seasonal_feature");
  assert.equal(hasNoDrawableTextSlots(content.creative_direction), false);
  assert.ok(String(content.headline || "").length > 0, "real on-image wording persisted for the drawable headline slot");
  assert.equal(content.on_image_wording_skipped, undefined);
});

test("3 — a mixed-slot designed flyer (headline/brand/supporting on, cta/phone off) on the exact-facts branch (untouched by this change) still uses the existing AI wording path and persists real wording", async () => {
  assert.equal(requestNeedsFlyerWording(PROMO_BRIEF), true, "sanity: a priced, dated offer is a designed flyer");
  // No CTA in the wording so the CTA/phone slots resolve off — a genuinely
  // mixed layout: headline/brand/supporting on, cta/phone off.
  const { res, calls, content } = await runGenerate(PROMO_BRIEF, { flyerCopy: { headline: "Saturday Only", body: "Twenty percent off every bouquet this Saturday at Lilies in Bloom.", cta: "" } });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(calls.flyer >= 1, "a designed flyer still generates its on-image wording");
  assert.ok(calls.flyer <= 2, "and still never more than attempt + one bounded retry");
  assert.ok(content, "the asset was persisted");
  const slots = content.creative_direction.graphicTextSlots;
  assert.equal(slots.headline, true);
  assert.equal(slots.cta, false);
  assert.equal(slots.phone, false);
  assert.equal(hasNoDrawableTextSlots(content.creative_direction), false);
  assert.ok(String(content.headline || "").length > 0, "real wording persisted for the drawable headline slot");
  assert.equal(content.on_image_wording_skipped, undefined);
});

test("5 — the skip is decided per request on the SAME branch: the handler makes the wording call for a seasonal subject-forward post and skips it for a text-free one, with identical caption and image behavior", async () => {
  const photoForward = await runGenerate(TEST_C_BRIEF);
  const designed = await runGenerate(SEASONAL_BRIEF, { flyerCopy: { headline: "Valentine's Day Bouquets", body: "Hand-tied Valentine's bouquets from Lilies in Bloom.", cta: "" } });
  assert.equal(photoForward.calls.flyer, 0);
  assert.ok(designed.calls.flyer >= 1);
  assert.equal(photoForward.calls.social, designed.calls.social, "caption generation is identical on both paths");
  // "other" is the image quality-check (vision) call the image path makes
  // on both branches — it is neither caption nor wording, and unchanged.
  assert.equal(photoForward.calls.other, designed.calls.other, "the vision quality-check calls are identical on both paths");
});

test("6 — a RESCUED caption on a text-free post also skips the wording path: no provider call and no deterministic on-image wording that could never render", async () => {
  const { res, body, calls, content } = await runGenerate(TEST_C_BRIEF, { captionBodies: [HOLLOW_CAPTION, HOLLOW_CAPTION] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.social, 2, "attempt plus one bounded retry");
  assert.equal(body.copy.creative_rescue_used, true, "the caption itself was rescued (both attempts hollow)");
  assert.equal(calls.flyer, 0);
  assert.ok(content, "the asset was persisted");
  assert.equal(content.on_image_wording_skipped, "photo_forward_no_text_slots");
  assert.equal(content.headline, "");
  assert.equal(content.body, "");
  assert.equal(content.creative_rescue_used, undefined, "no deterministic on-image wording was manufactured from the caption rescue");
});

test("sympathy wording rules are unchanged: a sympathy DESIGNED flyer's on-image body may still name the actual pieces (standing sprays, casket flowers)", () => {
  // Restores the proof REGRESSION D used to carry at the handler level for
  // a subject-forward sympathy post (now text-free, so it has no on-image
  // wording): the evaluator itself still allows real sympathy pieces.
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Flowers for the Smith family, they just lost their dad",
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { audience: "funeral_families", isSympathy: true, occasionCategory: "sympathy" },
    candidate: { headline: "With Sympathy", body: "Standing sprays and casket flowers, made with care.", cta: "Call to arrange" },
    component: "flyer_text"
  });
  assert.equal(result.decision, "pass", `sympathy pieces must remain allowed: ${JSON.stringify(result.reasons)}`);
  assert.match(result.safeCandidate.body, /standing sprays and casket flowers/i);
});
