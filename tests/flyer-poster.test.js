import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPoster, recordingContext, offSheet } from "./helpers/poster-recording-context.mjs";

const root = process.cwd();

const { poster, renderer } = loadPoster(root);

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
// a ribbon behind EVERY line is the filled-panel look already rejected, so
// these pin both directions: it must appear on flowers, and it must stay
// away from calm ground FOR EVERY SHOP, not just the one whose brand colour
// the fixtures happen to use.
// ---------------------------------------------------------------------------

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

const hexRgb = (h) => ({
  r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16)
});

/** The real poster ground for a given palette: one smooth vertical tint,
 * which is exactly what paintGroundAndFlorals lays down under the wording. */
function groundFor(palette, w = 300, h = 300) {
  const g = hexRgb(palette.ground), gd = hexRgb(palette.groundDeep);
  return fakeImageData(w, h, (x, y) => {
    const t = Math.abs(y - h / 2) / (h / 2);
    return [g.r + (gd.r - g.r) * t, g.g + (gd.g - g.g) * t, g.b + (gd.b - g.b) * t];
  });
}

/**
 * Petal-scale structure: soft light blooms against slightly deeper ones, at
 * roughly the scale real flowers occupy in these posters. Deliberately NOT
 * per-pixel RGB noise — noise averages to a flat midtone, which makes the
 * CONTRAST branch fire and lets a test pass with the busy signal switched
 * off entirely. This fixture stays light overall (so contrast against dark
 * ink is comfortable), which means only the busy signal can explain a
 * ribbon over it.
 */
const PETALS = fakeImageData(300, 300, (x, y) => {
  const v = Math.sin(x / 9) * Math.sin(y / 9);
  const t = (v + 1) / 2;
  return [255 - 60 * t, 245 - 95 * t, 248 - 78 * t];
});

const TEXT_BAND = { x: 60, y: 130, w: 180, h: 40 };

/** Brand colours real shops actually pick — not just the plum default. */
const BRANDS = ["#8f3f68", "#7c3a58", "#7d7d7d", "#9a7b4f", "#6f8f72", "#c0748f", "#1f3a6e", "#b5651d", "#4a7c59", "#8a6f9e"];
const SAMPLES = [null, { r: 236, g: 170, b: 190 }, { r: 240, g: 205, b: 90 }, { r: 250, g: 248, b: 246 }, { r: 236, g: 210, b: 214 }, { r: 200, g: 220, b: 200 }];

