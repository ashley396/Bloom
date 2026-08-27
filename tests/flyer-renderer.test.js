import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();

function loadFlyerRenderer() {
  const source = fs.readFileSync(path.join(root, "public/flyer-renderer.js"), "utf8");
  const sandbox = { module: { exports: {} }, globalThis: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports;
}

const renderer = loadFlyerRenderer();

function makeImageData(width, height, painter) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = painter(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, data };
}

test("regionRect: converts fractional template regions into real pixel coordinates for the given canvas size", () => {
  // Compared field-by-field, not via assert.deepEqual — the object comes
  // back from a vm sandbox (a different realm), and strict deepEqual
  // rejects two structurally-identical plain objects from different
  // realms as "not reference-equal" even though every field matches.
  const rect = renderer.regionRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 1000, 800);
  assert.equal(rect.x, 100);
  assert.equal(rect.y, 160);
  assert.equal(rect.w, 500);
  assert.equal(rect.h, 200);
});

test("regionRect: a missing region never throws — degrades to a zero-size rect", () => {
  const rect = renderer.regionRect(undefined, 1000, 800);
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 0);
  assert.equal(rect.w, 0);
  assert.equal(rect.h, 0);
});

test("relativeLuminance: pure white is much higher than pure black", () => {
  assert.ok(renderer.relativeLuminance(255, 255, 255) > renderer.relativeLuminance(0, 0, 0));
  assert.equal(renderer.relativeLuminance(0, 0, 0), 0);
  assert.ok(renderer.relativeLuminance(255, 255, 255) > 0.99);
});

test("sampleAverageColor: a solid-color rectangle averages to exactly that color", () => {
  const img = makeImageData(20, 20, () => [200, 50, 100]);
  const avg = renderer.sampleAverageColor(img, { x: 0, y: 0, w: 20, h: 20 }, 1);
  assert.equal(Math.round(avg.r), 200);
  assert.equal(Math.round(avg.g), 50);
  assert.equal(Math.round(avg.b), 100);
});

test("sampleAverageColor: a rect entirely outside the image bounds never throws — clamps to the nearest valid pixel rather than crashing", () => {
  const img = makeImageData(10, 10, () => [40, 40, 40]);
  const avg = renderer.sampleAverageColor(img, { x: 500, y: 500, w: 20, h: 20 }, 1);
  assert.equal(Math.round(avg.r), 40);
  assert.equal(Math.round(avg.g), 40);
  assert.equal(Math.round(avg.b), 40);
});

test("sampleAverageColor: a fully empty image (0 pixels sampled) falls back to white", () => {
  const img = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  const avg = renderer.sampleAverageColor(img, { x: 0, y: 0, w: 10, h: 10 }, 1);
  assert.equal(avg.r, 255);
  assert.equal(avg.g, 255);
  assert.equal(avg.b, 255);
});

// Design pass v3 (Ashley, live-tested feedback): text color is restricted
// to her explicit allowed palette — "cream, white, navy or charcoal text
// based on the photo's natural contrast" — never an arbitrary brand-color
// tint, and never assumed against a flat dark backdrop (there isn't one
// anymore; see the removal of drawGradientBand below).
test("pickTextColor: a bright background picks charcoal-navy text, a dark background picks cream text", () => {
  assert.equal(renderer.pickTextColor({ r: 250, g: 248, b: 245 }), "#1f2733");
  assert.equal(renderer.pickTextColor({ r: 20, g: 15, b: 25 }), "#f8f0e3");
});

test("needsScrim: a very light or very dark background needs no scrim when flat (low variance)", () => {
  assert.equal(renderer.needsScrim({ r: 255, g: 255, b: 255 }, 0), false);
  assert.equal(renderer.needsScrim({ r: 10, g: 8, b: 12 }, 0), false);
});

