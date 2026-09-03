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

// ---------------------------------------------------------------------------
// Phase 2.2 — a real THIRD framed_panel geometry (framed_block), and
// banner_led genuinely executing imageScale/imagePlacement
// ---------------------------------------------------------------------------

function geo(cd) { return renderer.resolveCompositionGeometry(baseCd(cd), 1080, 1080); }
function sig(g) { return JSON.stringify({ photo: g.photo, panel: g.panel, stack: g.stack, banner: g.banner }); }

test("framed_panel: framed_block is a genuinely THIRD geometry — distinct from both corner_accent and inset_panel, not decoration-only", () => {
  const shared = { compositionFamily: "framed_panel", imageScale: "balanced", subjectPlacement: "left_third" };
  const corner = geo({ ...shared, imagePlacement: "corner_accent" });
  const inset = geo({ ...shared, imagePlacement: "inset_panel" });
  const block = geo({ ...shared, imagePlacement: "framed_block" });
  const signatures = new Set([sig(corner), sig(inset), sig(block)]);
  assert.equal(signatures.size, 3, `expected 3 distinct framed_panel geometries, got: ${[...signatures].join(" | ")}`);
  // framed_block's own photo is a floating MARGINED block, never full-bleed
  // and never the edge-to-edge strip inset_panel uses.
  assert.notEqual(block.photo.x, 0);
  assert.notEqual(block.photo.y, 0);
});

test("framed_panel + framed_block: sympathy (left_third) and operational (center) do NOT resolve to the same geometry — a real structural difference, not a mirrored strip", () => {
  const sympathy = geo({ compositionFamily: "framed_panel", imagePlacement: "framed_block", imageScale: "balanced", subjectPlacement: "left_third" });
  const operational = geo({ compositionFamily: "framed_panel", imagePlacement: "framed_block", imageScale: "balanced", subjectPlacement: "center" });
  assert.notEqual(sig(sympathy), sig(operational));
  // Sympathy's photo sits in a side column (roughly canvas-height tall);
  // operational's sits as a top-anchored block (roughly canvas-width wide,
  // much shorter) — genuinely different footprints, not just a shifted X.
  assert.ok(sympathy.photo.h > sympathy.photo.w, "sympathy's side block should be taller than it is wide");
  assert.ok(operational.photo.w > operational.photo.h, "operational's anchored block should be wider than it is tall");
});

test("framed_panel + framed_block: center and lower_third anchor to opposite edges (a real mirror, not the same shape)", () => {
  const center = geo({ compositionFamily: "framed_panel", imagePlacement: "framed_block", imageScale: "balanced", subjectPlacement: "center" });
  const lower = geo({ compositionFamily: "framed_panel", imagePlacement: "framed_block", imageScale: "balanced", subjectPlacement: "lower_third" });
  assert.ok(center.photo.y < lower.photo.y, "center should anchor the block near the top, lower_third near the bottom");
  assert.ok(center.stack.y > center.photo.y, "center: text should fall BELOW the top-anchored block");
  assert.ok(lower.stack.y < lower.photo.y, "lower_third: text should fall ABOVE the bottom-anchored block");
});

test("banner_led: imageScale genuinely resizes the photo rect once imagePlacement confines it (dominant > balanced > supporting)", () => {
  const dominant = geo({ compositionFamily: "banner_led", imagePlacement: "framed_block", imageScale: "dominant" });
  const balanced = geo({ compositionFamily: "banner_led", imagePlacement: "framed_block", imageScale: "balanced" });
  const supporting = geo({ compositionFamily: "banner_led", imagePlacement: "framed_block", imageScale: "supporting" });
  const area = (g) => g.photo.w * g.photo.h;
  assert.ok(area(dominant) > area(balanced), "dominant should be visibly larger than balanced");
  assert.ok(area(balanced) > area(supporting), "balanced should be visibly larger than supporting");
});

test("banner_led: imagePlacement genuinely repositions/confines the photo (full_bleed vs framed_block vs corner_accent all differ)", () => {
  const fullBleed = geo({ compositionFamily: "banner_led", imagePlacement: "full_bleed", imageScale: "dominant" });
  const framedBlock = geo({ compositionFamily: "banner_led", imagePlacement: "framed_block", imageScale: "dominant" });
  const cornerAccent = geo({ compositionFamily: "banner_led", imagePlacement: "corner_accent", imageScale: "supporting" });
  const signatures = new Set([sig(fullBleed), sig(framedBlock), sig(cornerAccent)]);
  assert.equal(signatures.size, 3, `expected 3 distinct banner_led photo treatments, got: ${[...signatures].join(" | ")}`);
  // dominant + full_bleed: unchanged — the photo IS the major visual field.
  assert.equal(fullBleed.photo.x, 0);
  assert.equal(fullBleed.photo.y, 0);
  assert.equal(fullBleed.photo.w, 1080);
  assert.equal(fullBleed.photo.h, 1080);
  // supporting + corner_accent: a true small accent, nowhere close to
  // dominant full-bleed's area.
  const area = (g) => g.photo.w * g.photo.h;
  assert.ok(area(cornerAccent) < area(fullBleed) * 0.15, "corner_accent should be a true accent, not a hero");
});