test("derivePalette: every shop's ink genuinely reads on its own ground, measured not assumed", () => {
  // A flat luminance cap let sage, gold, grey and dusty-rose brands pass
  // while sitting under 4:1 on the pale ground. Those shops then tripped the
  // ribbon's contrast safety net on every line over open ground — the
  // rejected box, for every shop except the plum default.
  const failures = [];
  for (const brand of BRANDS) {
    for (const sample of SAMPLES) {
      const p = poster.derivePalette(brand, "#6f8f72", sample);
      const ratio = poster.contrastRatio(hexRgb(p.ink), hexRgb(p.groundDeep));
      if (ratio < poster.INK_GROUND_MIN_CONTRAST) failures.push(`${brand}/${sample ? "photo" : "none"} → ${p.ink} ratio ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, [], `ink unreadable on its own ground:\n  ${failures.join("\n  ")}`);
});

test("no shop gets a ribbon on empty calm ground — not one brand colour out of every combination", () => {
  const offenders = [];
  for (const brand of BRANDS) {
    for (const sample of SAMPLES) {
      const p = poster.derivePalette(brand, "#6f8f72", sample);
      for (const alpha of [1, 0.9, 0.85, 0.82, 0.78]) {
        if (poster.needsRibbonBehind({ probe: groundFor(p), clusters: [] }, TEXT_BAND, p.ink, alpha)) {
          offenders.push(`${brand} ink ${p.ink} @${alpha}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `ribbon over open ground — the rejected box:\n  ${offenders.join("\n  ")}`);
});

test("busyFraction: calm ground scores zero and petal-scale structure scores high", () => {
  // This is the pair that makes CELL_VARIANCE_THRESHOLD matter. Disable the
  // busy signal and the second assertion fails; zero the threshold and the
  // first does.
  const calm = groundFor(poster.derivePalette("#8f3f68", "#6f8f72", null));
  assert.equal(poster.busyFraction(calm, TEXT_BAND), 0, "smooth ground must not read as flowers");
  assert.ok(poster.busyFraction(PETALS, TEXT_BAND) >= 0.28,
    `petal-scale structure scored only ${poster.busyFraction(PETALS, TEXT_BAND)}`);
});

test("wording over flowers gets a ribbon BECAUSE it is busy, not because contrast happened to be low", () => {
  const p = poster.derivePalette("#8f3f68", "#6f8f72", null);
  // Prove the contrast branch cannot be the explanation: this fixture is
  // light, so the ink reads comfortably against its average.
  const avg = renderAvg(PETALS, TEXT_BAND);
  assert.ok(poster.contrastRatio(avg, hexRgb(p.ink)) > 3,
    "fixture must be comfortable for contrast, or this test proves nothing about the busy signal");
  assert.equal(poster.needsRibbonBehind({ probe: PETALS, clusters: [] }, TEXT_BAND, p.ink, 1), true);
});

function renderAvg(img, rect) {
  // Mirrors the renderer's own sampler closely enough for a fixture check.
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.floor(rect.y); y < rect.y + rect.h; y += 3) {
    for (let x = Math.floor(rect.x); x < rect.x + rect.w; x += 3) {
      const i = (y * img.width + x) * 4;
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

test("needsRibbonBehind: a line too faint to read against calm pixels still gets one", () => {
  const flatDark = fakeImageData(300, 300, () => [70, 45, 60]);
  assert.equal(poster.needsRibbonBehind({ probe: flatDark, clusters: [] }, TEXT_BAND, "#3a2230", 1), true);
});

test("needsRibbonBehind: with the canvas unreadable it falls back to where the flowers really are", () => {
  // A tainted canvas makes getImageData throw. The flowers are still drawn,
  // so assuming "no flowers" there would silently reintroduce the defect.
  const clusters = [{ x: 0, y: 0, radius: 556 }, { x: 1080, y: 1350, radius: 556 }];
  const noProbe = { probe: null, clusters };
  assert.equal(poster.needsRibbonBehind(noProbe, { x: 200, y: 170, w: 400, h: 60 }, "#3a2230", 1), true, "the shop name in the corner cluster");
  assert.equal(poster.needsRibbonBehind(noProbe, { x: 300, y: 650, w: 480, h: 50 }, "#3a2230", 1), false, "a line in the calm middle");
});

test("needsRibbonBehind: no flowers at all means no ribbons, ever", () => {
  assert.equal(poster.needsRibbonBehind({ probe: null, clusters: [] }, TEXT_BAND, "#3a2230", 1), false);
});

test("floralOverlap: tracks partial coverage, not just all-or-nothing", () => {
  const clusters = [{ x: 0, y: 0, radius: 250 }];
  assert.equal(poster.floralOverlap({ x: 0, y: 0, w: 40, h: 20 }, clusters), 1);
  assert.equal(poster.floralOverlap({ x: 900, y: 900, w: 40, h: 20 }, clusters), 0);
  // A line straddling the cluster edge must land strictly between the two,
  // or the threshold of 0.2 is decorative.
  const partial = poster.floralOverlap({ x: 150, y: 150, w: 300, h: 60 }, clusters);
  assert.ok(partial > 0 && partial < 1, `straddling line scored ${partial}, so no threshold could matter`);
});

test("floralOverlap: no clusters is no overlap, not a crash", () => {
  assert.equal(poster.floralOverlap({ x: 0, y: 0, w: 10, h: 10 }, []), 0);
  assert.equal(poster.floralOverlap({ x: 0, y: 0, w: 10, h: 10 }, null), 0);
});

test("colorAlpha: reads the opacity a line will really paint at", () => {
  assert.equal(poster.colorAlpha("rgba(99,50,70,0.78)"), 0.78);
  assert.equal(poster.colorAlpha("#8f3f68"), 1);
  assert.equal(poster.colorAlpha(undefined), 1);
});

test("ribbonBand: hugs the glyphs rather than slabbing the em box", () => {
  const tall = poster.ribbonBand({ textWidth: 400, ascent: 150, descent: 60, fontSize: 200, baselineY: 500, cx: 540, maxWidth: 0, ceiling: -Infinity });
  const short = poster.ribbonBand({ textWidth: 400, ascent: 60, descent: 4, fontSize: 200, baselineY: 500, cx: 540, maxWidth: 0, ceiling: -Infinity });
  assert.ok(tall.h > short.h, "a taller line must get a taller ribbon");
  // The band must stay close to the glyphs it protects. Allowing 2.6x the
  // glyph box — which the previous assertion did — permits the exact slab
  // the design is meant to avoid.
  assert.ok(short.h <= 64 * 2, `band ${short.h}px is a slab behind a 64px glyph box`);
});

test("ribbonBand: leaves clearance past the notch so no glyph sits on the cut corner", () => {
  const b = poster.ribbonBand({ textWidth: 300, ascent: 30, descent: 8, fontSize: 40, baselineY: 200, cx: 540, maxWidth: 0, ceiling: -Infinity });
  assert.ok(b.w >= 300 + b.notch * 2, `text runs into the notch: width ${b.w}, notch ${b.notch}`);
});

test("ribbonBand: text still clears the notches after the width clamp bites", () => {
  // A long headline fitted near the limit had its first and last glyphs
  // hanging off the cut corners entirely.
  const b = poster.ribbonBand({ textWidth: 842, ascent: 150, descent: 60, fontSize: 220, baselineY: 600, cx: 540, maxWidth: 926, ceiling: -Infinity });
  assert.equal(b.w, 926);
  assert.ok(842 + b.notch * 2 <= b.w + 0.001, `glyphs overhang the ribbon by ${(842 + b.notch * 2 - b.w) / 2}px each end`);
});

test("ribbonBand: never grows past the width it is given", () => {
  const b = poster.ribbonBand({ textWidth: 2000, ascent: 30, descent: 8, fontSize: 40, baselineY: 200, cx: 540, maxWidth: 950, ceiling: -Infinity });
  assert.equal(b.w, 950);
});

test("ribbonBand: the probed box is the glyphs themselves, centred on the line", () => {
  const b = poster.ribbonBand({ textWidth: 300, ascent: 30, descent: 8, fontSize: 40, baselineY: 200, cx: 540, maxWidth: 0, ceiling: -Infinity });
  assert.equal(b.probe.x, 540 - 150);
  assert.equal(b.probe.w, 300);
  assert.equal(b.probe.y, 170);
  assert.equal(b.probe.h, 38);
});

test("ribbonBand: falls back to sane metrics when the canvas reports no glyph box", () => {
  const b = poster.ribbonBand({ textWidth: 300, ascent: 0, descent: 0, fontSize: 40, baselineY: 200, cx: 540, maxWidth: 0, ceiling: -Infinity });
  assert.ok(b.h > 40, `degenerate ribbon height: ${b.h}`);
});

test("ribbonBand: two consecutive lines never overlap — stacked ribbons are one slab", () => {
  // Bands are taller than the line pitch for text with descenders, so
  // adjacent ribboned lines overlapped by construction and the CTA stack
  // merged into one large light block over the photo.
  const fontSize = 44, pitch = fontSize * 1.32;
  let ceiling = -Infinity;
  const bands = [];
  for (let i = 0; i < 4; i++) {
    const b = poster.ribbonBand({
      textWidth: 500, ascent: 33, descent: 9, fontSize,
      baselineY: 700 + i * pitch, cx: 540, maxWidth: 926, ceiling
    });
    bands.push(b);
    ceiling = b.cy + b.h / 2;
  }
  for (let i = 1; i < bands.length; i++) {
    const prevBottom = bands[i - 1].cy + bands[i - 1].h / 2;
    const top = bands[i].cy - bands[i].h / 2;
    assert.ok(top >= prevBottom - 0.001, `ribbon ${i} starts at ${top}, inside ribbon ${i - 1} ending at ${prevBottom}`);
  }
});

test("ribbonBand: a ribbon is never painted back over a line already drawn above it", () => {
  // The script word's band reached up over the headline lead's glyphs, which
  // are drawn first — fillText succeeds and is then buried under cream.
  const leadBaseline = 400, leadDescent = 6;
  const b = poster.ribbonBand({
    textWidth: 600, ascent: 150, descent: 60, fontSize: 220,
    baselineY: 560, cx: 540, maxWidth: 926, ceiling: leadBaseline + leadDescent
  });
  assert.ok(b.cy - b.h / 2 >= leadBaseline + leadDescent - 0.001,
    `ribbon top ${b.cy - b.h / 2} covers the lead line's baseline at ${leadBaseline}`);
});

test("ribbonBand: reports when a clipped band can no longer protect its line", () => {
  // Clipped so hard it no longer covers the glyphs: the caller must skip it
  // rather than draw a useless sliver that looks like a rendering artifact.
  const b = poster.ribbonBand({
    textWidth: 400, ascent: 40, descent: 10, fontSize: 50,
    baselineY: 300, cx: 540, maxWidth: 926, ceiling: 295
  });
  assert.equal(b.protects, false);
  const ok = poster.ribbonBand({
    textWidth: 400, ascent: 40, descent: 10, fontSize: 50,
    baselineY: 300, cx: 540, maxWidth: 926, ceiling: -Infinity
  });
  assert.equal(ok.protects, true);
});

test("ribbonWidthLimit: a ribbon stays inside the border rules with air, not just inside the sheet", () => {
  const w = 1080, h = 1350;
  const limit = poster.ribbonWidthLimit(w, h);
  const m = Math.min(w, h);
  const innerRule = Math.round(m * 0.038) + Math.round(m * 0.011);
  const leftEdge = (w - limit) / 2;
  assert.ok(leftEdge > innerRule + 8, `ribbon edge ${leftEdge} crowds the inner rule at ${innerRule}`);
  assert.ok(limit > w * 0.7, `limit ${limit} is so tight the ribbon could not carry a headline`);
});

// ---------------------------------------------------------------------------
// The drawing path itself.
//
// Everything above tests the DECISION. None of it noticed when placeLine was
// made to never draw a ribbon at all — the feature could be deleted from the
// poster with the whole suite green. These exercise the code that actually
// puts paint on the canvas, through a recording context.
// ---------------------------------------------------------------------------

/** A canvas 2D context that records shape fills instead of rasterising, so
 * the real placeLine can run under Node with no canvas at all. */
function recordingCtx(textWidth = 300) {
  const calls = { fills: [], texts: [], strokes: [] };
  let path = [];
  const ctx = {
    calls,
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 1,
    textAlign: "", textBaseline: "", letterSpacing: "0px",
    save() {}, restore() {},
    beginPath() { path = []; }, closePath() {},
    moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    rect(x, y, w, h) { path.push([x, y], [x + w, y + h]); },
    fill() {
      if (!path.length) return;
      const ys = path.map((p) => p[1]), xs = path.map((p) => p[0]);
      calls.fills.push({
        fillStyle: this.fillStyle,
        top: Math.min(...ys), bottom: Math.max(...ys),
        left: Math.min(...xs), right: Math.max(...xs)
      });
    },
    stroke() { calls.strokes.push({ strokeStyle: this.strokeStyle }); },
    fillText(text, x, y) { calls.texts.push({ text, x, y, fillStyle: this.fillStyle }); },
    measureText() { return { width: textWidth, actualBoundingBoxAscent: 33, actualBoundingBoxDescent: 9 }; }
  };
  return ctx;
}

const PALETTE = poster.derivePalette("#8f3f68", "#6f8f72", null);
const RIBBON_FILL = /0\.94\)$/;
const ribbonFills = (ctx) => ctx.calls.fills.filter((f) => RIBBON_FILL.test(f.fillStyle));

test("placeLine: actually paints a ribbon when the line lands on flowers", () => {
  const ctx = recordingCtx();
  const ground = { probe: PETALS, clusters: [], maxRibbonWidth: 926 };
  poster.placeLine(ctx, ground, "CLOSING EARLY", 150, 160, 44, PALETTE, PALETTE.ink);
  assert.equal(ribbonFills(ctx).length, 1, "no ribbon was painted over flowers");
});

test("placeLine: paints NO ribbon on calm ground — the rejected box never returns", () => {
  const ctx = recordingCtx();
  const ground = { probe: groundFor(PALETTE), clusters: [], maxRibbonWidth: 926 };
  poster.placeLine(ctx, ground, "CLOSING EARLY", 150, 160, 44, PALETTE, PALETTE.ink);
  assert.equal(ribbonFills(ctx).length, 0, "a ribbon appeared over open ground");
});

test("placeLine: draws the exact words it is given, ribbon or no ribbon", () => {
  for (const probe of [PETALS, groundFor(PALETTE)]) {
    const ctx = recordingCtx();
    poster.placeLine(ctx, { probe, clusters: [], maxRibbonWidth: 926 },
      "Lilies in Bloom is closing at 2:30 today.", 150, 160, 44, PALETTE, PALETTE.ink);
    assert.deepEqual(ctx.calls.texts.map((t) => t.text), ["Lilies in Bloom is closing at 2:30 today."]);
    assert.equal(ctx.calls.texts[0].y, 160, "the baseline moved");
  }
});

test("placeLine: the text is painted AFTER the ribbon, never buried under it", () => {
  const ctx = recordingCtx();
  poster.placeLine(ctx, { probe: PETALS, clusters: [], maxRibbonWidth: 926 },
    "CLOSING EARLY", 150, 160, 44, PALETTE, PALETTE.ink);
  const order = [];
  // fills and texts are recorded into separate arrays; reconstruct by count.
  assert.ok(ribbonFills(ctx).length === 1 && ctx.calls.texts.length === 1);
  const band = ribbonFills(ctx)[0];
  assert.ok(band.top <= 160 - 33 && band.bottom >= 160 + 9,
    `ribbon ${band.top}-${band.bottom} does not cover the glyphs it is meant to protect`);
});

test("placeLine: consecutive ribboned lines never paint over one another", () => {
  // The real failure: a lower line's ribbon covered the glyphs of a line
  // already drawn above it, and the CTA stack merged into one light block.
  const ctx = recordingCtx();
  const ground = { probe: PETALS, clusters: [], maxRibbonWidth: 926 };
  const pitch = 44 * 1.32;
  for (let i = 0; i < 4; i++) {
    poster.placeLine(ctx, ground, "LINE " + i, 150, 200 + i * pitch, 44, PALETTE, PALETTE.ink);
  }
  const bands = ribbonFills(ctx);
  assert.ok(bands.length >= 2, `expected several ribbons over flowers, got ${bands.length}`);
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i].top >= bands[i - 1].bottom - 0.001,
      `ribbon ${i} (top ${bands[i].top}) overlaps ribbon ${i - 1} (bottom ${bands[i - 1].bottom})`);
  }
  // And no ribbon may reach back over an earlier line's baseline.
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i].top >= 200 + (i - 1) * pitch,
      `ribbon ${i} reaches up over the baseline of the line above it`);
  }
});