test("needsScrim: a midtone background always needs a scrim, even flat", () => {
  // WCAG relative luminance is gamma-corrected, so a naive "medium gray"
  // RGB triplet (~128,128,128) actually scores quite dark (~0.22) — use a
  // lighter gray that genuinely lands in the midtone luminance band.
  assert.equal(renderer.needsScrim({ r: 180, g: 180, b: 180 }, 0), true);
});

test("needsScrim: high variance (a busy photo, not a flat gradient) needs a scrim even at a 'safe' average luminance", () => {
  assert.equal(renderer.needsScrim({ r: 250, g: 248, b: 245 }, 80), true);
});

test("sampleColorVariance: a flat solid color scores 0 variance", () => {
  const img = makeImageData(10, 10, () => [128, 128, 128]);
  assert.equal(renderer.sampleColorVariance(img, { x: 0, y: 0, w: 10, h: 10 }, 1), 0);
});

test("sampleColorVariance: a half-black/half-white rectangle scores high variance", () => {
  const img = makeImageData(10, 10, (x) => (x < 5 ? [0, 0, 0] : [255, 255, 255]));
  const variance = renderer.sampleColorVariance(img, { x: 0, y: 0, w: 10, h: 10 }, 1);
  assert.ok(variance > 200, `expected high variance, got ${variance}`);
});

test("scaleMultiplier: every real SCALE_STEPS value (ai-visual-revisions.js) maps to a real multiplier", () => {
  for (const key of ["small", "normal", "large", "x-large", "xx-large"]) {
    assert.ok(renderer.scaleMultiplier(key) > 0, `scaleMultiplier(${key}) must be positive`);
  }
  assert.equal(renderer.scaleMultiplier("normal"), 1);
  assert.ok(renderer.scaleMultiplier("large") > renderer.scaleMultiplier("normal"));
  assert.ok(renderer.scaleMultiplier("small") < renderer.scaleMultiplier("normal"));
});

test("scaleMultiplier: an unrecognized scale key falls back to 'normal' (1×) rather than throwing", () => {
  assert.equal(renderer.scaleMultiplier("not_a_real_scale"), 1);
  assert.equal(renderer.scaleMultiplier(undefined), 1);
});

test("scaleMultiplier: every one of the five SCALE_STEPS is a distinct value — no two steps render the same size", () => {
  const values = ["small", "normal", "large", "x-large", "xx-large"].map((k) => renderer.scaleMultiplier(k));
  assert.equal(new Set(values).size, 5, `expected 5 distinct multipliers, got ${JSON.stringify(values)}`);
});

test("effectivePaletteColors: with no style, uses the shop's own brand colors unchanged", () => {
  const colors = renderer.effectivePaletteColors({ primaryColor: "#123456", accentColor: "#abcdef" }, null);
  assert.equal(colors.primary, "#123456");
  assert.equal(colors.accent, "#abcdef");
});

test("effectivePaletteColors: paletteInclude (e.g. 'use more cream') overrides the brand colors with the named color", () => {
  const colors = renderer.effectivePaletteColors({ primaryColor: "#123456" }, { paletteInclude: ["cream"], paletteExclude: [] });
  assert.equal(colors.primary, "#f3ead9");
});

test("effectivePaletteColors: paletteExclude alone ('less pink') with nothing to use instead moves off the brand colors rather than silently keeping them", () => {
  const colors = renderer.effectivePaletteColors({ primaryColor: "#123456", accentColor: "#654321" }, { paletteInclude: [], paletteExclude: ["pink"] });
  assert.notEqual(colors.primary, "#123456");
  assert.notEqual(colors.accent, "#654321");
});

test("effectivePaletteColors: an unrecognized color name in paletteInclude falls back to the brand color rather than a broken value", () => {
  const colors = renderer.effectivePaletteColors({ primaryColor: "#123456" }, { paletteInclude: ["not_a_real_color"], paletteExclude: [] });
  assert.equal(colors.primary, "#123456");
});

function fakeCtx() {
  return { fillStyle: null, fillRect() {}, createLinearGradient: () => ({ addColorStop() {} }) };
}

