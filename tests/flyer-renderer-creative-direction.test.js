import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * Creative Direction Engine, Phase 2 ("dynamic renderer + hard graphic/
 * caption allocation only") — unit coverage for the new PURE helpers in
 * public/flyer-renderer.js, loaded the same way tests/flyer-renderer.
 * test.js already loads the module (a vm sandbox, no real DOM) so this
 * mirrors that file's own convention rather than inventing a second one.
 * Canvas-drawing behavior (real structural/pixel differences between
 * composition families, real font rendering) is covered separately by
 * the browser-level Playwright suite — see tests/e2e/marketing-studio-
 * shop-flyer-creative-direction.spec.js.
 */

const root = process.cwd();

function loadFlyerRenderer() {
  const source = fs.readFileSync(path.join(root, "public/flyer-renderer.js"), "utf8");
  const sandbox = { module: { exports: {} }, globalThis: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports;
}

const renderer = loadFlyerRenderer();

// ---------------------------------------------------------------------------
// HIERARCHY_DEPTH_ROLES / HEADLINE_SCALE_MULTIPLIER — schema mirrors.
// ---------------------------------------------------------------------------

test("HIERARCHY_DEPTH_ROLES mirrors the server schema's own 5 depths, headline always implicit (never listed, always mandatory)", () => {
  const roles = renderer.HIERARCHY_DEPTH_ROLES;
  assert.deepEqual(Object.keys(roles).sort(), ["headline_only", "headline_plus_cta", "headline_plus_support", "headline_support_cta", "headline_support_service_cta"].sort());
  // Compared field-by-field, not via assert.deepEqual against an array
  // literal: the vm sandbox returns arrays from a different realm, and
  // strict deepEqual can reject those as not equal even when every
  // element matches (see tests/flyer-renderer.test.js's own comment on
  // this exact gotcha).
  assert.equal(roles.headline_only.length, 0);
  assert.equal(roles.headline_plus_support.join(","), "supportingLine");
  assert.equal(roles.headline_plus_cta.join(","), "cta");
  assert.equal(roles.headline_support_cta.join(","), "supportingLine,cta");
  assert.equal(roles.headline_support_service_cta.join(","), "supportingLine,serviceDetail,cta");
});

test("headlineScale materially changes the multiplier, never a no-op", () => {
  const m = renderer.HEADLINE_SCALE_MULTIPLIER;
  assert.ok(m.large > m.standard);
  assert.ok(m.oversized > m.large);
});

// ---------------------------------------------------------------------------
// resolveScriptAccentPlan (Part E)
// ---------------------------------------------------------------------------

test("resolveScriptAccentPlan: 'none' never triggers a script plan", () => {
  const plan = renderer.resolveScriptAccentPlan("none", "Beautiful Blooms Today", false);
  assert.equal(plan.mode, "none");
});

test("resolveScriptAccentPlan: 'accent_word' picks the headline's OWN first word — never invents a new word", () => {
  const plan = renderer.resolveScriptAccentPlan("accent_word", "Beautiful Blooms Today", false);
  assert.equal(plan.mode, "accent_word");
  assert.equal(plan.accentWord, "Beautiful");
});

test("resolveScriptAccentPlan: 'full_script_headline' is downgraded to 'accent_word' on an operational notice — legibility of a time/date always wins, even if a bad value somehow reached the renderer", () => {
  const plan = renderer.resolveScriptAccentPlan("full_script_headline", "Closing at 3pm today", true);
  assert.notEqual(plan.mode, "full_headline");
  assert.equal(plan.mode, "accent_word");
});

test("resolveScriptAccentPlan: 'full_script_headline' is honored outside an operational notice", () => {
  const plan = renderer.resolveScriptAccentPlan("full_script_headline", "Beautiful Blooms Today", false);
  assert.equal(plan.mode, "full_headline");
});

test("resolveScriptAccentPlan: 'subhead_script' never touches the headline itself", () => {
  const plan = renderer.resolveScriptAccentPlan("subhead_script", "Beautiful Blooms Today", false);
  assert.equal(plan.mode, "subhead_script");
  assert.equal(plan.accentWord, null);
});

test("resolveScriptAccentPlan: an empty headline never crashes and never produces an accent word", () => {
  const plan = renderer.resolveScriptAccentPlan("accent_word", "", false);
  assert.equal(plan.mode, "none");
});

// ---------------------------------------------------------------------------
// deriveSupportingLineText (Part G — real excerpt, never invented)
// ---------------------------------------------------------------------------

test("deriveSupportingLineText: takes the first real sentence of the actual caption, verbatim", () => {
  const line = renderer.deriveSupportingLineText("Fresh spring bouquets are here. Order yours today for pickup.", 60);
  assert.equal(line, "Fresh spring bouquets are here.");
});

test("deriveSupportingLineText: truncates at a word boundary under the ceiling, never mid-word, and never invents replacement words", () => {
  const longSentence = "Our shop mascot is ready for the big spring parade with a fresh handmade bouquet in hand today";
  const line = renderer.deriveSupportingLineText(longSentence, 30);
  assert.ok(line.length <= 33, `expected roughly <=30 chars plus ellipsis, got: "${line}" (${line.length})`);
  assert.ok(line.endsWith("…"));
  // Every word in the excerpt must be a real substring of the original —
  // nothing invented.
  const words = line.replace("…", "").trim().split(/\s+/);
  for (const w of words) assert.ok(longSentence.includes(w), `"${w}" must come from the real source text`);
});

test("deriveSupportingLineText: empty/whitespace input returns null, never a fabricated placeholder", () => {
  assert.equal(renderer.deriveSupportingLineText("", 60), null);
  assert.equal(renderer.deriveSupportingLineText("   ", 60), null);
  assert.equal(renderer.deriveSupportingLineText(null, 60), null);
});

// ---------------------------------------------------------------------------
// resolveOrnamentColors (Part M — grounded in the shop's own real colors)
// ---------------------------------------------------------------------------

test("resolveOrnamentColors: always grounded in the shop's OWN real brand colors, never a fully hardcoded palette", () => {
  const brand = { primaryColor: "#123456", accentColor: "#abcdef" };
  const classic = renderer.resolveOrnamentColors("classic_brand", brand);
  assert.equal(classic.primary, "#123456");
  assert.equal(classic.accent, "#abcdef");
});

test("resolveOrnamentColors: different paletteMoods produce visibly different panel colors for the SAME brand — not everything hardcoded pink", () => {
  const brand = { primaryColor: "#7c3a58", accentColor: "#c98fae" };
  const moods = ["neutral_blush_ivory", "soft_pastel", "warm_luxury", "vibrant_seasonal", "jewel_tone", "classic_brand"];
  const panels = new Set(moods.map((m) => renderer.resolveOrnamentColors(m, brand).panel));
  assert.ok(panels.size >= 4, `expected real variety across paletteMoods, got: ${[...panels].join(", ")}`);
});

test("resolveOrnamentColors: never throws with a brandless shop (falls back to a real, defined default, never undefined)", () => {
  const colors = renderer.resolveOrnamentColors("classic_brand", {});
  assert.ok(colors.primary);
  assert.ok(colors.accent);
  assert.ok(colors.panel);
  assert.ok(colors.border);
});

// ---------------------------------------------------------------------------
// computeCoverAlignedRect (Part K — real crop math)
// ---------------------------------------------------------------------------

test("computeCoverAlignedRect: left_third keeps the LEFT part of the source image centered in the crop", () => {
  const r = renderer.computeCoverAlignedRect(2000, 1000, 1000, 1000, renderer.SUBJECT_PLACEMENT_FOCAL.left_third, 1);
  // The crop's own horizontal center should land near 28% across the
  // source width, not 50% (a plain center-crop would be near iw/2).
  const cropCenterX = r.sx + r.sw / 2;
  assert.ok(Math.abs(cropCenterX - 2000 * 0.28) < 5, `expected crop centered near x=560, got ${cropCenterX}`);
});

test("computeCoverAlignedRect: right_third and left_third produce genuinely different crops for a wide source image", () => {
  const left = renderer.computeCoverAlignedRect(2000, 1000, 1000, 1000, renderer.SUBJECT_PLACEMENT_FOCAL.left_third, 1);
  const right = renderer.computeCoverAlignedRect(2000, 1000, 1000, 1000, renderer.SUBJECT_PLACEMENT_FOCAL.right_third, 1);
  assert.notEqual(left.sx, right.sx);
});

test("computeCoverAlignedRect: 'tight' crop shows visibly less of the source than 'wide_environmental'", () => {
  const tight = renderer.computeCoverAlignedRect(2000, 2000, 1000, 1000, renderer.SUBJECT_PLACEMENT_FOCAL.center, renderer.IMAGE_CROP_ZOOM.tight);
  const wide = renderer.computeCoverAlignedRect(2000, 2000, 1000, 1000, renderer.SUBJECT_PLACEMENT_FOCAL.center, renderer.IMAGE_CROP_ZOOM.wide_environmental);
  assert.ok(tight.sw < wide.sw, `tight crop must sample a narrower source region than wide_environmental: tight=${tight.sw}, wide=${wide.sw}`);
});

test("computeCoverAlignedRect: never asks for more of the source than actually exists", () => {
  const r = renderer.computeCoverAlignedRect(500, 500, 2000, 2000, renderer.SUBJECT_PLACEMENT_FOCAL.center, 0.1);
  assert.ok(r.sw <= 500);
  assert.ok(r.sh <= 500);
  assert.ok(r.sx >= 0 && r.sy >= 0);
});

// ---------------------------------------------------------------------------
// resolveCompositionGeometry (Parts C/D — structurally distinct families)
// ---------------------------------------------------------------------------

function baseCd(overrides = {}) {
  return { compositionFamily: "hero_full_bleed", textRegion: "negative_space_band_lower", subjectPlacement: "center", ...overrides };
}

test("hero_full_bleed: the photo fills the entire canvas, no panel unless textRegion explicitly asks for one", () => {
  const geo = renderer.resolveCompositionGeometry(baseCd(), 1080, 1080);
  assert.equal(geo.photo.x, 0);
  assert.equal(geo.photo.y, 0);
  assert.equal(geo.photo.w, 1080);
  assert.equal(geo.photo.h, 1080);
  assert.equal(geo.panel, null);
  assert.equal(geo.isPanelFilled, false);
});

test("hero_full_bleed with textRegion dedicated_panel DOES get a real panel — an explicit request, not the default", () => {
  const geo = renderer.resolveCompositionGeometry(baseCd({ textRegion: "dedicated_panel" }), 1080, 1080);
  assert.ok(geo.panel);
  assert.equal(geo.isPanelFilled, true);
});

test("layered_editorial: the photo is CONFINED to an asymmetric (never 50/50) sub-rect, with a real panel beside it", () => {
  const geo = renderer.resolveCompositionGeometry(baseCd({ compositionFamily: "layered_editorial" }), 1080, 1080);
  assert.notEqual(geo.photo.w, 1080, "the photo must not be full-bleed for layered_editorial");
  assert.notEqual(geo.photo.w, 540, "must never be a mechanical 50/50 split");
  assert.ok(geo.panel);
  assert.equal(geo.isPanelFilled, true);
  assert.equal(geo.photo.w + geo.panel.w, 1080, "photo and panel must together account for the full width");
});

test("layered_editorial: subjectPlacement right_third mirrors the asymmetry (photo on the right instead of the left)", () => {
  const left = renderer.resolveCompositionGeometry(baseCd({ compositionFamily: "layered_editorial", subjectPlacement: "center" }), 1080, 1080);
  const right = renderer.resolveCompositionGeometry(baseCd({ compositionFamily: "layered_editorial", subjectPlacement: "right_third" }), 1080, 1080);
  assert.notEqual(left.photo.x, right.photo.x);
});

test("framed_panel: photo stays full-bleed (still visually floral) AND a real bordered panel is drawn on top", () => {
  const geo = renderer.resolveCompositionGeometry(baseCd({ compositionFamily: "framed_panel" }), 1080, 1080);
  assert.equal(geo.photo.w, 1080);
  assert.equal(geo.photo.h, 1080);
  assert.ok(geo.panel);
  assert.equal(geo.isPanelFilled, true);
});

test("banner_led: a dedicated banner rect exists and is distinct from the plain text stack", () => {
  const geo = renderer.resolveCompositionGeometry(baseCd({ compositionFamily: "banner_led" }), 1080, 1080);
  assert.ok(geo.banner);
  assert.ok(geo.stack);
  assert.notEqual(geo.banner.y, geo.stack.y);
});

test("the four composition families are structurally distinguishable from one another (not the same rectangle at a different Y)", () => {
  const geometries = ["hero_full_bleed", "layered_editorial", "framed_panel", "banner_led"].map((f) => renderer.resolveCompositionGeometry(baseCd({ compositionFamily: f }), 1080, 1080));
  const signatures = geometries.map((g) => JSON.stringify({ photo: g.photo, hasPanel: Boolean(g.panel), hasBanner: Boolean(g.banner) }));
  assert.equal(new Set(signatures).size, 4, `expected 4 distinct structural signatures, got: ${signatures.join(" | ")}`);
});

test("negative-space upper vs lower regions place the stack in genuinely different vertical halves", () => {
  const lower = renderer.resolveCompositionGeometry(baseCd({ textRegion: "negative_space_band_lower" }), 1080, 1080);
  const upper = renderer.resolveCompositionGeometry(baseCd({ textRegion: "negative_space_band_upper" }), 1080, 1080);
  assert.ok(lower.stack.y > 1080 / 2);
  assert.ok(upper.stack.y < 1080 / 2);
});

test("banner region differs from dedicated panel — a banner rect exists for one, a filled panel for the other, never the same treatment", () => {
  const banner = renderer.resolveCompositionGeometry(baseCd({ textRegion: "banner" }), 1080, 1080);
  const panel = renderer.resolveCompositionGeometry(baseCd({ textRegion: "dedicated_panel" }), 1080, 1080);
  assert.ok(banner.banner);
  assert.equal(banner.panel, null);
  assert.ok(panel.panel);
  assert.equal(panel.banner, null);
});

// ---------------------------------------------------------------------------
// splitStackIntoRoles
// ---------------------------------------------------------------------------

test("splitStackIntoRoles: headline is always present and gets the largest share", () => {
  const stack = { x: 0, y: 500, w: 800, h: 300 };
  const rects = renderer.splitStackIntoRoles(stack, ["supportingLine", "cta"], "standard");
  assert.ok(rects.headline);
  assert.ok(rects.headline.h > rects.supportingLine.h);
  assert.ok(rects.headline.h > rects.cta.h);
});

test("splitStackIntoRoles: headlineScale materially grows the headline's own share relative to the same active roles", () => {
  const stack = { x: 0, y: 500, w: 800, h: 300 };
  const standard = renderer.splitStackIntoRoles(stack, ["supportingLine"], "standard");
  const oversized = renderer.splitStackIntoRoles(stack, ["supportingLine"], "oversized");
  assert.ok(oversized.headline.h > standard.headline.h);
});

test("splitStackIntoRoles: more active roles means each individual role gets less height, never overlapping", () => {
  const stack = { x: 0, y: 500, w: 800, h: 300 };
  const one = renderer.splitStackIntoRoles(stack, ["supportingLine"], "standard");
  const three = renderer.splitStackIntoRoles(stack, ["supportingLine", "serviceDetail", "cta"], "standard");
  assert.ok(three.headline.h < one.headline.h);
  // No two roles overlap vertically.
  const order = ["headline", "supportingLine", "serviceDetail", "cta"].filter((k) => three[k]);
  for (let i = 1; i < order.length; i++) {
    assert.ok(three[order[i]].y >= three[order[i - 1]].y + three[order[i - 1]].h - 0.01);
  }
});

// ---------------------------------------------------------------------------
// ornamentalDensityAllows
// ---------------------------------------------------------------------------

test("ornamentalDensityAllows: monotonic — a higher density allows everything a lower one does, plus more", () => {
  assert.equal(renderer.ornamentalDensityAllows("minimal", "corner"), false);
  assert.equal(renderer.ornamentalDensityAllows("light", "corner"), true);
  assert.equal(renderer.ornamentalDensityAllows("light", "divider"), false);
  assert.equal(renderer.ornamentalDensityAllows("moderate", "divider"), true);
  assert.equal(renderer.ornamentalDensityAllows("rich", "motif"), true);
});

// ---------------------------------------------------------------------------
// resolveBrandingRect
// ---------------------------------------------------------------------------

test("resolveBrandingRect: the four positions are genuinely distinct locations", () => {
  const positions = ["top_center", "top_left", "bottom_center", "corner_watermark"];
  const rects = positions.map((p) => renderer.resolveBrandingRect(p, 1080, 1080));
  const sigs = new Set(rects.map((r) => `${r.x},${r.y}`));
  assert.equal(sigs.size, 4);
});

// ---------------------------------------------------------------------------
// isRoleImpossibleToFit (Part F — the mandatory-headline safety floor)
// ---------------------------------------------------------------------------

test("isRoleImpossibleToFit: empty text is never impossible", () => {
  assert.equal(renderer.isRoleImpossibleToFit("", { x: 0, y: 0, w: 10, h: 10 }, 18), false);
});

test("isRoleImpossibleToFit: a short headline in a generous region is never impossible", () => {
  assert.equal(renderer.isRoleImpossibleToFit("Beautiful Blooms", { x: 0, y: 0, w: 900, h: 200 }, 18), false);
});

test("isRoleImpossibleToFit: a very long headline crammed into a tiny region genuinely is impossible", () => {
  const longText = "This is an extremely long headline that no reasonable florist would ever actually write for a flyer but a fact-safety bypass or a bug could theoretically produce";
  assert.equal(renderer.isRoleImpossibleToFit(longText, { x: 0, y: 0, w: 40, h: 20 }, 18), true);
});

test("isRoleImpossibleToFit: a zero-size region is always impossible for non-empty text", () => {
  assert.equal(renderer.isRoleImpossibleToFit("Beautiful Blooms", { x: 0, y: 0, w: 0, h: 0 }, 18), true);
});