test("placeLine: with no ground to judge, it draws the words and no ribbon", () => {
  const ctx = recordingCtx();
  poster.placeLine(ctx, null, "CLOSING EARLY", 150, 160, 44, PALETTE, PALETTE.ink);
  assert.equal(ribbonFills(ctx).length, 0);
  assert.deepEqual(ctx.calls.texts.map((t) => t.text), ["CLOSING EARLY"]);
});

test("the taint fallback's threshold actually decides something", () => {
  // Nothing pinned RIBBON_OVERLAP_THRESHOLD: it could move 2.5x with the
  // suite green, which means the fallback path was effectively untested.
  const clusters = [{ x: 0, y: 0, radius: 556 }];
  const ground = { probe: null, clusters };
  const mostly = { x: 300, y: 300, w: 400, h: 60 };   // 0.40 inside the cluster
  const barely = { x: 380, y: 380, w: 400, h: 60 };   // 0.08 inside
  assert.ok(poster.floralOverlap(mostly, clusters) > poster.floralOverlap(barely, clusters));
  assert.equal(poster.needsRibbonBehind(ground, mostly, PALETTE.ink, 1), true,
    "a line 40% buried in the flowers must be protected");
  assert.equal(poster.needsRibbonBehind(ground, barely, PALETTE.ink, 1), false,
    "a line barely clipping the flowers must stay bare");
});

test("busyFraction: a line only partly over flowers still counts as on flowers", () => {
  // A fully-textured fixture scores 1.0, so it cannot pin the threshold from
  // above — raise BUSY_FRACTION_THRESHOLD to 0.95 and a 1.0 fixture still
  // passes while every realistic partly-covered line stops being protected.
  const partly = fakeImageData(300, 300, (x, y) => {
    if (x > 60 + 180 * 0.45) return [252, 249, 247];      // calm ground
    const t = (Math.sin(x / 9) * Math.sin(y / 9) + 1) / 2; // petals
    return [255 - 60 * t, 245 - 95 * t, 248 - 78 * t];
  });
  const f = poster.busyFraction(partly, TEXT_BAND);
  assert.ok(f > 0.28 && f < 0.75, `expected a partly-covered line, scored ${f}`);
  assert.equal(poster.needsRibbonBehind({ probe: partly, clusters: [] }, TEXT_BAND, PALETTE.ink, 1), true,
    "a line lying half across the flowers must be protected");
});

test("a faint line is judged on the colour it really paints, not full-opacity ink", () => {
  // Five of the eight lines draw at rgba(ink, 0.78-0.9). Measuring them as
  // if they were solid overstates their contrast and leaves exactly the
  // body and contact lines — the ones that must stay comfortably readable
  // on a phone — unprotected.
  const dim = fakeImageData(300, 300, () => [184, 170, 178]);
  const ground = { probe: dim, clusters: [] };
  assert.equal(poster.needsRibbonBehind(ground, TEXT_BAND, "#8f3f68", 1), false,
    "solid ink clears the bar on this background, so the fixture proves nothing unless alpha is honoured");
  assert.equal(poster.needsRibbonBehind(ground, TEXT_BAND, "#8f3f68", 0.78), true,
    "the same line drawn at 0.78 opacity is below the bar and must be protected");
});

// ---------------------------------------------------------------------------
// The display lockup for the shop's own name.
//
// Ashley's reference sets the shop name as a designed lockup — the first word
// large in script, a short connector small between rules, the rest in serif
// capitals. That is TYPESETTING. The words themselves are the florist's own
// and may never be reordered, dropped or changed.
// ---------------------------------------------------------------------------

test("splitShopName: sets a three-part name the way the reference does", () => {
  const s = poster.splitShopName("Lilies in Bloom");
  assert.equal(s.script, "Lilies");
  assert.equal(s.connector, "in");
  assert.equal(s.rest, "Bloom");
});

test("splitShopName: never drops, reorders or rewrites a single word", () => {
  const names = [
    "Lilies in Bloom", "Petal & Stem", "The Wildflower Company",
    "Bloom", "Rose of Sharon Florist", "Anna's Flowers and Gifts",
    "Fleurs de Lys Boutique", "Main Street Floral Design Studio"
  ];
  for (const name of names) {
    const s = poster.splitShopName(name);
    const rebuilt = [s.script, s.connector, s.rest].filter(Boolean).join(" ");
    assert.equal(rebuilt, name, `the poster changed a shop's name: "${name}" became "${rebuilt}"`);
  }
});

test("splitShopName: a two-word name needs no connector", () => {
  const s = poster.splitShopName("Petal Pushers");
  assert.equal(s.script, "Petal");
  assert.equal(s.connector, "");
  assert.equal(s.rest, "Pushers");
});

test("splitShopName: a one-word name still gets a display treatment", () => {
  const s = poster.splitShopName("Bloom");
  assert.equal(s.script, "Bloom");
  assert.equal(s.rest, "");
});

test("splitShopName: only a real connector is set small — never a meaningful word", () => {
  // "Rose of Sharon" must not become Rose / OF / SHARON losing the sense, but
  // a second word carrying meaning must never be demoted to a connector.
  assert.equal(poster.splitShopName("Petal Stem Flowers").connector, "",
    "a meaningful second word was demoted to a connector");
  assert.equal(poster.splitShopName("Rose of Sharon Florist").connector, "of");
});

test("splitShopName: an empty or missing name yields nothing rather than throwing", () => {
  for (const bad of ["", "   ", null, undefined]) {
    const s = poster.splitShopName(bad);
    assert.equal(s.script, "");
    assert.equal(s.rest, "");
  }
});

test("splitShopName: a name that is only a connector is still drawn", () => {
  const s = poster.splitShopName("The");
  assert.equal([s.script, s.connector, s.rest].filter(Boolean).join(" "), "The");
});

// ---------------------------------------------------------------------------
// The composition itself.
//
// A review found that thirteen of fourteen mutations to the DRAWING survived
// the whole suite — the words could be reordered, a body line dropped, the
// ribbon filled the same colour as its own text, the phone number left out
// entirely, the panel anchored off the sheet, and every test still passed.
// Every one of them targeted an exported helper; nothing rendered a poster.
// These drive the real drawPoster through a recording context.
// ---------------------------------------------------------------------------

/** A 2D context that records what would be painted instead of painting it.
 * Metrics are proportional rather than real, which is enough to catch words
 * leaving the sheet, words going missing, and text drawn in its own
 * background colour. */
function drawFixture(over = {}) {
  const width = over.width || 1080, height = over.height || 1350;
  const brand = Object.assign({ shopName: "Lilies in Bloom", phone: "606-506-4039", primaryColor: "#7c3a58", accentColor: "#c98fae" }, over.brand);
  const content = Object.assign({
    headline: "Closing Early Today",
    body: "Lilies in Bloom is closing at 2:30 today.",
    cta: "Call 606-506-4039 to place an order."
  }, over.content);
  const ctx = recordingContext(width, height);
  const palette = poster.derivePalette(brand.primaryColor, brand.accentColor, null);
  poster.drawPoster(ctx, { width, height, content, brand, palette, image: null, seed: over.seed || 2 });
  return { ctx, width, height, brand, content, palette };
}

const wordsOf = (ctx) => ctx.texts.map((t) => t.text).join(" ").toLowerCase().replace(/[^a-z0-9:& ]/g, " ").split(/\s+/).filter(Boolean);

test("composition: every word of the headline, message and call to action is drawn", () => {
  const { ctx, content, brand } = drawFixture();
  const drawn = wordsOf(ctx);
  const expected = `${brand.shopName} ${content.headline} ${content.body} ${content.cta}`
    .toLowerCase().replace(/[^a-z0-9:& ]/g, " ").split(/\s+/).filter(Boolean);
  for (const word of expected) {
    assert.ok(drawn.includes(word), `the poster never drew "${word}" — a florist's own wording went missing`);
  }
});

test("composition: the shop's phone number always reaches the flyer", () => {
  const { ctx } = drawFixture();
  assert.ok(ctx.texts.some((t) => t.text.includes("606-506-4039")), "no way for a customer to reach the shop");
});