test("banner_led: the banner and stack rects are unaffected by the new imagePlacement/imageScale photo logic (no regression to Phase 2.1's banner-position fix)", () => {
  const before = geo({ compositionFamily: "banner_led", textRegion: "negative_space_band_lower" });
  const after = geo({ compositionFamily: "banner_led", textRegion: "negative_space_band_lower", imagePlacement: "framed_block", imageScale: "balanced" });
  assert.deepEqual(before.banner, after.banner);
  assert.deepEqual(before.stack, after.stack);
});

// ---------------------------------------------------------------------------
// Phase 2.3 — real, bounded palette families (occasionTreatment ×
// paletteMood), never everything defaulting to the shop's own mauve/pink
// ---------------------------------------------------------------------------

const REAL_BRAND = { primaryColor: "#7c3a58", accentColor: "#c98fae" };

test("resolveOrnamentColors: occasionTreatment materially changes the resolved panel color for the SAME brand and paletteMood — not a single hardcoded pink template", () => {
  const panels = new Set([
    "elegant_editorial", "boutique_floral", "sympathy_elegance", "operational_notice", "promotional_feature"
  ].map((occ) => renderer.resolveOrnamentColors("soft_pastel", REAL_BRAND, occ).panel));
  assert.ok(panels.size >= 4, `expected real variety across occasions, got: ${[...panels].join(" | ")}`);
});

test("resolveOrnamentColors: sympathy_elegance never resolves to the vibrant/jewel-toned families used by seasonal or promotional — always quiet, never celebratory", () => {
  const loud = new Set([
    renderer.resolveOrnamentColors("vibrant_seasonal", REAL_BRAND, "seasonal_feature", null, new Date("2026-07-01")).panel,
    renderer.resolveOrnamentColors("jewel_tone", REAL_BRAND, "seasonal_feature", null, new Date("2026-07-01")).panel,
    renderer.resolveOrnamentColors(undefined, REAL_BRAND, "promotional_feature").panel
  ]);
  for (const mood of ["soft_pastel", "neutral_blush_ivory", "classic_brand", "vibrant_seasonal", "jewel_tone"]) {
    const sympathy = renderer.resolveOrnamentColors(mood, REAL_BRAND, "sympathy_elegance").panel;
    assert.ok(!loud.has(sympathy), `sympathy_elegance (${mood}) resolved a loud/celebratory panel color: ${sympathy}`);
  }
});

test("resolveOrnamentColors: operational_notice ignores paletteMood and always returns its own strong-contrast neutral — never auto-inheriting boutique pink", () => {
  const results = ["soft_pastel", "classic_brand", "vibrant_seasonal", "warm_luxury"].map(
    (mood) => renderer.resolveOrnamentColors(mood, REAL_BRAND, "operational_notice").panel
  );
  assert.equal(new Set(results).size, 1, "operational_notice's panel should not vary by paletteMood");
  const boutiquePink = renderer.resolveOrnamentColors("classic_brand", REAL_BRAND, "boutique_floral").panel;
  assert.notEqual(results[0], boutiquePink);
});

test("resolveOrnamentColors: promotional_feature uses a bolder panel than the shop's own soft brand-anchored default", () => {
  const promo = renderer.resolveOrnamentColors("classic_brand", REAL_BRAND, "promotional_feature").panel;
  const brandDefault = renderer.resolveOrnamentColors("classic_brand", REAL_BRAND, "boutique_floral").panel;
  assert.notEqual(promo, brandDefault);
});

test("resolveOrnamentColors: the shop's own brand accent can influence the palette (operational's one highlight) without forcing every role to that same color", () => {
  const distinctiveBrand = { primaryColor: "#123456", accentColor: "#00ff88" };
  const result = renderer.resolveOrnamentColors("classic_brand", distinctiveBrand, "operational_notice");
  assert.equal(result.accent, "#00ff88");
  assert.notEqual(result.panel, "#00ff88");
  assert.notEqual(result.panel, distinctiveBrand.primaryColor);
});

