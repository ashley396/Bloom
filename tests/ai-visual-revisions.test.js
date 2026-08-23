import test from "node:test";
import assert from "node:assert/strict";
import { parseRevisionDeltas, applyRevisionDeltas, defaultVisualStyle } from "../netlify/functions/_shared/ai-visual-revisions.js";

test("parseRevisionDeltas: 'make the phone number bigger and use less pink' matches both a scale and a color delta", () => {
  const deltas = parseRevisionDeltas("make the phone number bigger and use less pink");
  assert.equal(deltas.scale.cta, 1);
  assert.deepEqual(deltas.colorsRemove, ["pink"]);
});

test("parseRevisionDeltas: 'make the headline smaller' scales only the headline, not the body or cta", () => {
  const deltas = parseRevisionDeltas("make the headline smaller");
  assert.deepEqual(deltas.scale, { headline: -1 });
});

test("parseRevisionDeltas: 'make the text bigger' with no specific target scales everything", () => {
  const deltas = parseRevisionDeltas("make the text bigger");
  assert.deepEqual(deltas.scale, { headline: 1, body: 1, cta: 1 });
});

test("parseRevisionDeltas: 'use more cream' adds a positive color delta", () => {
  const deltas = parseRevisionDeltas("use more cream");
  assert.deepEqual(deltas.colorsAdd, ["cream"]);
});

test("parseRevisionDeltas: 'use a white marble background instead' captures the background hint phrase", () => {
  const deltas = parseRevisionDeltas("use a white marble background instead");
  assert.equal(deltas.backgroundHint, "white marble");
});

test("parseRevisionDeltas: returns null for a message with no recognizable revision pattern", () => {
  assert.equal(parseRevisionDeltas("tell me a joke"), null);
  assert.equal(parseRevisionDeltas(""), null);
  assert.equal(parseRevisionDeltas(null), null);
});

test("defaultVisualStyle starts every scale at 'normal' with empty palette overrides", () => {
  const style = defaultVisualStyle();
  assert.deepEqual(style.scale, { headline: "normal", body: "normal", cta: "normal" });
  assert.deepEqual(style.paletteExclude, []);
  assert.deepEqual(style.paletteInclude, []);
});

test("applyRevisionDeltas: a 'bigger' delta steps the cta scale up exactly one size", () => {
  const style = applyRevisionDeltas(defaultVisualStyle(), { scale: { cta: 1 } });
  assert.equal(style.scale.cta, "large");
  assert.equal(style.scale.headline, "normal", "an untouched target must not move");
});

test("applyRevisionDeltas: scale never overshoots past the largest/smallest step", () => {
  let style = defaultVisualStyle();
  for (let i = 0; i < 10; i += 1) style = applyRevisionDeltas(style, { scale: { cta: 1 } });
  assert.equal(style.scale.cta, "xx-large");
  for (let i = 0; i < 10; i += 1) style = applyRevisionDeltas(style, { scale: { cta: -1 } });
  assert.equal(style.scale.cta, "small");
});

test("applyRevisionDeltas: removing a color clears it from paletteInclude and adds it to paletteExclude", () => {
  let style = applyRevisionDeltas(defaultVisualStyle(), { colorsAdd: ["pink"] });
  assert.deepEqual(style.paletteInclude, ["pink"]);
  style = applyRevisionDeltas(style, { colorsRemove: ["pink"] });
  assert.deepEqual(style.paletteInclude, []);
  assert.deepEqual(style.paletteExclude, ["pink"]);
});

test("applyRevisionDeltas: re-adding a previously-excluded color clears the exclusion (the florist changed their mind again)", () => {
  let style = applyRevisionDeltas(defaultVisualStyle(), { colorsRemove: ["pink"] });
  assert.deepEqual(style.paletteExclude, ["pink"]);
  style = applyRevisionDeltas(style, { colorsAdd: ["pink"] });
  assert.deepEqual(style.paletteExclude, []);
  assert.deepEqual(style.paletteInclude, ["pink"]);
});

test("applyRevisionDeltas never mutates the style object passed in", () => {
  const original = defaultVisualStyle();
  const snapshot = JSON.parse(JSON.stringify(original));
  applyRevisionDeltas(original, { scale: { cta: 1 }, colorsAdd: ["pink"] });
  assert.deepEqual(original, snapshot);
});