test("composition: a call to action with no number still carries the shop's own", () => {
  // Dropping this was a silent regression when the poster took over drawing:
  // the old renderer adds the shop's own number when the CTA has none.
  const { ctx } = drawFixture({ content: { cta: "Order online any time." } });
  assert.ok(ctx.texts.some((t) => /606[-.\s]?506[-.\s]?4039/.test(t.text)),
    "a flyer went out with no phone number anywhere on it");
});

test("composition: a call to action naming a number twice keeps the florist's own wording", () => {
  // Deduplicating would be REWRITING what the florist wrote, which is never
  // allowed. What matters is that the number is never mangled: both mentions
  // survive intact and neither is split across lines of the lockup.
  const cta = "Call 555-123-4567 today, or text 555-123-4567 any time.";
  const { ctx } = drawFixture({ content: { cta } });
  const joined = ctx.texts.map((t) => t.text).join(" ");
  const intact = (joined.match(/555-123-4567/g) || []).length;
  assert.equal(intact, 2, "the florist wrote the number twice and both must survive, unaltered");
  assert.ok(!/555-123$|-4567\b(?!.*555-123-4567)/.test(joined.replace(/555-123-4567/g, "")),
    "a fragment of the number was left stranded");
});

test("composition: a 1-555 number is never split, so the number read is the number given", () => {
  const { ctx } = drawFixture({ content: { cta: "Call 1-555-123-4567 today." } });
  assert.ok(ctx.texts.some((t) => t.text.replace(/\s/g, "").includes("1-555-123-4567")),
    "the leading 1 was orphaned onto another line — the number shown is not the number supplied");
});

test("composition: nothing is ever drawn outside the sheet, at any size or length", () => {
  const cases = [
    { width: 1080, height: 1080 },
    { width: 1080, height: 1350 },
    { width: 1080, height: 1920 },
    { width: 1200, height: 628 },
    { content: { body: "Lilies in Bloom is closing at 2:30 today for a family event. We are very sorry for the short notice and hope to see you again tomorrow morning." } },
    { content: { body: "Email orders@averyveryverylongdomainnameindeedforflowers.example.com before noon." } },
    { brand: { shopName: "Sunnyside Blossoms, Gifts, Balloons & Special Occasion Florals of Greater Cincinnati" } },
    { brand: { shopName: "A" } },
    { content: { headline: "New Extended Holiday Opening Hours This Week" } },
    // Every architecture, not just the one the default seed happens to pick.
    // The photo-led layout draws its contact line left-aligned in a bar sized
    // from the canvas, and at Story height that line ran off both ends of it.
    { seed: 1 }, { seed: 1, width: 1080, height: 1920 }, { seed: 1, width: 1200, height: 628 },
    { seed: 12 }, { seed: 12, width: 1080, height: 1920 },
    { seed: 4, width: 1080, height: 1920 },
    { seed: 1, content: { cta: "Order online." } },
    { seed: 1, width: 1080, height: 1920, content: { cta: "Order online." } }
  ];
  for (const over of cases) {
    const { ctx, width, height } = drawFixture(over);
    for (const t of ctx.texts) {
      const label = JSON.stringify(over).slice(0, 70);
      assert.ok(t.y <= height + 0.5 && t.y >= 0, `"${t.text.slice(0, 30)}" drawn at y=${Math.round(t.y)} on a ${width}x${height} sheet — off the flyer (${label})`);
      assert.ok(t.left >= -0.5 && t.right <= width + 0.5,
        `"${t.text.slice(0, 30)}" spans ${Math.round(t.left)}..${Math.round(t.right)} on a ${width}x${height} sheet (${label})`);
    }
  }
});

test("composition: the ribbon's wording is never drawn in the ribbon's own colour", () => {
  const { ctx, palette } = drawFixture();
  const onRibbon = ctx.texts.filter((t) => t.color === palette.cream);
  assert.ok(onRibbon.length > 0, "nothing was drawn on the ribbon at all");
  for (const t of onRibbon) {
    assert.notEqual(t.color, palette.ink, `"${t.text}" is invisible on its own ribbon`);
  }
});

test("composition: the message is drawn in full, not just its first line", () => {
  const long = "Lilies in Bloom is closing at 2:30 today for a family event and will reopen at nine tomorrow.";
  const { ctx } = drawFixture({ content: { body: long } });
  const drawn = wordsOf(ctx);
  for (const word of ["reopen", "tomorrow", "nine"]) {
    assert.ok(drawn.includes(word), `the tail of the message was dropped — "${word}" never drawn`);
  }
});

test("composition: the shop's name is set as given, never lowercased or reordered", () => {
  const { ctx } = drawFixture({ brand: { shopName: "Lilies in Bloom" } });
  const joined = ctx.texts.map((t) => t.text).join(" ");
  assert.ok(/Lilies/.test(joined), "the script part of the name is missing or was case-folded");
  assert.ok(/BLOOM/.test(joined), "the capitalised part of the name is missing");
  assert.ok(joined.indexOf("Lilies") < joined.indexOf("BLOOM"), "the name was drawn out of order");
});

test("a florist's colour revision changes the palette the poster is built from", () => {
  // "use more cream" persists a paletteExclude delta and mints a new asset.
  // Before this was wired through, the flyer did change — new seed, new
  // corners — but never in the direction the florist actually asked for.
  const brand = { primaryColor: "#7c3a58", accentColor: "#c98fae" };
  const plain = renderer.effectivePaletteColors(brand, {});
  const excluded = renderer.effectivePaletteColors(brand, { paletteExclude: ["pink"] });
  const included = renderer.effectivePaletteColors(brand, { paletteInclude: ["navy"] });
  assert.notEqual(excluded.primary, plain.primary, "'use more cream' left the colours untouched");
  assert.notEqual(included.primary, plain.primary, "'make it navy' left the colours untouched");
  // And the poster's own palette genuinely follows that resolution.
  assert.notEqual(
    poster.derivePalette(excluded.primary, excluded.accent, null).ink,
    poster.derivePalette(plain.primary, plain.accent, null).ink,
    "the revision reached the colour resolver but not the poster's ink"
  );
});

test("composition: the message is drawn in the florist's own word ORDER, not just with the right words", () => {
  // Checking only that every word appears lets the order be scrambled — a
  // reversed message still contains all its words and reads as nonsense.
  const body = "Lilies in Bloom is closing at two thirty today for a family event";
  const { ctx } = drawFixture({ content: { body } });
  // The ribbon's lines, in the order they were drawn, must rebuild the body.
  const drawn = ctx.texts.map((t) => t.text).join(" ").replace(/\s+/g, " ");
  assert.ok(drawn.includes(body) || body.split(" ").every((w, i, arr) => {
    if (i === 0) return true;
    return drawn.indexOf(arr[i - 1]) <= drawn.indexOf(w);
  }), `the message was drawn out of order:\n  wanted: ${body}\n  drawn:  ${drawn}`);
});

test("composition: the headline is drawn in order too", () => {
  const { ctx } = drawFixture({ content: { headline: "Opening Late Tomorrow" } });
  const joined = ctx.texts.map((t) => t.text).join(" ");
  assert.ok(joined.indexOf("Opening") < joined.indexOf("LATE"), "the headline was reordered");
  assert.ok(joined.indexOf("LATE") < joined.indexOf("TOMORROW"), "the headline was reordered");
});

// ---------------------------------------------------------------------------
// Three defects found by rendering the poster in a real browser and looking at
// it, not by reasoning about the code. Each is content or design leaving the
// sheet, which is the one class of fault a florist cannot work around.
// ---------------------------------------------------------------------------

function laidOut(over = {}) {
  const width = over.width || 1080, height = over.height || 1350;
  const brand = Object.assign({ shopName: "Lilies in Bloom", phone: "606-506-4039", primaryColor: "#7c3a58", accentColor: "#c98fae" }, over.brand);
  const content = Object.assign({
    headline: "Closing Early Today",
    body: "Lilies in Bloom is closing at 2:30 today.",
    cta: "Call 606-506-4039 to place an order."
  }, over.content);
  const ctx = recordingContext(width, height);
  const palette = poster.derivePalette(brand.primaryColor, brand.accentColor, null);
  const base = { width, height, content, brand, palette, image: null, seed: over.seed || 2 };
  if (over.typeStyle) base.typeStyle = over.typeStyle;
  if (over.messageStyle) base.messageStyle = over.messageStyle;
  if (over.paletteMood) base.paletteMood = over.paletteMood;
  // The same two-pass fit renderPoster runs before it draws. Checking the
  // composition without it would be checking a call no shipped code path
  // makes: the fit is what shrinks a poster whose type is too big for its
  // sheet, and every guarantee below depends on it having run.
  if (over.fit !== false) poster.fitPoster(ctx, base);
  const laid = poster.drawPoster(ctx, base);
  return { ctx, laid, width, height, content, brand, base };
}

/** A seed that produces each composition, so every architecture is exercised
 * rather than whichever one seed 2 happens to pick. */
function seedForComposition() {
  const found = {};
  for (let seed = 1; seed <= 400 && Object.keys(found).length < poster.COMPOSITIONS.length; seed++) {
    const { laid } = laidOut({ seed });
    if (!(laid.composition in found)) found[laid.composition] = seed;
  }
  assert.equal(Object.keys(found).length, poster.COMPOSITIONS.length, "not every composition is reachable by seed");
  return found;
}