test("resolveSeason: maps real calendar months to the 4 real seasons", () => {
  assert.equal(renderer.resolveSeason(new Date("2026-01-15")), "winter");
  assert.equal(renderer.resolveSeason(new Date("2026-04-15")), "spring");
  assert.equal(renderer.resolveSeason(new Date("2026-07-15")), "summer");
  assert.equal(renderer.resolveSeason(new Date("2026-09-15")), "fall");
  assert.equal(renderer.resolveSeason(new Date("2026-12-15")), "winter");
});

test("resolveOrnamentColors: seasonal_feature's palette genuinely differs by real season, not just by paletteMood", () => {
  const panels = new Set(
    ["2026-02-01", "2026-05-01", "2026-08-01", "2026-11-01"].map(
      (d) => renderer.resolveOrnamentColors("vibrant_seasonal", REAL_BRAND, "seasonal_feature", null, new Date(d)).panel
    )
  );
  assert.equal(panels.size, 4, `expected 4 distinct seasonal panels, got: ${[...panels].join(" | ")}`);
});

test("resolveOrnamentColors: seasonal_feature's paletteMood (vibrant vs jewel) still varies the palette WITHIN a season", () => {
  const winterDate = new Date("2026-12-20");
  const vibrant = renderer.resolveOrnamentColors("vibrant_seasonal", REAL_BRAND, "seasonal_feature", null, winterDate).panel;
  const jewel = renderer.resolveOrnamentColors("jewel_tone", REAL_BRAND, "seasonal_feature", null, winterDate).panel;
  assert.notEqual(vibrant, jewel);
});

test("resolveOrnamentColors: classic_brand always grounds in the shop's own real colors when a family has no deliberate classic_brand look of its own", () => {
  const brand = { primaryColor: "#123456", accentColor: "#abcdef" };
  const everyday = renderer.resolveOrnamentColors("classic_brand", brand, "everyday_floral");
  assert.equal(everyday.accent, "#abcdef");
  const boutique = renderer.resolveOrnamentColors("classic_brand", brand, "boutique_floral");
  assert.equal(boutique.accent, "#abcdef");
});

test("resolveOrnamentColors: a palette family's own deliberate classic_brand look (elegant_editorial) is NOT overridden back to the raw brand hex", () => {
  const result = renderer.resolveOrnamentColors("classic_brand", REAL_BRAND, "elegant_editorial");
  assert.notEqual(result.panel, REAL_BRAND.primaryColor);
});

test("ensurePanelContrast: every resolved panel color clears a real WCAG-style contrast floor against its own chosen text color", () => {
  const brand = { primaryColor: "#7c3a58", accentColor: "#c98fae" };
  const occasions = ["everyday_floral", "elegant_editorial", "boutique_floral", "sympathy_elegance", "operational_notice", "promotional_feature", "seasonal_feature"];
  const moods = ["soft_pastel", "warm_luxury", "neutral_blush_ivory", "vibrant_seasonal", "jewel_tone", "classic_brand"];
  for (const occ of occasions) {
    for (const mood of moods) {
      const panel = renderer.resolveOrnamentColors(mood, brand, occ, null, new Date("2026-06-01")).panel;
      const c = renderer.parseColor(panel);
      const textColor = renderer.pickTextColor(c);
      const ratio = renderer.contrastRatio(c, renderer.parseColor(textColor));
      assert.ok(ratio >= 4.5, `${occ}/${mood} panel ${panel} only has contrast ratio ${ratio.toFixed(2)} against its own chosen text color`);
    }
  }
});

test("ensurePanelContrast: never throws and never returns an empty/undefined color for a pathological input", () => {
  assert.ok(renderer.ensurePanelContrast("#808080"));
  assert.ok(renderer.ensurePanelContrast("rgba(128,128,128,0.5)"));
});

// ---------------------------------------------------------------------------
// Phase 2.2/2.3 — full regression: every pre-existing composition-family
// signature test still passes with the new framed_block branch and the
// new palette engine in place (no regression to Phase 2/2.1's own work)
// ---------------------------------------------------------------------------

test("the four composition families remain structurally distinguishable after Phase 2.2's geometry changes", () => {
  const geometries = ["hero_full_bleed", "layered_editorial", "framed_panel", "banner_led"].map((f) => geo({ compositionFamily: f }));
  const signatures = geometries.map(sig);
  assert.equal(new Set(signatures).size, 4, `expected 4 distinct structural signatures, got: ${signatures.join(" | ")}`);
});

