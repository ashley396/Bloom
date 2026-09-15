import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { recordingContext } from "./helpers/poster-recording-context.mjs";

/**
 * Test D renderer layout fix (live asset 701b449e, 2026-09-15).
 *
 * The live failure: banner_led + headline_plus_support with NO CTA slot
 * handed the entire 680px stack to the lone supporting line, which
 * drawTypographyRole then sized from that height — a 147px, seven-line
 * block painted through the headline ribbon and off the bottom edge, with
 * a canvas-sized band behind it. The same single-role expansion is reached
 * whenever the CTA is suppressed by its 30-character fail-safe.
 *
 * These tests run the REAL renderFlyerWithCreativeDirection path in a vm
 * sandbox with a recording 2D context (synthetic 0.52em glyph widths — a
 * GEOMETRY check, exactly like tests/flyer-poster.test.js; real type is
 * inspected in a browser separately). Every rect below is recomputed from
 * the renderer's own exported geometry helpers, never hand-typed.
 */

const root = process.cwd();
const W = 1080, H = 1080;

function makeCanvasFactory(created) {
  return function createElement(tag) {
    if (tag !== "canvas") throw new Error(`unexpected createElement(${tag})`);
    const canvas = { width: 0, height: 0, dataset: {} };
    let ctx = null;
    canvas.getContext = function () {
      if (ctx) return ctx;
      const base = recordingContext(canvas.width, canvas.height);
      let imageData = null;
      base.getImageData = function (x, y, w, h) {
        // A calm, light, uniform "photo": legibility sampling sees no busy
        // patch, so no banner-behind-busy band is requested — the layout
        // decisions under test are purely geometric.
        if (!imageData || imageData.width !== w || imageData.height !== h) {
          imageData = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(236) };
        }
        return imageData;
      };
      base.canvas = canvas;
      ctx = new Proxy(base, {
        get(target, prop) {
          if (prop in target) return target[prop];
          return function () {};
        }
      });
      return ctx;
    };
    created.push(canvas);
    return canvas;
  };
}

class FakeImage {
  set src(value) {
    this._src = value;
    setTimeout(() => {
      this.naturalWidth = 1024;
      this.naturalHeight = 1024;
      this.width = 1024;
      this.height = 1024;
      if (typeof this.onload === "function") this.onload();
    }, 0);
  }
  get src() { return this._src; }
}

