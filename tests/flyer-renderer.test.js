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