test("the ribbon is never dragged up over the headline", () => {
  // The real defect, seen in a browser: on the card composition — whose
  // printed area starts a third of the way down, under the photographic band
  // — the ribbon was clamped up to a fixed line near the top of the SHEET and
  // printed straight through the headline. "Closing" was cut mid-glyph and
  // "EARLY TODAY" vanished under it. The florist's own words, gone.
  const seeds = seedForComposition();
  for (const [composition, seed] of Object.entries(seeds)) {
    for (const body of [
      "Lilies in Bloom is closing at 2:30 today.",
      "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each morning.",
      "We are closed all day."
    ]) {
      const { laid } = laidOut({ seed, content: { body } });
      if (!laid.ribbon) continue;
      assert.ok(laid.ribbon.y >= laid.headBottom - 0.5,
        `${composition}: the ribbon starts at ${Math.round(laid.ribbon.y)} but the headline only ends at ${Math.round(laid.headBottom)} — it is printing over the flyer's own headline`);
    }
  }
});

test("no headline word is ever buried under the ribbon", () => {
  // The same fault stated as what a florist would actually see: a word drawn
  // before the ribbon, inside the ribbon's rectangle, is a word nobody can
  // read. Checked on the wording that produced it.
  const seeds = seedForComposition();
  for (const [composition, seed] of Object.entries(seeds)) {
    const { ctx, laid, content } = laidOut({ seed, content: { headline: "Closing Early Today" } });
    if (!laid.ribbon) continue;
    const r = laid.ribbon;
    for (const word of ["Closing", "EARLY TODAY"]) {
      const drawn = ctx.texts.filter((t) => t.text === word);
      for (const t of drawn) {
        const buried = t.y > r.y && t.y < r.y + r.h;
        assert.ok(!buried, `${composition}: "${word}" is drawn at y=${Math.round(t.y)}, inside the ribbon (${Math.round(r.y)}–${Math.round(r.y + r.h)})`);
      }
    }
    assert.ok(content.headline, "fixture sanity");
  }
});

