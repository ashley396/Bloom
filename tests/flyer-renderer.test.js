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

test("pickTextColor: a bright background picks dark text, a dark background picks white text", () => {
  assert.equal(renderer.pickTextColor({ r: 250, g: 248, b: 245 }), "#231a26");
  assert.equal(renderer.pickTextColor({ r: 20, g: 15, b: 25 }), "#ffffff");
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

// Visual-quality directive (Ashley, live-tested feedback — second round):
// "these flyers can now be made in any color, it is not set to navy or
// dark colors — this is a flower shop, it should [be] happiness." The
// gradient band's color used to be hardcoded navy (rgba(9,15,26,...)) no
// matter what — these tests prove the band now derives its color from
// whatever brand color it's given, self-adjusting for text contrast
// rather than always landing on the same dark neutral.
test("darkenForBandContrast: an already-dark color passes through almost unchanged", () => {
  const dark = renderer.darkenForBandContrast("#1a1420", 0.09);
  assert.ok(Math.abs(dark.r - 0x1a) <= 2 && Math.abs(dark.g - 0x14) <= 2 && Math.abs(dark.b - 0x20) <= 2, `expected near-unchanged, got ${JSON.stringify(dark)}`);
});

test("darkenForBandContrast: a bright, happy brand color (hot pink) still darkens enough for light text to read, but stays visibly pink — not crushed to black or navy", () => {
  const dark = renderer.darkenForBandContrast("#ff4fa3", 0.09);
  assert.ok(renderer.relativeLuminance(dark.r, dark.g, dark.b) <= 0.11, `expected a dark-enough result for contrast, got luminance ${renderer.relativeLuminance(dark.r, dark.g, dark.b)}`);
  // Still recognizably pink/magenta, not gray or navy: red channel clearly dominant.
  assert.ok(dark.r > dark.g && dark.r > dark.b, `expected the pink hue to survive darkening, got ${JSON.stringify(dark)}`);
  assert.ok(dark.r > 20, "must never crush all the way to near-black");
});

test("darkenForBandContrast: never returns pure black even for a very light input — floors at a visible scale", () => {
  const dark = renderer.darkenForBandContrast("#fdf6ec", 0.02); // an unreasonably strict target
  assert.ok(dark.r > 0 || dark.g > 0 || dark.b > 0, "must never floor all the way to (0,0,0)");
});

test("darkenForBandContrast: a malformed/missing hex never throws — falls back to a warm plum, never navy", () => {
  const dark = renderer.darkenForBandContrast(null, 0.09);
  assert.ok(dark.r > dark.b, "the fallback must read as warm (red-leaning), not navy (blue-leaning)");
});

function fakeBandCtx() {
  const stops = [];
  return {
    stops,
    save() {},
    restore() {},
    fillRect() {},
    createLinearGradient: () => ({ addColorStop: (offset, color) => stops.push(color) })
  };
}

test("drawGradientBand: two different shop brand colors produce two genuinely different band gradients — proves the band is no longer a fixed hardcoded color", () => {
  const rect = { x: 0, y: 500, w: 1000, h: 500 };
  const pinkCtx = fakeBandCtx();
  renderer.drawGradientBand(pinkCtx, rect, { primary: "#e2437a" });
  const greenCtx = fakeBandCtx();
  renderer.drawGradientBand(greenCtx, rect, { primary: "#3c6b3f" });
  assert.notDeepEqual(pinkCtx.stops, greenCtx.stops, "different brand colors must produce different band gradients");
});

test("drawGradientBand: with no brand color supplied at all, falls back to a warm plum default — never the old hardcoded navy", () => {
  const rect = { x: 0, y: 500, w: 1000, h: 500 };
  const ctx = fakeBandCtx();
  renderer.drawGradientBand(ctx, rect, null);
  for (const stop of ctx.stops) {
    assert.doesNotMatch(stop, /rgba\(9,15,26/, "the old hardcoded navy top-of-band color must be gone");
    assert.doesNotMatch(stop, /rgba\(7,12,22/, "the old hardcoded navy bottom-of-band color must be gone");
  }
});

test("drawGradientBand: still keeps the same transparent-top-to-opaque-bottom structure Ashley approved — only the hue changed, not the shape", () => {
  const rect = { x: 0, y: 500, w: 1000, h: 500 };
  const ctx = fakeBandCtx();
  renderer.drawGradientBand(ctx, rect, { primary: "#b93870" });
  assert.equal(ctx.stops.length, 3);
  assert.match(ctx.stops[0], /,0\)$/, "top stop must still be fully transparent");
  assert.match(ctx.stops[2], /,0\.93\)$/, "bottom stop must still be strongly opaque");
});