test("paintBrandBackground: an untouched sympathy (muted) flyer keeps its quiet default tone, ignoring the shop's own brand colors", () => {
  const ctx = fakeCtx();
  renderer.paintBrandBackground(ctx, 1080, 1080, { palette: { background: "muted" } }, { primaryColor: "#123456" }, { paletteInclude: [], paletteExclude: [] });
  assert.equal(ctx.fillStyle, "#efe9e6");
});

test("paintBrandBackground: a color revision on a muted (sympathy) flyer actually changes the background — the bug this test guards against had it silently staying #efe9e6 forever", () => {
  const ctx = fakeCtx();
  renderer.paintBrandBackground(ctx, 1080, 1080, { palette: { background: "muted" } }, { primaryColor: "#123456" }, { paletteInclude: ["cream"], paletteExclude: [] });
  assert.equal(ctx.fillStyle, "#f3ead9");
  assert.notEqual(ctx.fillStyle, "#efe9e6");
});

test("computePanelRect: wraps the union of headline/body/cta/contact regions with a comfortable margin, in real pixel coordinates", () => {
  const template = {
    regions: {
      headline: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
      body: { x: 0.1, y: 0.35, w: 0.8, h: 0.2 },
      cta: { x: 0.1, y: 0.6, w: 0.8, h: 0.1 },
      contact: { x: 0.1, y: 0.85, w: 0.8, h: 0.05 }
    }
  };
  const rect = renderer.computePanelRect(template, 1000, 1000);
  // The union spans y 0.1..0.9 and x 0.1..0.9 — the panel must fully
  // contain that (padding only ever grows it, never shrinks it).
  assert.ok(rect.x <= 100, `expected panel to start at or before x=100, got ${rect.x}`);
  assert.ok(rect.y <= 100, `expected panel to start at or before y=100, got ${rect.y}`);
  assert.ok(rect.x + rect.w >= 900, `expected panel to extend to at least x=900, got ${rect.x + rect.w}`);
  assert.ok(rect.y + rect.h >= 900, `expected panel to extend to at least y=900, got ${rect.y + rect.h}`);
});

test("computePanelRect: never exceeds the canvas bounds even with generous padding near the edge", () => {
  const template = { regions: { headline: { x: 0, y: 0, w: 1, h: 1 }, body: { x: 0, y: 0, w: 0, h: 0 }, cta: { x: 0, y: 0, w: 0, h: 0 }, contact: { x: 0, y: 0, w: 0, h: 0 } } };
  const rect = renderer.computePanelRect(template, 1000, 1000);
  assert.ok(rect.x >= 0 && rect.y >= 0, "panel must never start off-canvas");
  assert.ok(rect.x + rect.w <= 1000 && rect.y + rect.h <= 1000, "panel must never extend past the canvas");
});

test("computePanelRect: a template with no recognized regions degrades to a sane centered default rather than throwing", () => {
  const rect = renderer.computePanelRect({ regions: {} }, 1000, 1000);
  assert.ok(rect.w > 0 && rect.h > 0);
});

// Visual-quality directive (Ashley, live-tested feedback): "remove the
// large white or beige content box... the floral image must fill the
// complete canvas edge to edge." computeBandRect is the actual geometry
// the renderer now draws against — a full-WIDTH band that only ever
// covers the bottom portion of the canvas, never a centered/inset box.
test("computeBandRect: always spans the FULL WIDTH (x=0, w=width) — never inset, so it can never read as a box floating over the photo", () => {
  const template = {
    regions: {
      headline: { x: 0.1, y: 0.55, w: 0.8, h: 0.15 },
      body: { x: 0.1, y: 0.7, w: 0.8, h: 0.1 },
      cta: { x: 0.3, y: 0.8, w: 0.4, h: 0.07 },
      contact: { x: 0.1, y: 0.9, w: 0.8, h: 0.05 }
    }
  };
  const rect = renderer.computeBandRect(template, 1000, 1000);
  assert.equal(rect.x, 0, "the band must start at the very left edge");
  assert.equal(rect.w, 1000, "the band must span the full canvas width");
});

