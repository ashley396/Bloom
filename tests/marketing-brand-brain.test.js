import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_CATEGORIES,
  defaultPreferences,
  normalizePreferences,
  applyExplicitBrandUpdates,
  recordBrandSignal,
  forgetBrandTrait,
  resetPreferences,
  activeTraits,
  buildBrandSummary
} from "../netlify/functions/_shared/marketing-brand-brain.js";

test("defaultPreferences covers every documented brand category with an empty bucket", () => {
  const prefs = defaultPreferences();
  for (const category of BRAND_CATEGORIES) {
    assert.ok(Array.isArray(prefs[category]?.traits), `missing category: ${category}`);
    assert.equal(prefs[category].traits.length, 0);
  }
});

test("normalizePreferences fills in missing categories from an older/partial stored row without dropping real data", () => {
  const stored = { voice_tone: { traits: [{ text: "warm and conversational", polarity: "positive", source: "explicit", active: true, evidence_count: 1 }] } };
  const normalized = normalizePreferences(stored);
  assert.equal(normalized.voice_tone.traits.length, 1);
  assert.equal(normalized.voice_tone.traits[0].text, "warm and conversational");
  assert.ok(Array.isArray(normalized.cta_style.traits), "a category absent from the stored row must still exist");
});

test("normalizePreferences never throws on garbage input", () => {
  assert.deepEqual(normalizePreferences(null), defaultPreferences());
  assert.deepEqual(normalizePreferences(undefined), defaultPreferences());
  assert.deepEqual(normalizePreferences("not an object"), defaultPreferences());
  assert.deepEqual(normalizePreferences({ voice_tone: "not a bucket" }), defaultPreferences());
});

test("applyExplicitBrandUpdates: 'always use the word artisan' writes immediately, full strength, no repetition needed", () => {
  const next = applyExplicitBrandUpdates(defaultPreferences(), [{ category: "preferred_words", text: "artisan", polarity: "positive" }]);
  const active = activeTraits(next, "preferred_words");
  assert.equal(active.length, 1);
  assert.equal(active[0].text, "artisan");
  assert.equal(active[0].source, "explicit");
  assert.equal(active[0].polarity, "positive");
});

test("applyExplicitBrandUpdates: 'never say cheap' writes as a negative trait", () => {
  const next = applyExplicitBrandUpdates(defaultPreferences(), [{ category: "avoided_words", text: "cheap", polarity: "negative" }]);
  const active = activeTraits(next, "avoided_words");
  assert.equal(active.length, 1);
  assert.equal(active[0].polarity, "negative");
});

test("applyExplicitBrandUpdates: stating the opposite clears the earlier contradictory entry — Brand Brain never holds both sides", () => {
  let prefs = applyExplicitBrandUpdates(defaultPreferences(), [{ category: "voice_tone", text: "playful", polarity: "negative" }]);
  assert.equal(activeTraits(prefs, "voice_tone").filter((t) => t.polarity === "negative").length, 1);
  prefs = applyExplicitBrandUpdates(prefs, [{ category: "voice_tone", text: "playful", polarity: "positive" }]);
  const tone = activeTraits(prefs, "voice_tone");
  assert.equal(tone.filter((t) => t.polarity === "negative").length, 0, "the old negative 'playful' entry must be gone");
  assert.equal(tone.filter((t) => t.polarity === "positive").length, 1);
});

test("recordBrandSignal: a single Approve never promotes a trait to active — repetition is required", () => {
  let prefs = defaultPreferences();
  prefs = recordBrandSignal(prefs, { traits: [{ category: "posting_personality", text: "elegant", polarity: "positive" }], signal: "approved" });
  assert.equal(activeTraits(prefs, "posting_personality").length, 0, "one approval must not be enough to promote a preference");
});