test("framed_panel's default (full_bleed) behavior is unchanged by the framed_block addition", () => {
  const g = geo({ compositionFamily: "framed_panel" });
  assert.equal(g.photo.w, 1080);
  assert.equal(g.photo.h, 1080);
  assert.equal(g.isPanelFilled, true);
});

// ---------------------------------------------------------------------------
// Phase 2.4 — photo presence, minimum visual weight, and dead-space
// ---------------------------------------------------------------------------

test("effectiveImageArea: raises a too-small imageScale toward an occasion's own floor, never lowers an already-larger one", () => {
  // boutique_floral's floor (0.42) is well above "supporting" (0.34) —
  // must be raised.
  assert.ok(renderer.effectiveImageArea("supporting", "boutique_floral") > 0.34);
  // "dominant" (0.86) already exceeds every floor — never lowered.
  assert.equal(renderer.effectiveImageArea("dominant", "boutique_floral"), 0.86);
  // An occasion with no floor (sympathy_elegance) — imageScale's own
  // plain value passes through untouched, never forced up.
  assert.equal(renderer.effectiveImageArea("supporting", "sympathy_elegance"), 0.34);
  assert.equal(renderer.effectiveImageArea("supporting", "operational_notice"), 0.34);
});

test("boutique_floral's supporting corner_accent photo cannot collapse below a real minimum visual weight", () => {
  const g = geo({ compositionFamily: "framed_panel", imagePlacement: "corner_accent", imageScale: "supporting", subjectPlacement: "right_third", occasionTreatment: "boutique_floral" });
  const photoAreaFrac = (g.photo.w * g.photo.h) / (1080 * 1080);
  // The confirmed Ashley defect measured this fixture at ~6% of the
  // canvas — a genuine thumbnail. It must now be a real design element.
  assert.ok(photoAreaFrac >= 0.15, `boutique corner_accent photo is only ${(photoAreaFrac * 100).toFixed(1)}% of the canvas`);
});

test("boutique's enlarged corner_accent photo never collides with its own text stack (guaranteed by construction, not just by luck)", () => {
  const cases = [
    { subjectPlacement: "right_third" }, { subjectPlacement: "left_third" },
    { subjectPlacement: "center" }, { subjectPlacement: "lower_third" }
  ];
  for (const c of cases) {
    const g = geo({ compositionFamily: "framed_panel", imagePlacement: "corner_accent", imageScale: "supporting", occasionTreatment: "boutique_floral", ...c });
    const photoBottom = g.photo.y + g.photo.h;
    const photoTop = g.photo.y;
    const stackBottom = g.stack.y + g.stack.h;
    const stackTop = g.stack.y;
    const noVerticalOverlap = stackTop >= photoBottom - 1 || stackBottom <= photoTop + 1;
    assert.ok(noVerticalOverlap, `corner_accent (${c.subjectPlacement}) photo and stack overlap vertically: photo ${photoTop}-${photoBottom}, stack ${stackTop}-${stackBottom}`);
  }
});

test("seasonal_feature's known deterministic fixture (inset hero, balanced, left_third) does not leave excessive dead canvas", () => {
  const g = geo({ compositionFamily: "hero_full_bleed", imagePlacement: "inset_panel", imageScale: "balanced", subjectPlacement: "left_third", occasionTreatment: "seasonal_feature" });
  const dead = renderer.estimateDeadSpaceFraction(g, 1080, 1080);
  // The confirmed Ashley defect left roughly 40%+ of the canvas doing
  // no work at all. A real floor, not "fill every pixel."
  assert.ok(dead < 0.32, `seasonal_feature's fixture leaves ${(dead * 100).toFixed(1)}% dead canvas`);
});

test("seasonal_feature's inset hero never clips text past the canvas — the text column keeps real, safe width even as the photo grows taller", () => {
  const g = geo({ compositionFamily: "hero_full_bleed", imagePlacement: "inset_panel", imageScale: "balanced", subjectPlacement: "left_third", occasionTreatment: "seasonal_feature" });
  assert.ok(g.stack.x + g.stack.w <= 1080, "stack rect must stay inside the canvas");
  assert.ok(g.stack.w >= 280, `seasonal's text column is only ${g.stack.w}px wide — too narrow for a real headline`);
});