test("computeBandRect: only covers the BOTTOM portion of the canvas — the upper photo stays completely uncovered", () => {
  const template = {
    regions: {
      headline: { x: 0.1, y: 0.55, w: 0.8, h: 0.15 },
      body: { x: 0.1, y: 0.7, w: 0.8, h: 0.1 },
      cta: { x: 0.3, y: 0.8, w: 0.4, h: 0.07 },
      contact: { x: 0.1, y: 0.9, w: 0.8, h: 0.05 }
    }
  };
  const rect = renderer.computeBandRect(template, 1000, 1000);
  // The topmost real text region starts at y=0.55 — the band's own top
  // must sit at or below roughly that fraction (a small breathing margin
  // above it, never far above it), and must reach exactly to the bottom.
  assert.ok(rect.y >= 400, `expected the band to start well below the canvas midpoint, got y=${rect.y}`);
  assert.equal(rect.y + rect.h, 1000, "the band must reach exactly to the bottom of the canvas");
});

test("computeBandRect: a template with no recognized regions degrades to a sane default rather than throwing", () => {
  const rect = renderer.computeBandRect({ regions: {} }, 1000, 1000);
  assert.ok(rect.w > 0 && rect.h > 0);
  assert.equal(rect.x, 0);
});

test("computeBandRect: never produces a negative height even for a region pinned at the very top", () => {
  const rect = renderer.computeBandRect({ regions: { headline: { x: 0, y: 0, w: 1, h: 1 } } }, 1000, 1000);
  assert.ok(rect.h >= 0);
  assert.ok(rect.y >= 0);
});

test("paintBrandBackground: a brand_gradient template with no revision uses the shop's own brand colors via the gradient", () => {
  const ctx = fakeCtx();
  let stops = [];
  ctx.createLinearGradient = () => ({ addColorStop: (offset, color) => stops.push(color) });
  renderer.paintBrandBackground(ctx, 1080, 1080, { palette: { background: "brand_gradient" } }, { primaryColor: "#123456", accentColor: "#abcdef" }, { paletteInclude: [], paletteExclude: [] });
  assert.deepEqual(stops, ["#123456", "#abcdef"]);
});

// Visual-quality directive (Ashley, live-tested feedback — third round):
// the gradient-band approach itself is rejected outright, regardless of
// hue — "Never add a brand color wash over an existing image. A shop's
// brand color should not become a large transparent layer covering the
// flowers." drawGradientBand/darkenForBandContrast are gone entirely —
// legibility now comes from pickRegionTextStyle, which samples the
// canvas's OWN real rendered pixels at each text region and returns real
// cream/charcoal-navy contrast plus a thin outline only where the region
// actually needs one (needsScrim), never a filled color layer.
test("FlorisynFlyerRenderer no longer exposes a paintable color-wash band — drawGradientBand/darkenForBandContrast are gone", () => {
  assert.equal(renderer.drawGradientBand, undefined);
  assert.equal(renderer.darkenForBandContrast, undefined);
});

function fakeImageCtx(pixelPainter) {
  return {
    save() {}, restore() {}, fillRect() {}, strokeText() {}, fillText() {}, measureText: () => ({ width: 40 }),
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const [r, g, b] = pixelPainter(x + px, y + py);
          const i = (py * w + px) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
      }
      return { width: w, height: h, data };
    }
  };
}

test("pickRegionTextStyle: a real dark photo region picks cream text with no outline needed (flat/dark, not busy)", () => {
  const ctx = fakeImageCtx(() => [20, 15, 25]);
  const style = renderer.pickRegionTextStyle(ctx, { x: 0, y: 0, w: 20, h: 20 });
  assert.equal(style.color, "#f8f0e3");
  assert.equal(style.outline, null);
});