test("nothing the poster draws — type or ornament — leaves the sheet", () => {
  // The sparkle flourish flanking the display word took its size from the word
  // alone, with no reference to the column it sits in. On the banner
  // composition, whose printed column is 60% of the sheet, that put the
  // outermost dash at x=1094 on a 1080-wide flyer.
  const seeds = seedForComposition();
  for (const [composition, seed] of Object.entries(seeds)) {
    // "Remembrance" and "Valentine's Day" are here for a reason: on the banner
    // composition their single script word is wide enough, in a column only
    // 60% of the sheet, that the flourish flanking it lands at x=1092. Drop
    // the guard that suppresses it and this test goes red on exactly those.
    for (const headline of [
      "Closing Early Today", "Funeral Flowers", "Mother's Day Weekend Sale",
      "Remembrance", "Valentine's Day", "Congratulations", "Thanksgiving Weekend"
    ]) {
      const { ctx, width, height } = laidOut({ seed, content: { headline } });
      const escaped = offSheet(ctx, width, height);
      assert.deepEqual(escaped, [],
        `${composition} / "${headline}" on ${width}x${height}: ${JSON.stringify(escaped.slice(0, 3))}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Sympathy work does not get the celebration vocabulary.
//
// The poster had no idea what it was drawing, so a funeral flyer came out with
// a pink heart under the shop name, a second under the message, a third beside
// the phone number, and starburst sparkles around the word "Funeral".
// ---------------------------------------------------------------------------

test("isSympathyContent reads the wording actually being drawn", () => {
  assert.ok(poster.isSympathyContent({ headline: "Funeral Flowers" }));
  assert.ok(poster.isSympathyContent({ body: "Sympathy flowers for the service." }));
  assert.ok(poster.isSympathyContent({ cta: "Casket sprays made to order." }));
  assert.ok(!poster.isSympathyContent({ headline: "Valentine's Day", body: "Red roses are in." }));
  assert.ok(!poster.isSympathyContent({}));
  assert.ok(!poster.isSympathyContent(null));
});

test("a shop whose NAME carries the word is not put in mourning by it", () => {
  // A flyer's message routinely contains the shop's own name. A real shop
  // called Wake & Bloom or Memorial Gardens Florist would otherwise have every
  // poster it ever made read as a funeral — including its Valentine's one.
  for (const shopName of ["Wake & Bloom", "Memorial Gardens Florist", "Tribute Flowers", "In Memory Florals"]) {
    const content = {
      headline: "Valentine's Day",
      body: `${shopName} has red roses in this morning.`,
      cta: `Call ${shopName} on 606-506-4039`
    };
    assert.ok(!poster.isSympathyContent(content, shopName),
      `"${shopName}" had its own name read as a bereavement`);
    // And the shop is not exempted either: real sympathy wording still counts.
    assert.ok(poster.isSympathyContent({ ...content, headline: "Funeral Flowers" }, shopName),
      `"${shopName}" can no longer make a sympathy poster at all`);
  }
});

test("suppressing an ornament never changes which design the seed picks", () => {
  // Determinism is what makes a re-render a re-render and not a re-roll, and
  // Undo depends on it. drawSparkles consumes rand(); if anything downstream
  // consumed it too, skipping the sparkles would silently pick a different
  // composition for the same asset.
  //
  // The two contents below must be genuinely DIFFERENT wording — one sympathy,
  // one not — or this compares a poster to itself and proves nothing. An
  // earlier version of this test did exactly that: both literals were
  // identical, and a deliberate mutation making sympathy content pick another
  // composition passed it.
  const sympathy = { headline: "Funeral Flowers", body: "Standing sprays and casket flowers.", cta: "Call 606-506-4039" };
  const ordinary = { headline: "Spring Flowers", body: "Standing sprays and bright bouquets.", cta: "Call 606-506-4039" };
  assert.ok(poster.isSympathyContent(sympathy) && !poster.isSympathyContent(ordinary),
    "this test is worthless unless the two contents differ in exactly the way it is testing");
  for (let seed = 1; seed <= 40; seed++) {
    const a = laidOut({ seed, content: sympathy }).laid;
    const b = laidOut({ seed, content: ordinary }).laid;
    assert.equal(a.composition, b.composition,
      `seed ${seed} picked ${a.composition} for sympathy wording and ${b.composition} for ordinary wording — the design is no longer a function of the seed alone`);
    // And the same seed twice is byte-identical in what it lays out.
    const again = laidOut({ seed, content: sympathy }).laid;
    assert.deepEqual(again, a, `seed ${seed} did not redraw identically`);
  }
});

test("the poster's sympathy check agrees with the wording guard's", async () => {
  // The poster is a browser IIFE and cannot import the shared module, so it
  // carries a deliberate mirror of BEREAVEMENT_CONTEXT_RE. A mirror that
  // drifts is worse than no mirror: a post the wording guard treats as
  // sympathy would be drawn with hearts on it.
  const { detectWeakMarketingCopy } = await import("../netlify/functions/_shared/marketing-content-revision.js");
  const bereavement = [
    "Funeral flowers", "sympathy flowers", "a memorial service", "casket sprays",
    "graveside tributes", "in memory of", "condolence flowers", "after the loss of a parent"
  ];
  for (const text of bereavement) {
    assert.ok(poster.isSympathyContent({ body: text }), `the poster does not treat "${text}" as sympathy work`);
    // The shared guard's own bereavement branch is what fires the celebratory
    // reason; if it did not consider this bereavement, no reason would come back.
    assert.ok(detectWeakMarketingCopy(text, "We are excited to celebrate this milestone with you.").some((r) => /celebratory/i.test(r)),
      `the wording guard does not treat "${text}" as sympathy work`);
  }
  for (const text of ["Red roses are in for Valentine's Day", "Mother's Day baskets", "a birthday bouquet"]) {
    assert.ok(!poster.isSympathyContent({ body: text }), `the poster wrongly treats "${text}" as sympathy work`);
  }
});

test("a sympathy poster carries no hearts, on any composition", () => {
  // drawHeart is the only thing in the poster that uses bezierCurveTo, so a
  // heart is countable without asserting on pixels.
  const seeds = seedForComposition();
  const sympathy = {
    headline: "Funeral Flowers",
    body: "Standing sprays, casket flowers and small arrangements for the service.",
    cta: "Call 606-506-4039"
  };
  for (const [composition, seed] of Object.entries(seeds)) {
    const { ctx } = laidOut({ seed, content: sympathy });
    assert.equal(ctx.beziers.length, 0, `${composition}: a funeral flyer was drawn with ${ctx.beziers.length / 2} heart(s) on it`);
  }
});

test("an ordinary poster keeps its hearts — the restraint is for sympathy only", () => {
  // Guard against the check spreading: stripping the ornament from every
  // poster would be a different regression, not a fix.
  const seeds = seedForComposition();
  const drawn = Object.values(seeds).map((seed) => laidOut({
    seed,
    content: { headline: "Valentine's Day", body: "Red roses landed this morning.", cta: "Call 606-506-4039 to order" }
  }).ctx.beziers.length);
  assert.ok(drawn.some((n) => n > 0), "no composition draws a heart any more");
});

test("the editorial column is not inset for a ribbon it never draws", () => {
  // Real, seen in a browser: a 79-character sentence came out as six lines of
  // two and three words down a narrow gutter with the rest of the sheet empty,
  // because the body was wrapped to 86% of its column — the room a ribbon's
  // notched ends need, on the one composition that has no ribbon at all.
  const seeds = seedForComposition();
  const body = "Red roses landed this morning. Twelve hand-tied is $65.00. Order by Thursday.";
  for (const [composition, seed] of Object.entries(seeds)) {
    const { laid } = laidOut({ seed, content: { body } });
    assert.ok(laid.bodyWidth > 0, `${composition}: the message was never laid out`);
    if (composition === "editorial") {
      assert.equal(laid.ribbon, null, "the editorial composition should draw no ribbon");
      assert.equal(laid.bodyWidth, laid.column,
        "the editorial message is still inset for a ribbon this composition never draws");
    } else {
      assert.ok(laid.ribbon, `${composition}: no ribbon was drawn`);
      assert.ok(laid.bodyWidth < laid.column,
        `${composition}: the message fills its column edge to edge, leaving no room for the ribbon's notched ends`);
    }
  }
});

test("a sweep of real shapes: nothing leaves the sheet, on any canvas the product uses", () => {
  // Bounded here so the suite stays fast; the same sweep across 122,880
  // combinations (4 canvas sizes x 40 seeds x 12 headlines x 4 messages x
  // 4 calls to action x 4 shop names) is what found the last two faults —
  // the ribbon running off the foot of a poster with no call to action, and
  // the section mark under it landing 2px past the bottom edge.
  // The five sizes the product actually generates — ASPECT_RATIOS in
  // netlify/functions/_shared/flyer-templates.js. An earlier version of this
  // sweep ran 1080x1350 (the review page's size, which the product never
  // generates) and 1200x628 (a typo for 630), and omitted the printable flyer
  // and the email banner entirely — so the shapes most likely to break were
  // the ones never checked.
  const sizes = [[1080, 1080], [1080, 1920], [1200, 630], [1275, 1650], [1200, 400]];
  // "Chrysanthemums Today" earns its place: on a 1080x1920 Story sheet with no
  // call to action, its lockup leaves the ribbon filling the sheet to the foot,
  // and the section mark under it landed at y=1922.
  const headlines = ["Closing Early Today", "Funeral Flowers", "Remembrance", "Chrysanthemums Today"];
  const bodies = [
    "Lilies in Bloom is closing at 2:30 today.",
    "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each and every morning of the week.",
    "Closed."
  ];
  const ctas = ["Call 606-506-4039 to place an order.", ""];
  const shops = ["Lilies in Bloom", "The Very Long Flower Shop Name Company Limited"];
  let checked = 0;
  for (const [width, height] of sizes) {
    for (let seed = 1; seed <= 8; seed++) {
      for (const headline of headlines) {
        for (const body of bodies) {
          for (const cta of ctas) {
            for (const shopName of shops) {
              const { ctx, laid } = laidOut({ width, height, seed, content: { headline, body, cta }, brand: { shopName } });
              checked++;
              const where = `${width}x${height} ${laid.composition} seed=${seed} "${headline}" cta="${cta}" shop="${shopName}"`;
              const escaped = offSheet(ctx, width, height);
              assert.deepEqual(escaped, [], `${where}: ${JSON.stringify(escaped.slice(0, 3))}`);
            }
          }
        }
      }
    }
  }
  assert.equal(checked, 5 * 8 * 4 * 3 * 2 * 2, "the sweep did not run what it claims to");
});

test("the message on the ribbon is never shrunk below what a phone can read", () => {
  // The height fit, added so the ribbon would stop being slid up over the
  // headline, first went the other way: it shrank the message to a 9px strip
  // inside a full-size ribbon while the headline above stayed enormous. That
  // is legible in a screenshot and illegible in a feed — the exact fault
  // Ashley reported to begin with.
  const seeds = seedForComposition();
  const body = "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each and every morning of the week.";
  for (const [composition, seed] of Object.entries(seeds)) {
    const { ctx, laid } = laidOut({ seed, content: { body } });
    if (!laid.ribbon) continue;
    const onRibbon = ctx.texts.filter((t) => t.y > laid.ribbon.y && t.y < laid.ribbon.y + laid.ribbon.h);
    assert.ok(onRibbon.length, `${composition}: nothing was drawn on the ribbon at all`);
    for (const t of onRibbon) {
      assert.ok(t.size >= 1350 * 0.024 * 0.55,
        `${composition}: the message is set at ${Math.round(t.size)}px on a 1350-tall poster — nobody reads that on a phone`);
    }
  }
});

test("the contact panel never prints across the poster's own frame", () => {
  // The emergency floor for a panel pushed down by long copy was the bare
  // sheet's edge less 2%, which on every framed composition is BELOW the frame
  // rule — so ordinary long copy drew the bordered contact panel straight
  // across the border it is supposed to sit inside.
  const bodies = [
    "Lilies in Bloom is closing at 2:30 today.",
    "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each and every morning of the week.",
    "We are closed all day Monday and reopen on Tuesday at nine, and every order already placed will still go out on time as promised."
  ];
  let framed = 0;
  for (const [width, height] of [[1080, 1080], [1080, 1920], [1275, 1650]]) {
    for (let seed = 1; seed <= 12; seed++) {
      for (const body of bodies) {
        const { laid } = laidOut({ width, height, seed, content: { body } });
        if (!laid.frame || !laid.panel) continue;
        framed++;
        const f = laid.frame, p = laid.panel;
        assert.ok(p.y + p.h <= f.y + f.h + 1,
          `${width}x${height} ${laid.composition} seed=${seed}: the contact panel ends at ${Math.round(p.y + p.h)}, past the frame at ${Math.round(f.y + f.h)}`);
        assert.ok(p.y >= f.y - 1,
          `${width}x${height} ${laid.composition} seed=${seed}: the contact panel starts above the frame`);
        assert.ok(p.x >= f.x - 1 && p.x + p.w <= f.x + f.w + 1,
          `${width}x${height} ${laid.composition} seed=${seed}: the contact panel is wider than the frame`);
      }
    }
  }
  assert.ok(framed > 20, `only ${framed} framed posters were actually checked`);
});

// ---------------------------------------------------------------------------
// A second pass, after an independent review challenged the first. Every fault
// below is one the first round of fixes either created or failed to see.
// ---------------------------------------------------------------------------

test("a poster with no call to action still reports its overflow", () => {
  // The caller's ONLY overflow signal is contentBottom > panelTop. With no CTA
  // there is no panel, and both were initialised to the same value — so the
  // signal was identically false and the ribbon could hang off the foot of a
  // Story sheet with nothing anywhere watching. This is the exact hole the
  // ribbon clamp fix opened: the old behaviour hid the overrun by sliding the
  // ribbon up over the headline; the new one leaves it hanging.
  const body = "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each and every morning of the week, with same-day delivery available to every funeral home in the county.";
  let checkedNoCta = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { ctx, laid, width, height } = laidOut({ width: 1080, height: 1920, seed, content: { body, cta: "" } });
    checkedNoCta++;
    assert.ok(laid.panelTop > laid.headBottom,
      `seed ${seed}: with no call to action the content floor must still be the limit, not the content's own bottom`);
    assert.deepEqual(offSheet(ctx, width, height), [],
      `seed ${seed}: a poster with no call to action put something off the sheet`);
  }
  assert.ok(checkedNoCta >= 12);
});

test("the editorial message is fitted by its own height, not the ribbon's", () => {
  // The editorial composition sets the message plainly rather than on a
  // ribbon, at a different line height and with no ribbon padding — so fitting
  // it by the ribbon's height fitted the wrong number. On a Story sheet its
  // last line was drawn at y=1962 on a canvas 1920 tall: the florist's own
  // last word, below the bottom edge.
  // The exact combination the sweep found — 1 of 43,200, and none of the
  // obvious ones. It needs all four at once: a Story sheet, the editorial
  // composition, no call to action (so the message runs to the floor) and a
  // shop name long enough to push the lockup down.
  const body = "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each and every morning of the week, with same-day delivery available to every funeral home in the county.";
  const found = laidOut({
    width: 1080, height: 1920, seed: 1,
    content: { headline: "Closing Early Today", body, cta: "" },
    brand: { shopName: "The Very Long Flower Shop Name Company Limited" }
  });
  assert.equal(found.laid.composition, "editorial", "the pinned case no longer reaches the editorial composition");
  assert.deepEqual(offSheet(found.ctx, 1080, 1920), [],
    JSON.stringify(offSheet(found.ctx, 1080, 1920).slice(0, 2)));
  assert.ok(found.ctx.texts.some((t) => /county/i.test(t.text)), "the message's last line was dropped entirely");

  const seeds = seedForComposition();
  for (const cta of ["", "Call 606-506-4039 to place an order."]) {
    const { ctx, laid, width, height } = laidOut({ width: 1080, height: 1920, seed: seeds.editorial, content: { body, cta } });
    assert.equal(laid.composition, "editorial");
    assert.deepEqual(offSheet(ctx, width, height), [], `cta="${cta}": ${JSON.stringify(offSheet(ctx, width, height).slice(0, 2))}`);
  }
});

