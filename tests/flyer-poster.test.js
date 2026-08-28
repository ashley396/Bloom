import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();

/**
 * The poster layer borrows the renderer's own pure helpers rather than
 * carrying a second copy of them, so both files are loaded into one sandbox
 * exactly the way the browser loads them — renderer first, poster second.
 */
function loadPoster() {
  const sandbox = { module: { exports: {} }, globalThis: {}, document: undefined };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/flyer-renderer.js"), "utf8"), sandbox);
  sandbox.module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/flyer-poster.js"), "utf8"), sandbox);
  return sandbox.module.exports;
}

const poster = loadPoster();

// ---------------------------------------------------------------------------
// Determinism. "Different every time" must come from a different SEED, never
// from a random draw — or the same flyer would redraw differently on every
// reload and Undo could never restore what a florist actually approved.
// ---------------------------------------------------------------------------

test("hashSeed: the same text always yields the same seed, and different text yields a different one", () => {
  assert.equal(poster.hashSeed("Closing Early Today"), poster.hashSeed("Closing Early Today"));
  assert.notEqual(poster.hashSeed("Closing Early Today"), poster.hashSeed("Closing Early Tomorrow"));
  assert.equal(typeof poster.hashSeed("x"), "number");
});

test("seededRandom: one seed reproduces one exact sequence — a re-render is never a re-roll", () => {
  const a = poster.seededRandom(12345);
  const b = poster.seededRandom(12345);
  const first = [a(), a(), a(), a()];
  const second = [b(), b(), b(), b()];
  assert.deepEqual(first, second);
  const other = poster.seededRandom(54321);
  assert.notDeepEqual(first, [other(), other(), other(), other()]);
});

test("seededRandom: every value stays in [0,1)", () => {
  const r = poster.seededRandom(7);
  for (let i = 0; i < 200; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
});

// ---------------------------------------------------------------------------
// Palette. Ashley's requirement in her own words: it has to match the
// flowers colour-wise, while staying recognisably this shop's.
// ---------------------------------------------------------------------------

test("derivePalette: the ground is a pale tint of the actual flowers, not a fixed cream", () => {
  const pink = poster.derivePalette("#8f3f68", "#6f8f72", { r: 236, g: 170, b: 190 });
  const gold = poster.derivePalette("#8f3f68", "#6f8f72", { r: 240, g: 205, b: 90 });
  assert.notEqual(pink.ground, gold.ground, "a sunflower bouquet must not produce the same ground as a rose one");
});

test("derivePalette: the ink stays dark enough to read on the pale ground, whatever the photo is", () => {
  // A near-white photo must not bleach the ink into invisibility.
  const p = poster.derivePalette("#8f3f68", "#6f8f72", { r: 250, g: 248, b: 246 });
  const hex = p.ink.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
  assert.ok(lum < 0.5, `ink is too light to read on a pale ground: ${p.ink}`);
});

test("derivePalette: with no photo to sample it falls back to the shop's own colour and invents nothing", () => {
  const p = poster.derivePalette("#8f3f68", "#6f8f72", null);
  assert.ok(p.ink && p.ground && p.cream);
  assert.equal(typeof p.ink, "string");
});

test("derivePalette: the shop still looks like itself — a different brand colour gives a different ink", () => {
  const sample = { r: 236, g: 170, b: 190 };
  const plum = poster.derivePalette("#8f3f68", "#6f8f72", sample);
  const navy = poster.derivePalette("#1f3a6e", "#6f8f72", sample);
  assert.notEqual(plum.ink, navy.ink, "the photo must tint the brand colour, never replace it");
});

// ---------------------------------------------------------------------------
// Headline setting. The poster may change how words are SET, never what
// they say or the order they say it in.
// ---------------------------------------------------------------------------

test("splitHeadline: sets the word carrying the message in script, not the temporal qualifier", () => {
  const s = poster.splitHeadline("Closing Early Today");
  assert.equal(s.script, "Closing", "a poster scripts the verb; scripting 'Early' emphasises the wrong idea");
  assert.equal(s.tail, "Early Today");
});

test("splitHeadline: never rewrites, reorders or drops a single word", () => {
  for (const headline of ["Closing Early Today", "Opening Late Tomorrow", "Closed Monday", "Order Deadline", "New Store Hours"]) {
    const s = poster.splitHeadline(headline);
    const rebuilt = [s.lead, s.script, s.tail].filter(Boolean).join(" ");
    assert.equal(rebuilt, headline, `the poster changed the headline: "${headline}" became "${rebuilt}"`);
  }
});

test("splitHeadline: a single-word headline still gets a display treatment", () => {
  const s = poster.splitHeadline("Closed");
  assert.equal(s.script, "Closed");
  assert.equal(s.lead, "");
});

test("splitHeadline: an all-temporal headline still renders rather than vanishing", () => {
  const s = poster.splitHeadline("Today Tomorrow");
  assert.equal([s.lead, s.script, s.tail].filter(Boolean).join(" "), "Today Tomorrow");
});

// ---------------------------------------------------------------------------
// Compositions.
// ---------------------------------------------------------------------------

test("COMPOSITIONS: more than one design exists, and each is distinct", () => {
  assert.ok(poster.COMPOSITIONS.length >= 3, "one layout is a template, not a design system");
  assert.equal(new Set(poster.COMPOSITIONS).size, poster.COMPOSITIONS.length);
});

test("seeded selection spreads across the available compositions rather than favouring one", () => {
  const seen = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const rand = poster.seededRandom(poster.hashSeed("florisyn-poster:" + seed));
    seen.add(poster.COMPOSITIONS[Math.floor(rand() * poster.COMPOSITIONS.length) % poster.COMPOSITIONS.length]);
  }
  assert.equal(seen.size, poster.COMPOSITIONS.length, `only reached ${[...seen].join(", ")} — regenerate would feel repetitive`);
});