test("pickRegionTextStyle: a real bright photo region picks charcoal-navy text", () => {
  const ctx = fakeImageCtx(() => [250, 248, 245]);
  const style = renderer.pickRegionTextStyle(ctx, { x: 0, y: 0, w: 20, h: 20 });
  assert.equal(style.color, "#1f2733");
});

test("pickRegionTextStyle: a busy, high-variance region (real flower petals/leaves) gets a thin outline — never a filled panel", () => {
  // Stripes wide enough (5px) to survive sampleAverageColor/
  // sampleColorVariance's stride-4 pixel sampling — a true 1px checkerboard
  // would alias to a single color at that stride, which is a property of
  // the sampler's speed/accuracy tradeoff, not something this test should
  // fight; real photo texture is never single-pixel-periodic anyway.
  const ctx = fakeImageCtx((x) => (Math.floor(x / 5) % 2 === 0 ? [20, 15, 25] : [240, 235, 230]));
  const style = renderer.pickRegionTextStyle(ctx, { x: 0, y: 0, w: 20, h: 20 });
  assert.ok(style.outline, "a busy region must get an outline for insurance");
  assert.ok(style.outline.width > 0);
});

test("pickRegionTextStyle: never throws on a tainted (cross-origin, unreadable) canvas — degrades to a safe default", () => {
  const ctx = { getImageData() { throw new Error("tainted canvas"); } };
  const style = renderer.pickRegionTextStyle(ctx, { x: 0, y: 0, w: 20, h: 20 });
  assert.equal(style.color, "#f8f0e3");
  assert.ok(style.outline, "the tainted-canvas fallback must still carry an outline for safety");
});

// ---------------------------------------------------------------------------
// CTA lockup geometry (computeCtaLayout)
//
// A real, live-found defect caught by inspecting an actual rendered flyer
// before Ashley's live visual test: drawCtaLabel had no auto-fit at all
// (unlike drawRegionText) and positioned its divider rule as if the CTA
// were always ONE line. The default operational-notice CTA — "Call
// <phone> to place an order." — genuinely wraps in the notice template's
// cta region, so the rule was drawn straight THROUGH the last line and the
// block overflowed toward the contact line. Nothing anywhere asserted this
// geometry, which is exactly why a fully green suite still shipped it.
// ---------------------------------------------------------------------------

// A measuring ctx with a realistic proportional-width model (wide enough
// that a full CTA sentence genuinely wraps, as it does in a real browser).
function measuringCtx(perCharPx = 26) {
  return {
    font: "",
    letterSpacing: "0px",
    measureText(text) {
      return { width: String(text).length * perCharPx };
    }
  };
}

// The real notice-template cta region at 1080x1080 (flyer-templates.js:
// { x: 0.22, y: 0.775, w: 0.56, h: 0.08 }).
const NOTICE_CTA_RECT = { x: 238, y: 837, w: 605, h: 86 };

test("computeCtaLayout: the divider rule is always BELOW the last line of the CTA, never struck through it (the real live defect)", () => {
  const layout = renderer.computeCtaLayout(measuringCtx(), NOTICE_CTA_RECT, "Call 606-506-4039 to place an order.");
  assert.ok(layout.lines.length > 1, "this CTA must genuinely wrap, or the test isn't exercising the defect");
  assert.ok(
    layout.dividerY > layout.lastLineBottom,
    `divider (${layout.dividerY}) must sit below the last line's bottom (${layout.lastLineBottom}) — it used to land inside it`
  );
});

test("computeCtaLayout: the whole lockup (wrapped text + divider) stays inside its own region — it never spills toward the contact line", () => {
  const layout = renderer.computeCtaLayout(measuringCtx(), NOTICE_CTA_RECT, "Call 606-506-4039 to place an order.");
  const regionTop = NOTICE_CTA_RECT.y;
  const regionBottom = NOTICE_CTA_RECT.y + NOTICE_CTA_RECT.h;
  assert.ok(layout.blockTop >= regionTop, `text top ${layout.blockTop} must not rise above the region top ${regionTop}`);
  assert.ok(layout.dividerY <= regionBottom, `divider ${layout.dividerY} must not fall below the region bottom ${regionBottom}`);
});

