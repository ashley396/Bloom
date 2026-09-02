import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildDeterministicNoticeContent,
  buildDeterministicCreativeRescueContent,
  requestSignalsPlainOperationalNotice
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

/**
 * Live-found regression: "Create today's Facebook post for Lilies in
 * Bloom" — an ordinary creative request — came back as "Store Notice /
 * Lilies in Bloom has an update for you," a split "magazine" layout with a
 * hardcoded "Need flowers for:" occasion list (including a sympathy/
 * funeral bullet), and a "Thank you for supporting local" badge — none of
 * it from the request, the AI, or the canonical concept.
 *
 * Root cause (see PART 5/8 of the live diagnosis): window.FlorisynFlyerPoster
 * (an unrelated, older poster-maker tool) ran FIRST for every Marketing
 * Studio flyer and drew its own hardcoded decorative filler, and
 * buildDeterministicNoticeContent — meant only for real operational
 * notices — was being used as the universal safety-net rescue for ANY
 * rejected creative draft.
 *
 * This is a regression-repair patch only: it stops the confirmed-wrong
 * legacy behavior. It is explicitly NOT Ashley's final ChatGPT-style
 * flyer creative-quality architecture (see marketing-studio-shop-ui.js's
 * own comment at the fixed call site).
 */

const shopUiSource = fs.readFileSync(
  path.join(process.cwd(), "public/marketing-studio-shop-ui.js"),
  "utf8"
);
const marketingStudioSource = fs.readFileSync(
  path.join(process.cwd(), "netlify/functions/marketing-studio.js"),
  "utf8"
);

test("the exact live failure request is NOT classified as a plain operational notice", () => {
  assert.equal(requestSignalsPlainOperationalNotice("Create today's Facebook post for Lilies in Bloom"), false);
});

test("buildDeterministicCreativeRescueContent never produces Store Notice / operational-notice framing", () => {
  const rescue = buildDeterministicCreativeRescueContent({
    shopName: "Lilies in Bloom",
    shopPhone: "6065064039",
    ctaIntent: "call_shop"
  });
  for (const field of [rescue.headline, rescue.body, rescue.cta, rescue.caption]) {
    assert.doesNotMatch(field, /store notice/i);
    assert.doesNotMatch(field, /has an update for you/i);
  }
});

test("buildDeterministicCreativeRescueContent never invents species, inventory, availability, promotions, or occasions", () => {
  // A shop name deliberately free of any flower-species word, so this test
  // isolates what the FUNCTION invents from what a real shop name legitimately says.
  const rescue = buildDeterministicCreativeRescueContent({ shopName: "Riverside Florist", shopPhone: "6065064039" });
  const joined = `${rescue.headline} ${rescue.body} ${rescue.cta} ${rescue.caption}`;
  assert.doesNotMatch(joined, /\b(lily|lilies|rose|roses|tulip|orchid|carnation|hydrangea)\b/i);
  assert.doesNotMatch(joined, /open today|available today|fresh today|in stock|newly arrived|just arrived/i);
  assert.doesNotMatch(joined, /\b(sale|% off|percent off|discount|promo|coupon|deal)\b/i);
  assert.doesNotMatch(joined, /\b(birthday|anniversary|new baby|wedding|graduation)\b/i);
});

// Safety correction: "Stop by anytime." — the original no-safe-CTA
// fallback — implies the shop is open and available for walk-in business
// right now, with zero hours/open-state evidence behind it. Removed
// entirely; the CTA is omitted instead of replaced with any other
// visit/open-state phrase.
test("buildDeterministicCreativeRescueContent never invents any visit/open-state implication, in the CTA or anywhere else", () => {
  const FORBIDDEN_OPEN_STATE_RE =
    /open now|open today|visit today|stop by anytime|come see us|available today|walk-ins? welcome|swing by|drop in|drop by/i;

  // No phone at all — the CTA must be omitted, not replaced with a
  // location/open-state claim.
  const noPhone = buildDeterministicCreativeRescueContent({ shopName: "Riverside Florist", shopPhone: null });
  assert.equal(noPhone.cta, "", "with no safe verified CTA, the CTA must be omitted, never invented");
  assert.equal(noPhone.caption, noPhone.body, "the caption must not append any invented CTA sentence either");
  assert.doesNotMatch(`${noPhone.headline} ${noPhone.body} ${noPhone.cta} ${noPhone.caption}`, FORBIDDEN_OPEN_STATE_RE);

  // A phone exists, but the established CTA intent isn't call_shop — still
  // no safe CTA to offer, so it's still omitted, not swapped for an
  // open-state phrase.
  const wrongIntent = buildDeterministicCreativeRescueContent({ shopName: "Riverside Florist", shopPhone: "6065064039", ctaIntent: "visit_shop" });
  assert.equal(wrongIntent.cta, "");
  assert.doesNotMatch(`${wrongIntent.headline} ${wrongIntent.body} ${wrongIntent.cta} ${wrongIntent.caption}`, FORBIDDEN_OPEN_STATE_RE);

  // The one safe case (verified phone + call_shop) is unaffected by this
  // correction — still a real call CTA, never a location claim.
  const safe = buildDeterministicCreativeRescueContent({ shopName: "Riverside Florist", shopPhone: "6065064039", ctaIntent: "call_shop" });
  assert.equal(safe.cta, "Call 606-506-4039 to place an order.");
  assert.doesNotMatch(`${safe.headline} ${safe.body} ${safe.cta} ${safe.caption}`, FORBIDDEN_OPEN_STATE_RE);
});