// ---------------------------------------------------------------------------
// The silent-fallback guard.
// ---------------------------------------------------------------------------

test("fontReallyLoaded: is exported, because document.fonts.check() cannot be trusted", () => {
  // Verified directly in a real browser: with the webfont request blocked,
  // document.fonts.check("400 120px 'Parisienne'") returned TRUE while the
  // glyph metrics were identical to the fallback — the canvas was drawing
  // in a system serif and reporting success. This function measures instead
  // of asking, which is the only way to catch that.
  assert.equal(typeof poster.fontReallyLoaded, "function");
  // With no document (this sandbox) it must report false, never assume true.
  assert.equal(poster.fontReallyLoaded("Parisienne", "400", 120), false);
});

// ---------------------------------------------------------------------------
// Ribbons behind wording that lands on flowers.
//
// Ashley's correction, verbatim: "if the wording is on top of flowers you
// probably need a small ribbon behind it." The hard part is the word "if" —
// a ribbon behind EVERY line is the filled-panel look that was already
// rejected, so these tests pin both directions: it must appear on flowers
// and it must stay away from calm ground.
// ---------------------------------------------------------------------------

/** An ImageData-shaped object, the same plain shape the renderer's samplers
 * accept, so this exercises the real decision path rather than a stand-in. */
function fakeImageData(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** The poster's actual ground: one smooth vertical tint, deep at the edges,
 * pale in the middle — exactly what paintGroundAndFlorals lays down. */
const CALM_GROUND = fakeImageData(300, 300, (x, y) => {
  const t = Math.abs(y - 150) / 150;
  return [Math.round(255 - 5 * t), Math.round(253 - 9 * t), Math.round(251 - 11 * t)];
});

/** Petals, leaves and shadows: high local spread, which is the whole signal. */
const FLOWERS = fakeImageData(300, 300, (x, y) => {
  const n = (x * 37 + y * 91) % 255;
  return [n, (n * 3) % 255, (n * 7) % 255];
});

const TEXT_BAND = { x: 60, y: 130, w: 180, h: 40 };
const INK = "#3a2230";

test("needsRibbonBehind: calm ground gets NO ribbon — a ribbon on every line is the rejected box", () => {
  assert.equal(poster.needsRibbonBehind({ probe: CALM_GROUND, clusters: [] }, TEXT_BAND, INK), false);
});

test("needsRibbonBehind: wording over busy floral pixels gets a ribbon", () => {
  assert.equal(poster.needsRibbonBehind({ probe: FLOWERS, clusters: [] }, TEXT_BAND, INK), true);
});

test("needsRibbonBehind: calm but too close to the ink to read still gets a ribbon", () => {
  // A flat plum-dark ground has no spread at all, so the variance signal
  // alone would miss it — and the words would be ink on near-ink.
  const flatDark = fakeImageData(300, 300, () => [70, 45, 60]);
  assert.equal(poster.needsRibbonBehind({ probe: flatDark, clusters: [] }, TEXT_BAND, INK), true);
});

test("needsRibbonBehind: with the canvas unreadable it falls back to where the flowers really are", () => {
  // A tainted canvas makes getImageData throw. The flowers are still drawn,
  // so assuming "no flowers" there would silently reintroduce the defect.
  // Real poster geometry: a 1080x1350 sheet with clusters bleeding in from
  // two opposite corners at the radius paintGroundAndFlorals actually reports.
  const clusters = [{ x: 0, y: 0, radius: 556 }, { x: 1080, y: 1350, radius: 556 }];
  const noProbe = { probe: null, clusters };
  assert.equal(poster.needsRibbonBehind(noProbe, { x: 200, y: 170, w: 400, h: 60 }, INK), true, "the shop name up in the corner cluster");
  assert.equal(poster.needsRibbonBehind(noProbe, { x: 300, y: 650, w: 480, h: 50 }, INK), false, "a line in the calm middle");
});

test("needsRibbonBehind: no flowers at all means no ribbons, ever", () => {
  assert.equal(poster.needsRibbonBehind({ probe: null, clusters: [] }, TEXT_BAND, INK), false);
});

test("floralOverlap: reports 1 at a cluster's own anchor and 0 in the calm middle", () => {
  const clusters = [{ x: 0, y: 0, radius: 250 }];
  assert.equal(poster.floralOverlap({ x: 0, y: 0, w: 40, h: 20 }, clusters), 1);
  assert.equal(poster.floralOverlap({ x: 900, y: 900, w: 40, h: 20 }, clusters), 0);
});

test("floralOverlap: no clusters is no overlap, not a crash", () => {
  assert.equal(poster.floralOverlap({ x: 0, y: 0, w: 10, h: 10 }, []), 0);
  assert.equal(poster.floralOverlap({ x: 0, y: 0, w: 10, h: 10 }, null), 0);
});

test("ribbonBand: hugs the real glyph extent rather than slabbing the font size", () => {
  // Two lines at the same font size, one with tall script ascenders and one
  // set in small caps. The ribbon must follow the glyphs, not the em box.
  const tall = poster.ribbonBand({ textWidth: 400, ascent: 150, descent: 60, fontSize: 200, baselineY: 500, cx: 540, maxWidth: 0 });
  const short = poster.ribbonBand({ textWidth: 400, ascent: 60, descent: 4, fontSize: 200, baselineY: 500, cx: 540, maxWidth: 0 });
  assert.ok(tall.h > short.h, "a taller line must get a taller ribbon");
  assert.ok(short.h < 200, `a short line got a slab ${short.h}px tall behind 200px type`);
});

test("ribbonBand: leaves clearance past the notch so no glyph sits on the cut corner", () => {
  const b = poster.ribbonBand({ textWidth: 300, ascent: 30, descent: 8, fontSize: 40, baselineY: 200, cx: 540, maxWidth: 0 });
  assert.ok(b.w >= 300 + b.notch * 2, `text would run into the notch: width ${b.w}, notch ${b.notch}`);
});

test("ribbonBand: never grows past the width it is given", () => {
  const b = poster.ribbonBand({ textWidth: 2000, ascent: 30, descent: 8, fontSize: 40, baselineY: 200, cx: 540, maxWidth: 950 });
  assert.equal(b.w, 950);
});

test("ribbonBand: the probed box is the glyphs themselves, centred on the line", () => {
  const b = poster.ribbonBand({ textWidth: 300, ascent: 30, descent: 8, fontSize: 40, baselineY: 200, cx: 540, maxWidth: 0 });
  assert.equal(b.probe.x, 540 - 150);
  assert.equal(b.probe.w, 300);
  assert.equal(b.probe.y, 170);
  assert.equal(b.probe.h, 38);
});

test("ribbonBand: falls back to sane metrics when the canvas reports no glyph box", () => {
  // Older canvas implementations return 0 for actualBoundingBox*; a zero-height
  // ribbon would be an invisible no-op that still claimed to protect the line.
  const b = poster.ribbonBand({ textWidth: 300, ascent: 0, descent: 0, fontSize: 40, baselineY: 200, cx: 540, maxWidth: 0 });
  assert.ok(b.h > 40, `degenerate ribbon height: ${b.h}`);
});

test("contrastRatio: matches the known white-on-black extreme and self-contrast", () => {
  assert.ok(Math.abs(poster.contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }) - 21) < 0.05);
  assert.equal(poster.contrastRatio({ r: 90, g: 40, b: 70 }, { r: 90, g: 40, b: 70 }), 1);
});

test("ribbonWidthLimit: a ribbon stays inside the border rules with air, not just inside the sheet", () => {
  const w = 1080, h = 1350;
  const limit = poster.ribbonWidthLimit(w, h);
  const m = Math.min(w, h);
  const innerRule = Math.round(m * 0.038) + Math.round(m * 0.011); // where drawBorder's second rule sits
  const leftEdge = (w - limit) / 2;
  assert.ok(leftEdge > innerRule + 8, `ribbon edge ${leftEdge} crowds the inner rule at ${innerRule}`);
  assert.ok(limit > w * 0.7, `limit ${limit} is so tight the ribbon could not carry a headline`);
});
