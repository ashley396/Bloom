import test from "node:test";
import assert from "node:assert/strict";
import { cleanJson } from "../netlify/functions/ai-assistant.js";

// Regression context: live-tested Lily AI Studio with a real prompt
// ("Write a short local SEO tagline for my shop") against Cloudflare
// Workers AI (llama-3.1-8b-instruct-fast). The model replied with a
// sentence followed by TWO separate JSON blocks instead of one object
// matching the requested schema:
//
//   Here's a draft tagline for Lilies in Bloom:
//
//   {"message":"Prestonsburg's sweetest blooms, delivered with love, just for you!"}
//
//   {"website":{"tagline":"Prestonsburg's sweetest blooms, delivered with love, just for you!"}}
//
// The old cleanJson used a single greedy /\{[\s\S]*\}/ regex, which spans
// first-brace-to-last-brace across BOTH blocks — not valid JSON as one
// document — so it always failed to parse and fell back to `{text: <the
// whole raw string>}`. The frontend then rendered that raw string,
// literal JSON syntax included, directly into Lily's chat bubble AND read
// it out loud via speech synthesis, while the real website.tagline patch
// was silently dropped (never applied to the draft/preview).

const REAL_BROKEN_REPLY = `Here's a draft tagline for Lilies in Bloom:\n\n{"message":"Prestonsburg's sweetest blooms, delivered with love, just for you!"}\n\n{"website":{"tagline":"Prestonsburg's sweetest blooms, delivered with love, just for you!"}}`;

test("cleanJson recovers and merges multiple JSON blocks from a real captured broken Lily reply", () => {
  const result = cleanJson(REAL_BROKEN_REPLY);
  assert.ok(result, "must recover a structured object instead of returning null");
  assert.equal(result.message, "Prestonsburg's sweetest blooms, delivered with love, just for you!");
  assert.equal(result.website?.tagline, "Prestonsburg's sweetest blooms, delivered with love, just for you!");
});

test("cleanJson never leaves literal JSON syntax anywhere the merged object's own text values", () => {
  const result = cleanJson(REAL_BROKEN_REPLY);
  assert.doesNotMatch(result.message, /[{}]/, "message field must be plain prose, not contain stray braces");
});

test("cleanJson still parses a single clean JSON object (the common, correct case)", () => {
  const result = cleanJson('{"message":"Here you go!","website":{"tagline":"Fresh flowers daily."}}');
  assert.equal(result.message, "Here you go!");
  assert.equal(result.website.tagline, "Fresh flowers daily.");
});

test("cleanJson handles a fenced ```json code block (single object, no prose)", () => {
  const result = cleanJson('```json\n{"message":"hi"}\n```');
  assert.equal(result.message, "hi");
});

test("cleanJson is string-aware — a brace character inside a quoted value doesn't break span detection", () => {
  const result = cleanJson('{"message":"Use code {SAVE10} at checkout"}');
  assert.equal(result.message, "Use code {SAVE10} at checkout");
});

test("cleanJson returns null (not a crash) for plain prose with no JSON at all", () => {
  const result = cleanJson("Just a plain sentence with no JSON in it.");
  assert.equal(result, null);
});

test("cleanJson deep-merges nested objects rather than letting a later block clobber an earlier sibling key", () => {
  const result = cleanJson('{"website":{"tagline":"A"}} {"website":{"hero_title":"B"}}');
  assert.equal(result.website.tagline, "A");
  assert.equal(result.website.hero_title, "B");
});