test("buildDeterministicCreativeRescueContent never introduces bereavement language, unconditionally", () => {
  // Even given a shop name/phone with nothing to hint otherwise, this
  // rescue must NEVER be the source of sympathy/funeral wording — that
  // belongs only to the primary AI/evaluation path, never a template.
  const rescue = buildDeterministicCreativeRescueContent({ shopName: "Lilies in Bloom", shopPhone: "6065064039" });
  const joined = `${rescue.headline} ${rescue.body} ${rescue.cta} ${rescue.caption}`;
  assert.doesNotMatch(joined, /\b(sympathy|funeral|casket|bereavement|condolence|memorial|tribute|standing spray)\b/i);
});

test("buildDeterministicCreativeRescueContent offers a call CTA only when ctaIntent allows it or none was supplied", () => {
  const noConcept = buildDeterministicCreativeRescueContent({ shopName: "Lilies in Bloom", shopPhone: "6065064039" });
  assert.match(noConcept.cta, /^Call 606-506-4039/);

  const callShop = buildDeterministicCreativeRescueContent({ shopName: "Lilies in Bloom", shopPhone: "6065064039", ctaIntent: "call_shop" });
  assert.match(callShop.cta, /^Call 606-506-4039/);

  const notCallShop = buildDeterministicCreativeRescueContent({ shopName: "Lilies in Bloom", shopPhone: "6065064039", ctaIntent: "visit_store" });
  assert.equal(notCallShop.cta, "", "no safe CTA available here — must be omitted, not replaced with an invented phrase");
});

test("buildDeterministicNoticeContent (the operational rescue) is unchanged and still correct for a true notice", () => {
  const notice = buildDeterministicNoticeContent({
    requestText: "We are closing at 3:00 PM today. Call 606-506-4039.",
    shopName: "Lilies in Bloom",
    shopPhone: "6065064039"
  });
  assert.ok(notice);
  assert.match(notice.body, /closing at 3:00 ?pm/i);
  assert.match(notice.cta, /606-506-4039/);
});

test("marketing-studio.js's two creative-rescue call sites use the creative rescue, never the notice rescue", () => {
  // Both call sites are structurally guaranteed to already be in the
  // non-operational branch (the operational `if (noticeFallback)` /
  // `if (nf) {...}` branches return/exit before either of these run) —
  // this asserts the fix is actually wired to the right function.
  const rescueCallSites = marketingStudioSource.match(/const (?:rescueFallback|flyerFallback) = buildDeterministic\w+\(/g) || [];
  assert.equal(rescueCallSites.length, 2, "expected exactly the caption and flyer rescue call sites");
  for (const call of rescueCallSites) {
    assert.match(call, /buildDeterministicCreativeRescueContent\(/);
  }
  // The gated, TRUE-operational-notice path must still exist, unchanged.
  assert.match(marketingStudioSource, /requestSignalsPlainOperationalNotice\(currentItem\.data\.brief\)\s*\n\s*\?\s*buildDeterministicNoticeContent\(/);
});

test("Marketing Studio's flyer render path no longer calls the legacy poster renderer", () => {
  // Explanatory comments may still name FlorisynFlyerPoster (why it was
  // removed) — what must never exist again is actually USING it: an
  // assignment off it or a call into its renderPoster().
  assert.doesNotMatch(shopUiSource, /=\s*window\.FlorisynFlyerPoster/);
  assert.doesNotMatch(shopUiSource, /\.renderPoster\(/);
  assert.doesNotMatch(shopUiSource, /composition:\s*.*subject_forward.*magazine/s);
  assert.match(shopUiSource, /window\.FlorisynFlyerRenderer\.renderFlyer\(/);
});

// Independent-review fix: the flyer's own creative rescue used to gate its
// CTA on a `ctaIntent` field that was always undefined (dead code) — always
// defaulting to "offer a call CTA whenever a phone exists," regardless of
// what the post's real, already-established CTA intent actually was. Fixed
// by classifying the caption's real (successful) CTA text and threading it
// through. This test proves it end to end through the real handler: the
// caption succeeds with a "visit us" CTA (never call_shop); the flyer's own
// on-image text then independently mismatches the concept and gets
// rescued — the rescue must respect the established visit_shop intent and
// never silently swap in a phone-call CTA the post was never about.
function mockCloudflareCtaIntent(textJsonQueue) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const queue = [...textJsonQueue];
  globalThis.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    if ("image" in body) {
      return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean" } }) };
    }
    if (String(url).includes("black-forest-labs") || "prompt" in body) {
      return { ok: true, json: async () => ({ success: true, result: { image: "ZmFrZS1pbWFnZS1ieXRlcw==" } }) };
    }
    const next = queue.length ? queue.shift() : textJsonQueue[textJsonQueue.length - 1];
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(next) } }) };
  };
  return { restore: () => (globalThis.fetch = originalFetch) };
}