test("promotional_feature's imageScale materially affects banner_led's photo footprint (not flattened by the floor)", () => {
  const balanced = geo({ compositionFamily: "banner_led", imagePlacement: "framed_block", imageScale: "balanced", occasionTreatment: "promotional_feature" });
  const supporting = geo({ compositionFamily: "banner_led", imagePlacement: "framed_block", imageScale: "supporting", occasionTreatment: "promotional_feature" });
  const dominant = geo({ compositionFamily: "banner_led", imagePlacement: "framed_block", imageScale: "dominant", occasionTreatment: "promotional_feature" });
  const area = (g) => g.photo.w * g.photo.h;
  assert.ok(area(dominant) >= area(balanced), "dominant should be at least as large as balanced");
  assert.ok(area(balanced) > area(supporting), "balanced should still be visibly larger than supporting even with promotional's own floor applied");
});

test("promotional_feature's photo sits flush against the banner (a real touching relationship, not a floating gap)", () => {
  const g = geo({ compositionFamily: "banner_led", imagePlacement: "framed_block", imageScale: "balanced", occasionTreatment: "promotional_feature", textRegion: "negative_space_band_lower" });
  const photoBottom = g.photo.y + g.photo.h;
  const gapPx = Math.abs(g.banner.y - photoBottom);
  assert.ok(gapPx <= 10, `photo and banner have a ${gapPx}px gap — too disconnected`);
});

test("photo/text bounding boxes for every new Phase 2.4 geometry stay entirely inside the canvas", () => {
  const cases = [
    { compositionFamily: "framed_panel", imagePlacement: "corner_accent", imageScale: "supporting", subjectPlacement: "right_third", occasionTreatment: "boutique_floral" },
    { compositionFamily: "hero_full_bleed", imagePlacement: "inset_panel", imageScale: "balanced", subjectPlacement: "left_third", occasionTreatment: "seasonal_feature" },
    { compositionFamily: "hero_full_bleed", imagePlacement: "inset_panel", imageScale: "balanced", subjectPlacement: "right_third", occasionTreatment: "seasonal_feature" },
    { compositionFamily: "hero_full_bleed", imagePlacement: "inset_panel", imageScale: "balanced", subjectPlacement: "lower_third", occasionTreatment: "seasonal_feature" },
    { compositionFamily: "banner_led", imagePlacement: "framed_block", imageScale: "balanced", occasionTreatment: "promotional_feature" }
  ];
  for (const c of cases) {
    const g = geo(c);
    for (const key of ["photo", "panel", "stack", "banner"]) {
      const rect = g[key];
      if (!rect) continue;
      assert.ok(rect.x >= -1 && rect.y >= -1 && rect.x + rect.w <= 1081 && rect.y + rect.h <= 1081,
        `${key} rect out of canvas bounds for ${JSON.stringify(c)}: ${JSON.stringify(rect)}`);
    }
  }
});

test("estimateDeadSpaceFraction: a full-bleed photo with no panel leaves zero dead space", () => {
  const g = geo({ compositionFamily: "hero_full_bleed" });
  assert.equal(renderer.estimateDeadSpaceFraction(g, 1080, 1080), 0);
});

test("estimateDeadSpaceFraction: never throws and stays within [0,1] for a degenerate geometry", () => {
  const dead = renderer.estimateDeadSpaceFraction({ photo: null, panel: null, stack: null, banner: null }, 1080, 1080);
  assert.ok(dead >= 0 && dead <= 1);
});

test("Phase 2.4 does not regress the Phase 2.2 framed_block geometries (sympathy vs operational still structurally distinct)", () => {
  const sympathy = geo({ compositionFamily: "framed_panel", imagePlacement: "framed_block", imageScale: "balanced", subjectPlacement: "left_third", occasionTreatment: "sympathy_elegance" });
  const operational = geo({ compositionFamily: "framed_panel", imagePlacement: "inset_panel", imageScale: "balanced", subjectPlacement: "center", occasionTreatment: "operational_notice" });
  assert.notEqual(sig(sympathy), sig(operational));
});

test("Phase 2.4 does not regress Phase 2.1/2.2/2.3's core geometry/palette contracts", () => {
  // All four families remain structurally distinguishable.
  const geometries = ["hero_full_bleed", "layered_editorial", "framed_panel", "banner_led"].map((f) => geo({ compositionFamily: f }));
  assert.equal(new Set(geometries.map(sig)).size, 4);
  // Palette diversity across occasions is unaffected by the geometry work.
  const panels = new Set(["elegant_editorial", "boutique_floral", "sympathy_elegance", "operational_notice"].map(
    (occ) => renderer.resolveOrnamentColors("soft_pastel", REAL_BRAND, occ).panel
  ));
  assert.ok(panels.size >= 3);
});