function loadRenderer() {
  const created = [];
  const sandbox = {
    module: { exports: {} },
    globalThis: {},
    setTimeout,
    clearTimeout,
    console,
    Image: FakeImage,
    document: { createElement: makeCanvasFactory(created) }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/flyer-renderer.js"), "utf8"), sandbox);
  return { R: sandbox.module.exports, created };
}

const BRAND = { shopName: "Lilies in Bloom", phone: "606-506-4039", primaryColor: "#b93870", accentColor: "#6f8f72", logoUrl: null };
const LIMITS = { headlineMaxChars: 42, supportingLineMaxChars: 60, serviceDetailMaxChars: 70, ctaMaxChars: 30 };
const HEAD = "20% Off Bouquets This Weekend";

/** The live asset's creative direction, verbatim shape (banner_led, ribbon
 * banner at the top, oversized headline, no CTA slot). */
function bannerLed(overrides = {}) {
  return {
    version: 2, imageCrop: "medium", badgeStyle: "ribbon_badge", imageScale: "balanced", textRegion: "banner", visualMood: "bold_celebratory",
    bannerStyle: "ribbon_banner", borderStyle: "hairline", paletteMood: "classic_brand", textDensity: "standard", dividerStyle: "floral_sprig",
    brandingScale: "standard", ctaProminence: "none", headlineScale: "oversized", hierarchyDepth: "headline_plus_support", imagePlacement: "framed_block",
    brandIdentifier: "shop_name", decorativeMotif: "leaf_accents", brandingPosition: "top_center",
    graphicTextSlots: { cta: false, brand: true, phone: false, headline: true, serviceDetail: false, supportingLine: true },
    subjectPlacement: "center", compositionFamily: "banner_led", graphicTextLimits: LIMITS, occasionTreatment: "promotional_feature",
    ornamentalDensity: "moderate", scriptAccentUsage: "accent_word", backgroundTreatment: "framed_photo_block", decorativeRestraint: "disciplined",
    negativeSpaceStrategy: "moderate", typographyPersonality: "bold_display",
    ...overrides
  };
}
const WITH_CTA = { hierarchyDepth: "headline_support_cta", ctaProminence: "strong", graphicTextSlots: { cta: true, brand: true, phone: true, headline: true, serviceDetail: false, supportingLine: true } };
const NOTICE = {
  version: 2, imageCrop: "medium", badgeStyle: "none", imageScale: "supporting", textRegion: "dedicated_panel", visualMood: "warm_inviting", bannerStyle: "none",
  borderStyle: "hairline", paletteMood: "classic_brand", textDensity: "dense", dividerStyle: "simple_rule", brandingScale: "standard", ctaProminence: "standard",
  headlineScale: "large", hierarchyDepth: "headline_support_cta", imagePlacement: "inset_panel", brandIdentifier: "shop_name", decorativeMotif: "leaf_accents",
  brandingPosition: "top_center", graphicTextSlots: { cta: true, brand: true, phone: true, headline: true, serviceDetail: false, supportingLine: true },
  subjectPlacement: "center", compositionFamily: "framed_panel", graphicTextLimits: LIMITS, occasionTreatment: "operational_notice", ornamentalDensity: "light",
  scriptAccentUsage: "none", backgroundTreatment: "framed_photo_block", decorativeRestraint: "disciplined", negativeSpaceStrategy: "minimal", typographyPersonality: "clean_sans"
};
const PHOTO_FORWARD = {
  version: 2, imageCrop: "medium", badgeStyle: "none", imageScale: "dominant", textRegion: "negative_space_band_lower", visualMood: "warm_inviting", bannerStyle: "none",
  borderStyle: "none", paletteMood: "classic_brand", textDensity: "sparse", dividerStyle: "none", brandingScale: "subtle", ctaProminence: "none", headlineScale: "standard",
  hierarchyDepth: "headline_only", imagePlacement: "full_bleed", brandIdentifier: "shop_name", decorativeMotif: "none", brandingPosition: "top_center",
  graphicTextSlots: { cta: false, brand: false, phone: false, headline: false, serviceDetail: false, supportingLine: false }, subjectPlacement: "center",
  compositionFamily: "hero_full_bleed", graphicTextLimits: LIMITS, occasionTreatment: "photo_forward_social", ornamentalDensity: "minimal", scriptAccentUsage: "none",
  backgroundTreatment: "full_bleed_photo", decorativeRestraint: "disciplined", negativeSpaceStrategy: "minimal", typographyPersonality: "clean_sans"
};

/** Mirrors the renderer's own role gating + stack split so every expected
 * rect comes from the renderer's exported helpers. */
function expectedGeometry(R, cd, content) {
  const geo = R.resolveCompositionGeometry(cd, W, H);
  const slots = cd.graphicTextSlots || {};
  const ctaText = R.deriveCtaText(content.cta, cd.graphicTextLimits.ctaMaxChars);
  const roles = (R.HIERARCHY_DEPTH_ROLES[cd.hierarchyDepth] || []).filter((r) => r !== "serviceDetail" && slots[r] && !(r === "cta" && !ctaText));
  const headlineOnBanner = Boolean(geo.banner) && (cd.compositionFamily === "banner_led" || cd.textRegion === "banner");
  const stack = geo.stack || geo.banner || { x: 0, y: 0, w: W, h: H * 0.2 };
  const rects = R.splitStackIntoRoles(stack, roles, cd.headlineScale, !headlineOnBanner, { canvasWidth: W, canvasHeight: H });
  const uncapped = R.splitStackIntoRoles(stack, roles, cd.headlineScale, !headlineOnBanner);
  const headlineRect = headlineOnBanner ? geo.banner : rects.headline;
  const mult = R.HEADLINE_SCALE_MULTIPLIER[cd.headlineScale] || 1;
  const headlineNominal = Math.min(headlineRect.h * 0.36 * mult, headlineRect.w * 0.42);
  const supportCap = Math.min(H * R.SUPPORTING_LINE_MAX_FONT_RATIO, headlineNominal * R.SUPPORTING_LINE_HEADLINE_RATIO);
  const contact = { x: Math.round(W * 0.06), y: Math.round(H * 0.93), w: Math.round(W * 0.88), h: Math.round(H * 0.05) };
  const brandRect = R.resolveBrandingRect(cd.brandingPosition, W, H);
  return { geo, roles, rects, uncapped, headlineRect, headlineNominal, supportCap, contact, brandRect, stack, ctaText };
}

async function render(R, cd, content) {
  const canvas = await R.renderFlyer({ creativeDirection: cd, content, brand: BRAND, backgroundUrl: "https://example.test/photo.jpg", fallbackBackgroundUrl: null, width: W, height: H });
  const ctx = canvas.getContext("2d");
  return { canvas, texts: ctx.texts, drawn: String(canvas.dataset.florisynDrawnRoles || "").split(",").filter(Boolean) };
}

/** The recorded fillText calls that belong to `sourceText` (each wrapped
 * line is a separate call): the call's text is a CASE-SENSITIVE substring
 * of the source — the brand lockup ("LILIES IN BLOOM"), the uppercase CTA
 * and the footer line share words with a body sentence but never its
 * casing/shape, so they are never mistaken for it. */
function textsFrom(texts, sourceText) {
  const src = String(sourceText).replace(/\s+/g, " ");
  return texts.filter((t) => { const s = String(t.text).replace(/\s+/g, " ").trim(); return s.length >= 3 && src.includes(s); });
}
/** A recording context that tolerates every canvas method the renderer
 * may call (the recording helper only implements the ones the poster
 * uses; anything else — strokeText, roundRect, setLineDash… — is a no-op). */
function tolerantContext(w, h) {
  const base = recordingContext(w, h);
  return new Proxy(base, { get(target, prop) { return prop in target ? target[prop] : function () {}; } });
}
/** Ink bounds for a "middle"-baseline draw (the renderer's textBaseline):
 * the glyph box sits ±0.5em around y. */
function bounds(records) {
  return {
    top: Math.min(...records.map((t) => t.y - t.size * 0.5)),
    bottom: Math.max(...records.map((t) => t.y + t.size * 0.5)),
    left: Math.min(...records.map((t) => t.left)),
    right: Math.max(...records.map((t) => t.right)),
    maxSize: Math.max(...records.map((t) => t.size))
  };
}
function intersects(a, b) { return a.left < b.x + b.w && a.right > b.x && a.top < b.y + b.h && a.bottom > b.y; }
function within(b, rect, slack = 2) { return b.left >= rect.x - slack && b.right <= rect.x + rect.w + slack && b.top >= rect.y - slack && b.bottom <= rect.y + rect.h + slack; }

/** The CTA's own placement contract (drawCtaLabel/computeCtaLayout are
 * pre-existing and unchanged here): its text block is centred in its
 * BOUNDED rect — the block's centre lies inside the rect and its ink
 * never reaches the banner, the supporting line's rect, or the footer.
 * (computeCtaLayout centres text-plus-divider, so the text ink alone may
 * sit a few px above the rect's top edge; the synthetic 0.52em metrics
 * here exaggerate that, which is why "within" is not asserted.) */
function assertCtaInPlace(cb, g, label) {
  const rect = g.rects.cta;
  const cy = (cb.top + cb.bottom) / 2;
  assert.ok(cy >= rect.y && cy <= rect.y + rect.h, `${label}: CTA centred inside its bounded rect ${JSON.stringify(cb)} vs ${JSON.stringify(rect)}`);
  assert.ok(cb.left >= rect.x - 2 && cb.right <= rect.x + rect.w + 2, `${label}: CTA within the rect's width`);
  if (g.geo.banner) assert.ok(!intersects(cb, g.geo.banner), `${label}: CTA clear of the banner`);
  if (g.rects.supportingLine) assert.ok(!intersects(cb, g.rects.supportingLine), `${label}: CTA clear of the supporting line's rect`);
  assert.ok(!intersects(cb, g.contact), `${label}: CTA clear of the contact footer`);
  assert.ok(cb.bottom <= H && cb.top >= 0, `${label}: CTA on-canvas`);
}

/** Assertions shared by every "supporting line drawn" case. */
function assertSupportingLineWellPlaced(R, cd, content, texts, drawn, label) {
  const g = expectedGeometry(R, cd, content);
  assert.ok(drawn.includes("supportingLine"), `${label}: supportingLine drawn (${drawn.join(",")})`);
  const supportRect = g.rects.supportingLine;
  assert.ok(supportRect.h <= H * R.ROLE_STACK_CAPS.supportingLine + 0.5, `${label}: supporting rect bounded (${supportRect.h})`);
  const derived = R.deriveSupportingLineText(content.body, LIMITS.supportingLineMaxChars);
  const lines = textsFrom(texts, derived);
  assert.ok(lines.length >= 1, `${label}: supporting text recorded`);
  const b = bounds(lines);
  assert.ok(within(b, supportRect), `${label}: supporting text inside its rect ${JSON.stringify(b)} vs ${JSON.stringify(supportRect)}`);
  assert.ok(b.maxSize <= g.supportCap + 0.5, `${label}: font ${b.maxSize} within cap ${g.supportCap}`);
  assert.ok(!intersects(b, g.headlineRect), `${label}: no collision with the headline/banner rect`);
  if (g.geo.banner) assert.ok(!intersects(b, g.geo.banner), `${label}: no collision with the banner shape`);
  assert.ok(!intersects(b, g.contact), `${label}: no collision with the contact footer rect`);
  assert.ok(!intersects(b, g.brandRect), `${label}: no collision with the branding rect`);
  assert.ok(b.top >= 0 && b.bottom <= H && b.left >= 0 && b.right <= W, `${label}: nothing off-canvas`);
  // Subordinate to the headline: the headline draws larger.
  const headlineLines = textsFrom(texts, content.headline);
  if (headlineLines.length) assert.ok(bounds(headlineLines).maxSize > b.maxSize, `${label}: headline (${bounds(headlineLines).maxSize}) larger than support (${b.maxSize})`);
  return { g, b, lines };
}

// ---------------------------------------------------------------------------
// 1. banner_led + headline + supportingLine + no CTA — the live failure.
// ---------------------------------------------------------------------------
test("1. banner_led + headline_plus_support + no CTA: the lone supporting line is bounded, subordinate, under the ribbon, off the footer — the exact live failed asset shape", async () => {
  const { R } = loadRenderer();
  const cd = bannerLed();
  const content = { headline: HEAD, body: "Lilies in Bloom is taking 20% off bouquets this weekend.", cta: "" };
  const { canvas, texts, drawn } = await render(R, cd, content);
  const { g, b } = assertSupportingLineWellPlaced(R, cd, content, texts, drawn, "live");
  // The specific numbers of the live defect, now bounded: a 680px stack,
  // a supporting rect of at most 17% of the canvas, type at most 54px.
  assert.equal(g.stack.h, 680);
  assert.equal(Math.round(g.rects.supportingLine.h), 184);
  assert.equal(g.rects.supportingLine.y, g.stack.y, "packed from the top of the stack, adjacent to the banner");
  assert.ok(b.maxSize <= 54.5 && b.maxSize >= 40, `type between the floor and the cap (${b.maxSize})`);
  assert.ok(!drawn.includes("cta"));
  // The photo stays substantially visible: nothing but the supporting line
  // is drawn into the stack, and it uses at most the top 184px of it.
  assert.ok(b.bottom <= g.stack.y + 184 + 2);
  assert.equal(canvas.dataset.florisynUndrawnRoles, "", "every contracted role drew");
});

test("splitStackIntoRoles: the narrow-stack allowance ramps continuously with column width — a wider column never gets LESS height than a narrower one", () => {
  const { R } = loadRenderer();
  let previous = Infinity;
  for (const w of [220, 320, 400, 488, 540, 556, 700, 886]) {
    const h = R.splitStackIntoRoles({ x: 0, y: 0, w, h: 900 }, ["supportingLine"], "large", false, { canvasWidth: W, canvasHeight: H }).supportingLine.h;
    assert.ok(h <= previous + 0.001, `width ${w}: ${h} > ${previous}`);
    assert.ok(h <= H * R.ROLE_STACK_CAPS.supportingLine * R.NARROW_STACK_CAP_MULTIPLIER + 0.5);
    previous = h;
  }
  assert.equal(Math.round(R.splitStackIntoRoles({ x: 0, y: 0, w: 886, h: 900 }, ["supportingLine"], "large", false, { canvasWidth: W, canvasHeight: H }).supportingLine.h), 184);
  assert.equal(Math.round(R.splitStackIntoRoles({ x: 0, y: 0, w: 320, h: 900 }, ["supportingLine"], "large", false, { canvasWidth: W, canvasHeight: H }).supportingLine.h), 275);
});

// ---------------------------------------------------------------------------
// 2. banner_led + headline + supportingLine + CTA.
// ---------------------------------------------------------------------------
test("2. banner_led + headline_support_cta with a fitting CTA: supporting rect is IDENTICAL to the no-CTA case, the CTA sits below it in its own bounded rect, no overlap", async () => {
  const { R } = loadRenderer();
  const cd = bannerLed(WITH_CTA);
  const content = { headline: HEAD, body: "Every bouquet in the cooler is 20% off this weekend only.", cta: "Call 606-506-4039" };
  const { texts, drawn } = await render(R, cd, content);
  const { g, b } = assertSupportingLineWellPlaced(R, cd, content, texts, drawn, "with-cta");
  const noCta = expectedGeometry(R, bannerLed(), { ...content, cta: "" });
  assert.deepEqual(g.rects.supportingLine, noCta.rects.supportingLine, "CTA presence never changes the supporting line's rect");
  assert.ok(drawn.includes("cta"));
  assert.ok(g.rects.cta.h <= H * R.ROLE_STACK_CAPS.cta + 0.5, "CTA rect bounded");
  assert.ok(g.rects.cta.y >= g.rects.supportingLine.y + g.rects.supportingLine.h, "CTA below the supporting line");
  const ctaLines = textsFrom(texts, content.cta.toUpperCase());
  assert.ok(ctaLines.length >= 1, "CTA text recorded");
  const cb = bounds(ctaLines);
  assertCtaInPlace(cb, g, "with-cta");
  assert.ok(cb.top >= b.bottom, "CTA does not overlap the supporting text");
});

// ---------------------------------------------------------------------------
// 3. CTA removed by the 30-character fail-safe.
// ---------------------------------------------------------------------------
test("3. CTA suppressed by the 30-char fail-safe: the freed slot is left empty — the supporting line keeps the exact rect and type it has when the CTA is present", async () => {
  const { R } = loadRenderer();
  const cd = bannerLed(WITH_CTA);
  const body = "Every bouquet in the cooler is 20% off this weekend only.";
  const suppressed = await render(R, cd, { headline: HEAD, body, cta: "Call 606-506-4039 to place an order." });
  const present = await render(R, cd, { headline: HEAD, body, cta: "Call 606-506-4039" });
  assert.ok(!suppressed.drawn.includes("cta"), "36-char CTA is not drawn");
  assert.ok(present.drawn.includes("cta"));
  const s = assertSupportingLineWellPlaced(R, cd, { headline: HEAD, body, cta: "Call 606-506-4039 to place an order." }, suppressed.texts, suppressed.drawn, "suppressed");
  const p = assertSupportingLineWellPlaced(R, cd, { headline: HEAD, body, cta: "Call 606-506-4039" }, present.texts, present.drawn, "present");
  assert.deepEqual(s.g.rects.supportingLine, p.g.rects.supportingLine);
  assert.equal(s.b.maxSize, p.b.maxSize, "identical type size with or without the CTA");
  assert.deepEqual(s.lines.map((t) => [t.text, Math.round(t.y)]), p.lines.map((t) => [t.text, Math.round(t.y)]), "identical lines and positions");
  // Nothing at all is drawn into the CTA's former territory.
  const ctaRect = p.g.rects.cta;
  const strays = suppressed.texts.filter((t) => t.y > ctaRect.y && t.y < ctaRect.y + ctaRect.h);
  assert.equal(strays.length, 0, `no text in the freed CTA territory: ${JSON.stringify(strays.map((t) => t.text))}`);
});

// ---------------------------------------------------------------------------
// 4/5/6. short / medium / long supporting lines.
// ---------------------------------------------------------------------------
for (const [label, body] of [
  ["4. short", "Fresh bouquets, 20% off all weekend."],
  ["5. medium", "Every bouquet in the cooler is 20% off this weekend only."],
  ["6. long (over the 60-char excerpt limit, truncated at a word boundary)", "Every bouquet in the shop is twenty percent off this weekend while the freshest stems last, so come early and choose your favorite."],
  ["6b. long first sentence that must wrap to three lines", "Because your people deserve something beautiful this weekend, every bouquet is 20% off."]
]) {
  test(`${label} supporting line: bounded rect, capped type, fits its bounds, no collisions`, async () => {
    const { R } = loadRenderer();
    const cd = bannerLed();
    const content = { headline: HEAD, body, cta: "" };
    const { texts, drawn } = await render(R, cd, content);
    const { lines } = assertSupportingLineWellPlaced(R, cd, content, texts, drawn, label);
    const derived = R.deriveSupportingLineText(body, 60);
    assert.ok(derived.length <= 61, `excerpt bounded (${derived.length})`);
    assert.equal(lines.map((t) => t.text).join(" ").replace(/\s+/g, " "), derived.replace(/\s+/g, " "), "every wrapped line of the excerpt was drawn, nothing more");
  });
}

// ---------------------------------------------------------------------------
// 7. brand + headline + support without phone.
// ---------------------------------------------------------------------------
test("7. brand + headline + supportingLine with the phone slot off: no contact footer, no phone digits anywhere, supporting line well placed", async () => {
  const { R } = loadRenderer();
  const cd = bannerLed();
  const content = { headline: HEAD, body: "Lilies in Bloom is taking 20% off bouquets this weekend.", cta: "" };
  const { texts, drawn } = await render(R, cd, content);
  assertSupportingLineWellPlaced(R, cd, content, texts, drawn, "no-phone");
  assert.ok(!drawn.includes("contact"));
  assert.ok(texts.every((t) => !/606-506-4039/.test(t.text)), "no phone number drawn");
  assert.ok(texts.some((t) => /LILIES IN BLOOM/i.test(t.text)), "brand lockup drawn");
});

test("7b. the same layout with the phone slot ON: the contact footer draws in its own rect and the supporting line never touches it", async () => {
  const { R } = loadRenderer();
  const cd = bannerLed({ graphicTextSlots: { cta: false, brand: true, phone: true, headline: true, serviceDetail: false, supportingLine: true } });
  const content = { headline: HEAD, body: "Lilies in Bloom is taking 20% off bouquets this weekend.", cta: "" };
  const { texts, drawn } = await render(R, cd, content);
  const { g, b } = assertSupportingLineWellPlaced(R, cd, content, texts, drawn, "phone-on");
  assert.ok(drawn.includes("contact"));
  const footer = texts.filter((t) => /606-506-4039/.test(t.text));
  assert.ok(footer.length >= 1);
  const fb = bounds(footer);
  assert.ok(within(fb, g.contact, 6), `footer inside the contact rect ${JSON.stringify(fb)}`);
  assert.ok(fb.top > b.bottom, "footer below the supporting text");
});

// ---------------------------------------------------------------------------
// 8. existing notice flyer with a phone CTA (framed_panel, dedicated panel).
// ---------------------------------------------------------------------------
test("8. operational notice (framed_panel) with a phone CTA: geometry is byte-identical to the uncapped split — no shrink for a normal flyer — and every role draws in place", async () => {
  const { R } = loadRenderer();
  const content = { headline: "Closing Early Today", body: "Lilies in Bloom is closing at 2:30 today.", cta: "Call 606-506-4039" };
  const g = expectedGeometry(R, NOTICE, content);
  assert.deepEqual(g.rects, g.uncapped, "caps never bite where the stack already allotted less than the cap");
  const { texts, drawn } = await render(R, NOTICE, content);
  // (No separate "contact" role here: contactLineParts' existing dedup
  // never repeats a phone the CTA already shows — pre-existing behavior.)
  assert.ok(drawn.includes("headline") && drawn.includes("supportingLine") && drawn.includes("cta"), drawn.join(","));
  const { b } = assertSupportingLineWellPlaced(R, NOTICE, content, texts, drawn, "notice");
  assert.ok(texts.some((t) => /2:30/.test(t.text)), "the closing time is on the graphic");
  const cb = bounds(textsFrom(texts, content.cta.toUpperCase()));
  assert.ok(cb.top >= b.bottom, "CTA below the supporting line");
});

// ---------------------------------------------------------------------------
// 9. existing promotional flyer with a CTA (run-1 direction, compliant CTA).
// ---------------------------------------------------------------------------
test("9. promotional banner_led flyer with a compliant CTA (run-1 direction): CTA rect bounded, drawn within it, subordinate supporting line, footer clear", async () => {
  const { R } = loadRenderer();
  const cd = bannerLed(WITH_CTA);
  const content = { headline: HEAD, body: "Lilies in Bloom is taking 20% off bouquets this weekend.", cta: "Call 606-506-4039" };
  const { texts, drawn } = await render(R, cd, content);
  const { g } = assertSupportingLineWellPlaced(R, cd, content, texts, drawn, "promo-cta");
  assert.equal(Math.round(g.rects.cta.h), Math.round(H * R.ROLE_STACK_CAPS.cta), "the CTA no longer inherits a 348px slot");
  const cb = bounds(textsFrom(texts, content.cta.toUpperCase()));
  assertCtaInPlace(cb, g, "promo-cta");
  const footer = texts.filter((t) => /606-506-4039/.test(t.text) && t.y > H * 0.9);
  assert.ok(footer.length === 0 || bounds(footer).top > cb.bottom, "footer (if any) below the CTA");
});

// ---------------------------------------------------------------------------
// 10. Test C / photo-forward: unchanged — nothing drawn at all.
// ---------------------------------------------------------------------------
test("10. photo_forward_social (Test C): every slot off, no text of any kind, drawnRoles empty", async () => {
  const { R } = loadRenderer();
  const { texts, drawn } = await render(R, PHOTO_FORWARD, { headline: "", body: "", cta: "" });
  assert.equal(drawn.length, 0);
  assert.equal(texts.length, 0);
});

// ---------------------------------------------------------------------------
// Lone CTA (headline_plus_cta) — the same single-role expansion, bounded.
// ---------------------------------------------------------------------------
test("11. banner_led + headline_plus_cta (lone CTA): the CTA is bounded to its cap instead of inheriting the whole stack", async () => {
  const { R } = loadRenderer();
  const cd = bannerLed({ hierarchyDepth: "headline_plus_cta", ctaProminence: "strong", graphicTextSlots: { cta: true, brand: true, phone: true, headline: true, serviceDetail: false, supportingLine: false } });
  const content = { headline: HEAD, body: "", cta: "Call 606-506-4039" };
  const g = expectedGeometry(R, cd, content);
  assert.equal(Math.round(g.uncapped.cta.h), 680, "sanity: uncapped, the lone CTA got the entire stack");
  assert.equal(Math.round(g.rects.cta.h), Math.round(H * R.ROLE_STACK_CAPS.cta));
  const { texts, drawn } = await render(R, cd, content);
  assert.ok(drawn.includes("cta"));
  const cb = bounds(textsFrom(texts, content.cta.toUpperCase()));
  assertCtaInPlace(cb, g, "lone-cta");
});

// ---------------------------------------------------------------------------
// The split itself, and the families that must NOT change.
// ---------------------------------------------------------------------------
test("splitStackIntoRoles: without opts it is the original uncapped split; with opts a lone role is bounded, packed from the top, and the freed height is left empty", () => {
  const { R } = loadRenderer();
  const stack = { x: 97, y: 313, w: 886, h: 680 };
  const legacy = R.splitStackIntoRoles(stack, ["supportingLine"], "oversized", false);
  assert.equal(legacy.supportingLine.h, 680, "legacy behavior preserved for callers that pass no opts");
  const capped = R.splitStackIntoRoles(stack, ["supportingLine"], "oversized", false, { canvasWidth: W, canvasHeight: H });
  assert.equal(Math.round(capped.supportingLine.h), 184);
  assert.equal(capped.supportingLine.y, 313);
  assert.equal(capped.supportingLine.x, 97);
  assert.equal(capped.supportingLine.w, 886);
  const two = R.splitStackIntoRoles(stack, ["supportingLine", "cta"], "oversized", false, { canvasWidth: W, canvasHeight: H });
  assert.equal(Math.round(two.supportingLine.h), 184);
  assert.equal(Math.round(two.cta.h), Math.round(H * 0.16));
  assert.ok(two.cta.y > two.supportingLine.y + two.supportingLine.h, "CTA packed after the supporting line with the gap");
  assert.ok(two.cta.y + two.cta.h < stack.y + stack.h, "freed height stays empty at the bottom of the stack");
  // The headline is never capped.
  const withHeadline = R.splitStackIntoRoles({ x: 86, y: 605, w: 907, h: 410 }, ["supportingLine"], "large", true, { canvasWidth: W, canvasHeight: H });
  const withHeadlineLegacy = R.splitStackIntoRoles({ x: 86, y: 605, w: 907, h: 410 }, ["supportingLine"], "large", true);
  assert.deepEqual(withHeadline, withHeadlineLegacy);
});

test("caps only bite tall stacks: hero_full_bleed lower band, framed_panel dedicated panel (incl. the operational notice) and layered_editorial-with-CTA already allot less than the cap, so their role rects are byte-identical with and without the caps", () => {
  const { R } = loadRenderer();
  const cases = [
    { compositionFamily: "hero_full_bleed", textRegion: "negative_space_band_lower", hierarchyDepth: "headline_plus_support", headlineScale: "large", imagePlacement: "full_bleed", imageScale: "dominant", subjectPlacement: "center", occasionTreatment: "everyday_floral", graphicTextSlots: { cta: false, brand: true, phone: false, headline: true, serviceDetail: false, supportingLine: true }, graphicTextLimits: LIMITS },
    { compositionFamily: "hero_full_bleed", textRegion: "negative_space_band_lower", hierarchyDepth: "headline_plus_cta", headlineScale: "large", imagePlacement: "full_bleed", imageScale: "dominant", subjectPlacement: "center", occasionTreatment: "everyday_floral", graphicTextSlots: { cta: true, brand: true, phone: true, headline: true, serviceDetail: false, supportingLine: false }, graphicTextLimits: LIMITS },
    { compositionFamily: "framed_panel", textRegion: "dedicated_panel", hierarchyDepth: "headline_support_service_cta", headlineScale: "standard", imagePlacement: "inset_panel", imageScale: "balanced", subjectPlacement: "center", occasionTreatment: "sympathy_elegance", graphicTextSlots: { cta: true, brand: true, phone: true, headline: true, serviceDetail: true, supportingLine: true }, graphicTextLimits: LIMITS },
    { compositionFamily: "layered_editorial", textRegion: "integrated_editorial_region", hierarchyDepth: "headline_support_cta", headlineScale: "large", imagePlacement: "inset_panel", imageScale: "balanced", subjectPlacement: "left_third", occasionTreatment: "everyday_floral", graphicTextSlots: { cta: true, brand: true, phone: true, headline: true, serviceDetail: false, supportingLine: true }, graphicTextLimits: LIMITS },
    NOTICE
  ];
  for (const cd of cases) {
    const g = expectedGeometry(R, cd, { headline: "H", body: "B", cta: "Call 606-506-4039" });
    assert.deepEqual(g.rects, g.uncapped, `${cd.compositionFamily}/${cd.hierarchyDepth}`);
  }
});

// ---------------------------------------------------------------------------
// Fail-closed and the type ceiling, on the role drawer itself.
// ---------------------------------------------------------------------------
test("drawTypographyRole: maxFontSize is an independent ceiling applied before the floor; failClosed draws NOTHING when the block cannot fit at the floor", () => {
  const { R } = loadRenderer();
  const ctx = tolerantContext(W, H);
  const rect = { x: 97, y: 313, w: 886, h: 184 };
  const ok = R.drawTypographyRole(ctx, rect, "Every bouquet in the cooler is 20% off this weekend only.", { family: "'Inter', sans-serif", weight: "500", baseSizeRatio: 0.3, minFontRatio: 0.75, maxFontSize: 54, failClosed: true });
  assert.equal(ok.drew, true);
  assert.ok(ok.fontSize <= 54);
  assert.ok(ctx.texts.length >= 1);
  const tiny = tolerantContext(W, H);
  const fail = R.drawTypographyRole(tiny, { x: 0, y: 0, w: 120, h: 30 }, "Every bouquet in the shop is twenty percent off this weekend while stems last", { family: "'Inter', sans-serif", weight: "500", baseSizeRatio: 0.3, minFontRatio: 0.75, maxFontSize: 54, failClosed: true });
  assert.equal(fail.drew, false);
  assert.equal(fail.overflow, true);
  assert.equal(tiny.texts.length, 0, "fail closed: no text painted");
  // Without failClosed the legacy behavior (draw anyway) is untouched.
  const legacy = tolerantContext(W, H);
  const drewAnyway = R.drawTypographyRole(legacy, { x: 0, y: 0, w: 120, h: 30 }, "Every bouquet in the shop is twenty percent off this weekend while stems last", { family: "'Inter', sans-serif", weight: "500", baseSizeRatio: 0.3, minFontRatio: 0.75 });
  assert.equal(drewAnyway.drew, true);
});

test("through the real render: a supporting excerpt that cannot fit its bounded rect at the floor fails closed — the role is reported undrawn and nothing malformed is painted", async () => {
  const { R } = loadRenderer();
  // A deliberately narrow stack: a layered_editorial column (320px wide)
  // with the excerpt limit raised so a 60+ char excerpt must wrap past
  // the bounded height even at the floor.
  const cd = {
    version: 2, imageCrop: "medium", badgeStyle: "none", imageScale: "balanced", textRegion: "integrated_editorial_region", visualMood: "warm_inviting", bannerStyle: "none",
    borderStyle: "hairline", paletteMood: "classic_brand", textDensity: "standard", dividerStyle: "none", brandingScale: "standard", ctaProminence: "none", headlineScale: "large",
    hierarchyDepth: "headline_plus_support", imagePlacement: "inset_panel", brandIdentifier: "shop_name", decorativeMotif: "none", brandingPosition: "top_center",
    graphicTextSlots: { cta: false, brand: true, phone: false, headline: true, serviceDetail: false, supportingLine: true }, subjectPlacement: "left_third",
    compositionFamily: "layered_editorial", graphicTextLimits: { ...LIMITS, supportingLineMaxChars: 400 }, occasionTreatment: "everyday_floral", ornamentalDensity: "light",
    scriptAccentUsage: "none", backgroundTreatment: "bordered_panel_with_photo_inset", decorativeRestraint: "disciplined", negativeSpaceStrategy: "moderate", typographyPersonality: "clean_sans"
  };
  const body = "Every single bouquet, arrangement, and centerpiece in the whole shop is twenty percent off this weekend while the freshest stems last, so please come early and choose your favorite before it is gone for good.";
  const content = { headline: "Weekend Blooms", body, cta: "" };
  const { canvas, texts, drawn } = await render(R, cd, content);
  assert.ok(drawn.includes("headline"));
  assert.ok(!drawn.includes("supportingLine"), `fails closed (${drawn.join(",")})`);
  assert.equal(canvas.dataset.florisynUndrawnRoles, "supportingLine", "the contracted-but-undrawn role is stamped, never silently omitted");
  const g = expectedGeometry(R, cd, content);
  const strays = texts.filter((t) => t.y > g.rects.supportingLine.y && t.y < g.rects.supportingLine.y + g.rects.supportingLine.h);
  assert.equal(strays.length, 0, "nothing painted in the supporting rect");
});