test("the flyer rescue's CTA respects the post's own established CTA intent — it must never swap in a phone-call CTA for a 'visit us' post just because a phone happens to exist", async () => {
  const cleanCaption = {
    platform: "facebook",
    headline: "Come See Us",
    body: "Our garden roses are looking gorgeous this week.",
    cta: "Visit us in person to see them.",
    visual_brief: "A bright bouquet of garden roses.",
    creative_brief: { primary_subject: "A bright bouquet of garden roses", mood: "cheerful", lighting: "natural", composition: "close-up", floral_style: "garden-style" },
    objective: "awareness",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  };
  // Mismatches the caption's own established subject (roses) on both the
  // first attempt and the retry, so it survives to the final rescue.
  const mismatchedFlyer = { headline: "Beautiful Tulips", body: "Fresh tulips for spring.", cta: "Visit us today" };
  const mock = mockCloudflareCtaIntent([cleanCaption, mismatchedFlyer, mismatchedFlyer]);
  try {
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-cta1", content_type: "image_post", title: "Today's post", brief: "Create today's Facebook post", status: "idea" }, error: null },
        { data: [{ id: "item-cta1", status: "generating" }], error: null }, // Batch 3: atomic claim
        { data: [{ id: "variant-cta1", platform: "facebook" }], error: null },
        { data: { marketing_monthly_budget_cents: null }, error: null },
        { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null }, // a real phone IS on file
        { data: null, error: null },
        { data: null, error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: null }, // recordUsage("copy") — caption
        { data: null, error: null }, // recordUsage("copy") — flyer attempt 1
        { data: null, error: null }, // recordUsage("copy") — flyer retry (still mismatched)
        { data: { id: "usage-img-1" }, error: null },
        { data: null, error: null },
        { data: { id: "usage-vision-1" }, error: null },
        { data: null, error: null },
        { data: { id: "media-cta1" }, error: null },
        { data: { id: "flyer-asset-cta1" }, error: null },
        { data: null, error: null },
        { data: { id: "item-cta1", status: "draft" }, error: null }
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    const handler = createMarketingStudioHandler({ florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } });
    const res = await handler({
      httpMethod: "POST",
      queryStringParameters: { action: "generate_content" },
      headers: {},
      body: JSON.stringify({ action: "generate_content", content_item_id: "item-cta1", photo_choice: "generate" })
    });
    assert.equal(res.statusCode, 200, `expected the mismatch to rescue, not fail: ${res.body}`);

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const insertedContent = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.doesNotMatch(`${insertedContent.headline} ${insertedContent.body}`, /tulip/i, "the mismatched content must never survive to the flyer");
    assert.equal(insertedContent.creative_rescue_used, true);
    // The real bug this proves fixed: a phone exists, but the post's own
    // real CTA intent (classified from the caption's actual "Visit us in
    // person" text) is visit_shop, not call_shop — the rescue must not
    // silently swap in a phone-call CTA the post was never about.
    assert.doesNotMatch(insertedContent.cta, /606-506-4039/, "a visit-us post's rescue must never invent a phone-call CTA");
    // No safe CTA is available (a phone exists, but the established
    // intent isn't call_shop) — omitted, never replaced with an invented
    // visit/open-state phrase.
    assert.equal(insertedContent.cta, "");
  } finally {
    mock.restore();
  }
});

test("flyer-poster.js itself is untouched and still wired into its own unrelated feature pages", () => {
  const posterSource = fs.readFileSync(path.join(process.cwd(), "public/flyer-poster.js"), "utf8");
  assert.match(posterSource, /Need flowers for:/);
  assert.match(posterSource, /A sympathy or funeral tribute/);
  const indexHtml = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  const posterPreviewHtml = fs.readFileSync(path.join(process.cwd(), "public/poster-preview.html"), "utf8");
  assert.match(indexHtml, /flyer-poster\.js/);
  assert.match(posterPreviewHtml, /flyer-poster\.js/);
});
