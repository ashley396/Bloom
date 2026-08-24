import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPersistIntent,
  extractMoodPhrase,
  extractFactTokens,
  factsPreserved,
  deriveRevisionTraits,
  buildImageRevisionBrief,
  buildWordingRevisionRequestText
} from "../netlify/functions/_shared/marketing-content-revision.js";

test("detectPersistIntent: matches the required 'use this from now on' family, never a bare 'I like this'", () => {
  assert.equal(detectPersistIntent("I like this better, use this style from now on"), true);
  assert.equal(detectPersistIntent("use this from now on"), true);
  assert.equal(detectPersistIntent("always use this"), true);
  assert.equal(detectPersistIntent("keep it this way going forward"), true);
  assert.equal(detectPersistIntent("save this as my style"), true);
  assert.equal(detectPersistIntent("I like this"), false, "ambiguous approval alone must never trigger a permanent-preference write");
  assert.equal(detectPersistIntent("that looks good"), false);
  assert.equal(detectPersistIntent(""), false);
});

test("extractMoodPhrase: captures the florist's own literal words for the required 'make this X' phrasing", () => {
  assert.equal(extractMoodPhrase("make this more elegant"), "elegant");
  assert.equal(extractMoodPhrase("make it dark and dramatic"), "dark and dramatic");
  assert.equal(extractMoodPhrase("make the background brighter"), null, "must not misfire on an unrelated 'make the X Y' sentence");
  assert.equal(extractMoodPhrase("less pink"), null);
});

test("extractFactTokens / factsPreserved: real phone/date/price/URL survival check", () => {
  const original = "Call us at (555) 123-4567 by Dec 20th — $45 arrangements, order at https://example.com/order";
  assert.deepEqual(
    extractFactTokens(original).sort(),
    ["$45", "(555) 123-4567", "Dec 20th", "https://example.com/order"].sort()
  );
  assert.equal(factsPreserved(original, "New copy but still (555) 123-4567, Dec 20th, $45, and https://example.com/order stay the same."), true);
  assert.equal(factsPreserved(original, "New copy that dropped the phone number entirely, $45, Dec 20th, https://example.com/order"), false);
  assert.equal(factsPreserved("", "anything"), true, "nothing to preserve when the original had no facts");
});

test("deriveRevisionTraits: only records what the instruction actually asked for — never fabricates a category from nothing", () => {
  assert.deepEqual(deriveRevisionTraits("use a luxury flower shop background instead", { backgroundHint: "luxury flower shop" }), [
    { category: "background_style", text: "luxury flower shop", polarity: "positive" }
  ]);
  assert.deepEqual(deriveRevisionTraits("less pink, more cream", { colorsRemove: ["pink"], colorsAdd: ["cream"] }), [
    { category: "colors", text: "cream", polarity: "positive" },
    { category: "colors", text: "pink", polarity: "negative" }
  ]);
  assert.deepEqual(deriveRevisionTraits("make this more elegant", null), [{ category: "mood", text: "elegant", polarity: "positive" }]);
  assert.deepEqual(deriveRevisionTraits("I like this better, use this style from now on", null), [], "a bare persist-intent message with no new content carries no traits of its own");
});

test("buildImageRevisionBrief: always includes an explicit subject-preservation clause", () => {
  const brief = buildImageRevisionBrief({ instruction: "use a luxury flower shop background", priorVisualBrief: "a rose bouquet on a wooden counter" });
  assert.match(brief, /use a luxury flower shop background/);
  assert.match(brief, /do not change, remove, or redesign the product itself/i);
  assert.match(brief, /wooden counter/);
});

test("buildWordingRevisionRequestText: frames the instruction as overriding, and warns against dropping exact facts", () => {
  const text = buildWordingRevisionRequestText({ instruction: "make it shorter", brief: "Fall bouquet launch", priorText: "Order by Friday! Call (555) 123-4567." });
  assert.match(text, /overriding your own judgment/i);
  assert.match(text, /make it shorter/);
  assert.match(text, /\(555\) 123-4567/);
});