test("computeCtaLayout: an absurdly long CTA shrinks to fit but never below the readable floor (62% of the base size), matching drawRegionText's policy", () => {
  const rect = NOTICE_CTA_RECT;
  const baseSize = Math.max(17, Math.round(rect.h * 0.52));
  const layout = renderer.computeCtaLayout(
    measuringCtx(),
    rect,
    "Call 606-506-4039 to place an order for same-day delivery anywhere in the county before we close"
  );
  assert.ok(layout.fontSize < baseSize, "a very long CTA must actually shrink");
  assert.ok(
    layout.fontSize >= Math.round(baseSize * 0.62) - 1,
    `font ${layout.fontSize} must stay at or above the ~62% readable floor of ${baseSize} — mobile readability is a hard requirement`
  );
});

test("computeCtaLayout: a short CTA that fits on one line keeps the full base size (no needless shrinking)", () => {
  const rect = NOTICE_CTA_RECT;
  const baseSize = Math.max(17, Math.round(rect.h * 0.52));
  const layout = renderer.computeCtaLayout(measuringCtx(6), rect, "Call us");
  assert.equal(layout.lines.length, 1);
  assert.equal(layout.fontSize, baseSize);
  assert.ok(layout.dividerY > layout.lastLineBottom);
});

// ---------------------------------------------------------------------------
// Phone display + the one-phone-per-flyer rule
// ---------------------------------------------------------------------------

test("formatPhoneForDisplay: a bare digit string (a real shop's stored '16063319374') becomes readable, never printed raw on a customer-facing flyer", () => {
  assert.equal(renderer.formatPhoneForDisplay("16063319374"), "1-606-331-9374");
  assert.equal(renderer.formatPhoneForDisplay("6065064039"), "606-506-4039");
});

test("formatPhoneForDisplay: a number the florist already formatted is THEIR formatting and is returned untouched", () => {
  assert.equal(renderer.formatPhoneForDisplay("606-506-4039"), "606-506-4039");
  assert.equal(renderer.formatPhoneForDisplay("(606) 506-4039"), "(606) 506-4039");
  assert.equal(renderer.formatPhoneForDisplay("606.506.4039"), "606.506.4039");
});

test("formatPhoneForDisplay: an international or unrecognized number is never mangled into a wrong shape", () => {
  assert.equal(renderer.formatPhoneForDisplay("+441632960961"), "+441632960961");
  assert.equal(renderer.formatPhoneForDisplay("12345"), "12345");
  assert.equal(renderer.formatPhoneForDisplay(""), "");
  assert.equal(renderer.formatPhoneForDisplay(null), "");
});

test("contactLineParts: a request-supplied CTA phone that differs from the shop profile's phone means the footer drops its own — one flyer never advertises two different numbers", () => {
  const parts = [...renderer.contactLineParts(
    { shopName: "Testville Flowers", phone: "16063319374" },
    "Call 606-506-4039 to place an order."
  )];
  assert.deepEqual(parts, ["Testville Flowers"]);
  assert.ok(!parts.join(" ").includes("331"), "the profile number must not appear alongside a different CTA number");
});

test("contactLineParts: the same number written two different ways is not treated as a conflict — the footer still shows it", () => {
  const parts = [...renderer.contactLineParts(
    { shopName: "Testville Flowers", phone: "6065064039" },
    "Call 606-506-4039 to place an order."
  )];
  assert.deepEqual(parts, ["Testville Flowers", "606-506-4039"]);
});

test("contactLineParts: with no phone in the CTA the shop's own (formatted) number is shown, and the shop name is always present", () => {
  const parts = [...renderer.contactLineParts(
    { shopName: "Testville Flowers", phone: "16063319374", website: "testville.example" },
    "Stop by today."
  )];
  assert.deepEqual(parts, ["Testville Flowers", "1-606-331-9374", "testville.example"]);
});
