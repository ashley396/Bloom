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