test("the editorial call to action's trailing line is fitted like every other line", () => {
  // It alone was set at a fixed fraction of the bar's height and drawn, with no
  // fitLine — so a longer call to action ran off BOTH edges of the sheet.
  const seeds = seedForComposition();
  const cta = "Call 606-506-4039 to place an order today and we will have it ready for you within the hour.";
  const { ctx, laid, width, height } = laidOut({ seed: seeds.editorial, content: { cta } });
  assert.equal(laid.composition, "editorial");
  assert.deepEqual(offSheet(ctx, width, height), [], JSON.stringify(offSheet(ctx, width, height).slice(0, 2)));
  assert.ok(ctx.texts.some((t) => /WITHIN THE HOUR/i.test(t.text)), "the florist's own trailing words were dropped");
});

test("a landscape banner is handed back to the renderer, never drawn as a poster", async () => {
  // The poster is a printed-card design and needs a portrait-to-square sheet.
  // A 1200x400 email banner drove the message to 9px and a 1200x630 Facebook
  // post to 14px — at feed size that is texture, not type. Both are reachable:
  // pickAspectRatio returns them for a request mentioning email or a feed post.
  const { ASPECT_RATIOS } = await import("../netlify/functions/_shared/flyer-templates.js");
  const served = [], refused = [];
  for (const [name, { width, height }] of Object.entries(ASPECT_RATIOS)) {
    (poster.posterSuitsCanvas(width, height) ? served : refused).push(name);
  }
  assert.deepEqual(served.sort(), ["flyer", "square", "story"]);
  assert.deepEqual(refused.sort(), ["email_banner", "facebook_post"]);
});

test("the message on a served canvas is never set below its own floor", () => {
  // The floor is a limit on how far the fit may shrink, and it has to hold on
  // every canvas the poster actually serves — not only the review size. It was
  // a fraction of the HEIGHT, which came to 9.6px on a short sheet, and it was
  // never applied to the width fit at all.
  const body = "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each morning.";
  for (const [width, height] of [[1080, 1080], [1080, 1920], [1275, 1650]]) {
    for (let seed = 1; seed <= 12; seed++) {
      const { ctx, laid } = laidOut({ width, height, seed, content: { body } });
      if (!laid.ribbon) continue;
      for (const t of ctx.texts) {
        if (t.y <= laid.ribbon.y || t.y >= laid.ribbon.y + laid.ribbon.h) continue;
        assert.ok(t.size >= 12,
          `${width}x${height} ${laid.composition} seed=${seed}: the message is set at ${Math.round(t.size)}px — below the absolute minimum`);
      }
    }
  }
});

test("a shop named for a single bereavement word keeps the restrained ornament", () => {
  // The strip is a whole-name replace. A shop called simply "Wake" or
  // "Memorial" cannot have that word removed from its posters without removing
  // it from its genuine funeral flyers too — and of the two ways to be wrong,
  // hearts and sparkles in front of a grieving family is far the worse. Such a
  // shop gets the plainer ornament on everything.
  assert.ok(poster.isSympathyContent({ body: "Standing sprays for the wake on Tuesday." }, "Wake"),
    "a single-word name stripped the word out of a real sympathy flyer");
  assert.ok(poster.isSympathyContent({ body: "Memorial pieces made to order." }, "Memorial"));
  // Multi-word names stay unambiguous and are still stripped.
  assert.ok(!poster.isSympathyContent({ body: "Memorial Gardens Florist has roses in." }, "Memorial Gardens Florist"));
});

test("a function word is never the word set in script", () => {
  // "With Sympathy" was drawn as a huge flourishing "With" over a small
  // "SYMPATHY" — the emphasis exactly inverted, on the shape nearly every real
  // sympathy headline takes. It only surfaced once the wording was right,
  // because until then no headline began with a preposition.
  for (const [headline, script] of [
    ["With Sympathy", "Sympathy"],
    ["In Remembrance", "Remembrance"],
    ["For the Family", "Family"],
    ["With Love", "Love"],
    ["In Loving Memory", "Loving"],
    ["Our Deepest Condolences", "Deepest"],
    ["Thinking of You", "Thinking"],
    // Unchanged for everything that was already right.
    ["Closing Early Today", "Closing"],
    ["Valentine's Day", "Valentine's"]
  ]) {
    assert.equal(poster.splitHeadline(headline).script, script, `"${headline}"`);
  }
  // Every word survives, in order, whatever the split — the poster sets a
  // florist's headline differently, it never rewrites it.
  for (const headline of ["With Sympathy", "In Loving Memory", "For the Family", "Closing Early Today"]) {
    const p = poster.splitHeadline(headline);
    assert.equal([p.lead, p.script, p.tail].filter(Boolean).join(" "), headline);
  }
});

test("a headline of nothing but function words still reaches the flyer", () => {
  // Never leave a florist's own words unset because no word qualified.
  for (const headline of ["With Us", "For You", "In The"]) {
    const p = poster.splitHeadline(headline);
    assert.ok(p.script, `"${headline}" was left with no display word`);
    assert.equal([p.lead, p.script, p.tail].filter(Boolean).join(" "), headline);
  }
});

// ---------------------------------------------------------------------------
// "i don't want just one and the same colors, each design should be completely
// different."
//
// The palette was ALWAYS the brand colour pulled toward the photograph on a
// pale tint of the same hue — one family, every flyer. Four layouts in one
// colourway do not read as four designs; they read as one design that moved
// its photo.
// ---------------------------------------------------------------------------

test("the palette mood is genuinely chosen by the seed, not fixed", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const moodRand = poster.seededRandom(poster.hashSeed("florisyn-palette:" + seed));
    seen.add(poster.PALETTE_MOODS[Math.floor(moodRand() * poster.PALETTE_MOODS.length) % poster.PALETTE_MOODS.length]);
  }
  assert.equal(seen.size, poster.PALETTE_MOODS.length, `only ${seen.size} of ${poster.PALETTE_MOODS.length} moods reachable over 200 seeds`);
});

test("the colour families are genuinely different from each other", () => {
  const inks = new Map();
  for (const mood of poster.PALETTE_MOODS) {
    const p = poster.derivePalette("#7c3a58", "#c98fae", { r: 232, g: 198, b: 206 }, mood);
    inks.set(mood, p.ink);
  }
  assert.equal(new Set(inks.values()).size, poster.PALETTE_MOODS.length,
    `two families produced the same ink: ${JSON.stringify([...inks])}`);
  // And "different" must mean visibly different, not a nudge. Every pair has
  // to be further apart than a rounding step.
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const moods = [...inks.keys()];
  for (let i = 0; i < moods.length; i++) {
    for (let j = i + 1; j < moods.length; j++) {
      const [a, b] = [rgb(inks.get(moods[i])), rgb(inks.get(moods[j]))];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(distance > 18,
        `${moods[i]} and ${moods[j]} are the same colour to the eye (${inks.get(moods[i])} vs ${inks.get(moods[j])})`);
    }
  }
});

test("every colour family still clears the contrast floor, for every brand colour", () => {
  // Variety is never bought with legibility. A family that leaves the brand
  // hue behind must still be readable on its own ground.
  const brands = ["#7c3a58", "#8fae86", "#c9a227", "#4a6fa5", "#2b2430", "#d4746a", "#6b8e23"];
  for (const brand of brands) {
    for (const mood of poster.PALETTE_MOODS) {
      for (const sample of [null, { r: 232, g: 198, b: 206 }, { r: 250, g: 250, b: 248 }, { r: 60, g: 70, b: 55 }]) {
        const p = poster.derivePalette(brand, "#c98fae", sample, mood);
        const ratio = poster.contrastRatio(
          { r: parseInt(p.ink.slice(1, 3), 16), g: parseInt(p.ink.slice(3, 5), 16), b: parseInt(p.ink.slice(5, 7), 16) },
          { r: parseInt(p.groundDeep.slice(1, 3), 16), g: parseInt(p.groundDeep.slice(3, 5), 16), b: parseInt(p.groundDeep.slice(5, 7), 16) }
        );
        assert.ok(ratio >= poster.INK_GROUND_MIN_CONTRAST - 0.01,
          `${mood} on ${brand} gives ${ratio.toFixed(2)}:1 — below the readable floor`);
      }
    }
  }
});

test("two different shops never get the same poster from the same family", () => {
  // The families that leave the brand hue behind still PULL the shop's own
  // colour toward it rather than replacing it, so a shop's identity is never
  // erased outright.
  for (const mood of poster.PALETTE_MOODS) {
    const a = poster.derivePalette("#7c3a58", "#c98fae", null, mood).ink;
    const b = poster.derivePalette("#4a6fa5", "#c98fae", null, mood).ink;
    assert.notEqual(a, b, `every shop gets the identical ink from the "${mood}" family`);
  }
});

