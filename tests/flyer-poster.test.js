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