test("recordBrandSignal: three Approvals of the same trait promotes it to an active (inferred) preference", () => {
  let prefs = defaultPreferences();
  for (let i = 0; i < 3; i += 1) {
    prefs = recordBrandSignal(prefs, { traits: [{ category: "posting_personality", text: "elegant", polarity: "positive" }], signal: "approved" });
  }
  const active = activeTraits(prefs, "posting_personality");
  assert.equal(active.length, 1);
  assert.equal(active[0].source, "inferred");
  assert.equal(active[0].text, "elegant");
});

test("recordBrandSignal: repeated Reject on a still-candidate trait removes it — never becomes an active dislike out of nowhere", () => {
  let prefs = defaultPreferences();
  prefs = recordBrandSignal(prefs, { traits: [{ category: "content_density", text: "very long captions", polarity: "positive" }], signal: "approved" });
  prefs = recordBrandSignal(prefs, { traits: [{ category: "content_density", text: "very long captions", polarity: "positive" }], signal: "rejected" });
  assert.equal(prefs.content_density.traits.length, 0, "a rejected one-time candidate should be dropped, not kept around weakened forever");
});

test("recordBrandSignal: Reject never deletes an EXPLICIT preference — only forgetBrandTrait()/a new explicit statement can", () => {
  let prefs = applyExplicitBrandUpdates(defaultPreferences(), [{ category: "avoided_words", text: "cheap", polarity: "negative" }]);
  for (let i = 0; i < 5; i += 1) {
    prefs = recordBrandSignal(prefs, { traits: [{ category: "avoided_words", text: "cheap", polarity: "negative" }], signal: "rejected" });
  }
  const entry = prefs.avoided_words.traits.find((t) => t.text === "cheap");
  assert.ok(entry, "an explicit trait must still exist in memory after repeated reject signals");
  assert.equal(entry.source, "explicit");
});

test("forgetBrandTrait removes exactly one trait, explicit or not", () => {
  let prefs = applyExplicitBrandUpdates(defaultPreferences(), [
    { category: "preferred_words", text: "artisan", polarity: "positive" },
    { category: "preferred_words", text: "local", polarity: "positive" }
  ]);
  prefs = forgetBrandTrait(prefs, { category: "preferred_words", text: "artisan" });
  const texts = prefs.preferred_words.traits.map((t) => t.text);
  assert.deepEqual(texts, ["local"]);
});

test("resetPreferences clears everything back to the empty default shape", () => {
  const prefs = applyExplicitBrandUpdates(defaultPreferences(), [{ category: "voice_tone", text: "warm", polarity: "positive" }]);
  assert.deepEqual(resetPreferences(), defaultPreferences());
  assert.notDeepEqual(prefs, defaultPreferences(), "sanity: the pre-reset state really did have data");
});

test("buildBrandSummary is empty for a brand-new shop with no learned brand voice", () => {
  assert.equal(buildBrandSummary(defaultPreferences()), "");
});

test("buildBrandSummary summarizes only ACTIVE traits, never a still-building candidate", () => {
  let prefs = applyExplicitBrandUpdates(defaultPreferences(), [{ category: "voice_tone", text: "warm and conversational", polarity: "positive" }]);
  prefs = recordBrandSignal(prefs, { traits: [{ category: "posting_personality", text: "playful", polarity: "positive" }], signal: "approved" }); // only 1 approval — still a candidate
  const summary = buildBrandSummary(prefs);
  assert.match(summary, /warm and conversational/);
  assert.doesNotMatch(summary, /playful/, "a candidate with only one approval signal must not appear in the prompt-facing summary");
});

test("buildBrandSummary includes both positive and negative sides, and general_avoid", () => {
  let prefs = applyExplicitBrandUpdates(defaultPreferences(), [
    { category: "preferred_words", text: "artisan", polarity: "positive" },
    { category: "avoided_words", text: "cheap", polarity: "negative" },
    { category: "general_avoid", text: "clickbait", polarity: "negative" }
  ]);
  const summary = buildBrandSummary(prefs);
  assert.match(summary, /artisan/);
  assert.match(summary, /avoided words.*cheap/);
  assert.match(summary, /always avoid.*clickbait/);
});