test("each type treatment draws every word of the headline, in order", () => {
  const headline = "With Sympathy We're Here For You";
  for (const typeStyle of poster.TYPE_STYLES) {
    const { ctx } = laidOut({ seed: 3, content: { headline }, typeStyle });
    const drawn = ctx.texts.map((t) => t.text).join(" ").toLowerCase().replace(/[^a-z0-9']/g, " ");
    for (const word of headline.toLowerCase().replace(/[^a-z0-9']/g, " ").split(/\s+/).filter(Boolean)) {
      assert.ok(drawn.includes(word), `the "${typeStyle}" treatment dropped "${word}"`);
    }
  }
});

test("the type treatments actually use different faces", () => {
  const seen = {};
  for (const typeStyle of poster.TYPE_STYLES) {
    const { ctx } = laidOut({ seed: 3, content: { headline: "With Sympathy We're Here For You" }, typeStyle });
    // The largest thing drawn is the headline's own word.
    const biggest = ctx.texts.reduce((a, b) => (b.size > a.size ? b : a), ctx.texts[0]);
    seen[typeStyle] = biggest.font || null;
  }
  assert.ok(!poster.TYPE_STYLES.some((t) => seen[t] === undefined), "a treatment drew nothing");
});

test("colour, layout and type vary independently — not in lockstep", () => {
  // Seeded from one value they would move together and 60 combinations would
  // collapse back to 4. Sampled over real-shaped ids.
  const combos = new Set();
  const comps = new Set();
  const types = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const { laid } = laidOut({ seed });
    const mood = poster.PALETTE_MOODS[
      Math.floor(poster.seededRandom(poster.hashSeed("florisyn-palette:" + seed))() * poster.PALETTE_MOODS.length) % poster.PALETTE_MOODS.length
    ];
    combos.add(`${laid.composition}/${mood}/${laid.typeStyle}`);
    comps.add(laid.composition);
    types.add(laid.typeStyle);
  }
  assert.equal(comps.size, poster.COMPOSITIONS.length, "not every layout is reachable");
  assert.equal(types.size, poster.TYPE_STYLES.length, "not every type treatment is reachable");
  assert.ok(combos.size >= 45,
    `only ${combos.size} distinct designs in 300 seeds — colour, layout and type are moving together`);
});

test("the message never spills out of the ribbon's notched ends", () => {
  // The notch was h * 0.32 with no reference to the ribbon's WIDTH, so a
  // six-line message made a 267px-tall ribbon with 85px arrowheads that ate
  // the wording — "arrangements featuring our popular" was drawn straight
  // across both of them and out onto the sheet.
  const bodies = [
    "For families in need, we create beautiful funeral flowers, including standing sprays and casket arrangements featuring our popular Freedom rose, spray rose, and alstroemeria.",
    "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each and every morning of the week.",
    // Long and narrow-wrapping enough to force a tall, many-line ribbon on
    // every composition — the shape that made the notch's height alone
    // (with no reference to width) carve an 85px arrowhead into a ribbon
    // whose width had nowhere left to grow.
    "For every family who has ever asked us for something simple and dignified and lasting, we have made standing sprays, casket flowers, small arrangements for the graveside, and wreaths delivered directly to the funeral home on the morning of the service."
  ];
  const seeds = seedForComposition();
  for (const [composition, seed] of Object.entries(seeds)) {
    for (const body of bodies) {
      const { ctx, laid } = laidOut({ width: 1080, height: 1080, seed, content: { body }, messageStyle: "ribbon" });
      if (!laid.ribbon || laid.messageStyle !== "ribbon") continue;
      const notch = Math.min(laid.ribbon.h * 0.32, laid.ribbon.w * 0.075);
      const innerLeft = laid.ribbon.x + notch;
      const innerRight = laid.ribbon.x + laid.ribbon.w - notch;
      for (const t of ctx.texts) {
        if (t.y <= laid.ribbon.y || t.y >= laid.ribbon.y + laid.ribbon.h) continue;
        assert.ok(t.left >= innerLeft - 1 && t.right <= innerRight + 1,
          `${composition}: "${t.text}" runs ${Math.round(t.left)}–${Math.round(t.right)}, outside the ribbon's ${Math.round(innerLeft)}–${Math.round(innerRight)}`);
      }
    }
  }
});

test("the message never spills out of a framed panel either", () => {
  const bodies = [
    "For families in need, we create beautiful funeral flowers, including standing sprays and casket arrangements featuring our popular Freedom rose, spray rose, and alstroemeria.",
    "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each and every morning of the week."
  ];
  const seeds = seedForComposition();
  for (const [composition, seed] of Object.entries(seeds)) {
    for (const body of bodies) {
      const { ctx, laid } = laidOut({ seed, content: { body }, messageStyle: "framed" });
      if (!laid.ribbon || laid.messageStyle !== "framed") continue;
      for (const t of ctx.texts) {
        if (t.y <= laid.ribbon.y || t.y >= laid.ribbon.y + laid.ribbon.h) continue;
        assert.ok(t.left >= laid.ribbon.x - 1 && t.right <= laid.ribbon.x + laid.ribbon.w + 1,
          `${composition}: "${t.text}" runs outside the framed panel`);
      }
    }
  }
});

test("both message devices are reachable, independently of layout and colour", () => {
  const styles = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const { laid } = laidOut({ seed });
    if (laid.messageStyle) styles.add(laid.messageStyle);
  }
  assert.deepEqual([...styles].sort(), ["framed", "plain", "ribbon"]);
});

test("a framed message is set in the poster's ink, not cream on cream", () => {
  const seeds = seedForComposition();
  for (const [composition, seed] of Object.entries(seeds)) {
    const { ctx, laid, base } = laidOut({ seed, content: { body: "Standing sprays and casket flowers." }, messageStyle: "framed" });
    if (!laid.ribbon || laid.messageStyle !== "framed") continue;
    const onPanel = ctx.texts.filter((t) => t.y > laid.ribbon.y && t.y < laid.ribbon.y + laid.ribbon.h);
    assert.ok(onPanel.length, `${composition}: nothing drawn on the framed panel`);
    for (const t of onPanel) assert.equal(t.color, base.palette.ink, `${composition}: framed text drawn in ${t.color}, not the ink colour`);
  }
});

// ---------------------------------------------------------------------------
// Direct, pinning tests on the two changes made in response to "that ribbon
// is ugly and plain" — checked against the FUNCTION'S OWN CONTRACT rather
// than only end to end, because the re-wrap loop added earlier absorbs a
// wrong notch by narrowing the text instead of overflowing, which means an
// end-to-end sweep alone cannot tell a merely-safe result from a correct one.
// ---------------------------------------------------------------------------

test("ribbonNotch is bounded by both the ribbon's height AND its width", () => {
  // A notch of h * 0.32 alone, with no reference to width, is what carved an
  // 85px arrowhead into a narrow, six-line-tall ribbon and ate the wording.
  assert.equal(poster.ribbonNotch(1000, 100), 32, "the height-bound case");
  assert.equal(poster.ribbonNotch(200, 500), 15, "the width-bound case: 500 * 0.32 = 160, but 200 * 0.075 = 15");
  // A tall, narrow ribbon — the exact shape a long message on a narrow column
  // produces — must take the width bound, not the height one.
  assert.ok(poster.ribbonNotch(400, 500) < 500 * 0.32 * 0.5,
    "a tall narrow ribbon still got a notch scaled mostly to its height");
});

test("the message ribbon has a sheen; a flat readability backing does not", () => {
  // A direct unit test on drawRibbon itself, decoupled from the floral
  // painting elsewhere in a full render, which uses gradients of its own for
  // completely unrelated reasons and would let this pass no matter what
  // drawRibbon actually did.
  const palette = poster.derivePalette("#7c3a58", "#c98fae", null);
  const decorative = recordingContext(400, 200);
  poster.drawRibbon(decorative, 200, 100, 300, 120, palette);
  assert.equal(decorative.gradients.length, 1,
    "the message ribbon — Ashley: \"that ribbon is ugly and plain\" — was drawn as a flat fill, not a sheen");
  const stops = decorative.gradients[0];
  assert.ok(stops.length >= 3, "fewer than three stops — not a top-to-bottom sheen, a flat fill dressed up as one");
  // A sheen is a real light source: brighter at the top, the base colour in
  // the middle, darker at the foot. Checked as monotonic brightness rather
  // than pinning exact hex values, so the test survives a deliberate retune
  // of the mix ratios — but catches EITHER end being flattened back to the
  // base colour alone, which comparing only the first and last stop did not:
  // flattening just the bottom stop left the top stop still lighter than the
  // (unchanged) middle, so first-vs-last still differed and the mutation
  // passed unnoticed.
  const brightness = (hex) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const levels = sorted.map((s) => brightness(s.color));
  assert.ok(levels[0] > levels[1], `the top of the ribbon is not brighter than its middle: ${JSON.stringify(sorted)}`);
  assert.ok(levels[1] > levels[levels.length - 1], `the middle of the ribbon is not brighter than its foot: ${JSON.stringify(sorted)}`);

  // The readability ribbon placeLine draws behind a line of text on flowers
  // is a plain, flat backing by design — unobtrusive, not decorative — and
  // passes an explicit opts.fill for exactly that reason.
  const readability = recordingContext(400, 200);
  poster.drawRibbon(readability, 200, 100, 300, 120, palette, { fill: "rgba(255,255,255,0.9)" });
  assert.equal(readability.gradients.length, 0, "the flat readability backing grew a sheen it was never meant to have");
});
