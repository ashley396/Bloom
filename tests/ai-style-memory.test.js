import test from "node:test";
import assert from "node:assert/strict";
import {
  STYLE_CATEGORIES,
  defaultPreferences,
  normalizePreferences,
  applyExplicitPreferenceUpdates,
  recordApprovalSignal,
  forgetPreference,
  resetPreferences,
  activeTraits,
  buildStyleSummary
} from "../netlify/functions/_shared/ai-style-memory.js";

test("defaultPreferences covers every documented style category with an empty bucket", () => {
  const prefs = defaultPreferences();
  for (const category of STYLE_CATEGORIES) {
    assert.ok(Array.isArray(prefs[category]?.traits), `missing category: ${category}`);
    assert.equal(prefs[category].traits.length, 0);
  }
});

test("normalizePreferences fills in missing categories from an older/partial stored row without dropping real data", () => {
  const stored = { background_style: { traits: [{ text: "soft luxury", polarity: "positive", source: "explicit", active: true, evidence_count: 1 }] } };
  const normalized = normalizePreferences(stored);
  assert.equal(normalized.background_style.traits.length, 1);
  assert.equal(normalized.background_style.traits[0].text, "soft luxury");
  assert.ok(Array.isArray(normalized.lighting.traits), "a category absent from the stored row must still exist");
});

test("normalizePreferences never throws on garbage input", () => {
  assert.deepEqual(normalizePreferences(null), defaultPreferences());
  assert.deepEqual(normalizePreferences(undefined), defaultPreferences());
  assert.deepEqual(normalizePreferences("not an object"), defaultPreferences());
  assert.deepEqual(normalizePreferences({ background_style: "not a bucket" }), defaultPreferences());
});

test("applyExplicitPreferenceUpdates: 'I like soft luxury backgrounds' writes immediately, full strength, no repetition needed", () => {
  const next = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "background_style", text: "soft luxury", polarity: "positive" }]);
  const active = activeTraits(next, "background_style");
  assert.equal(active.length, 1);
  assert.equal(active[0].text, "soft luxury");
  assert.equal(active[0].source, "explicit");
  assert.equal(active[0].polarity, "positive");
});

test("applyExplicitPreferenceUpdates: 'I hate busy backgrounds' writes as a negative trait", () => {
  const next = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "general_avoid", text: "busy backgrounds", polarity: "negative" }]);
  const active = activeTraits(next, "general_avoid");
  assert.equal(active.length, 1);
  assert.equal(active[0].polarity, "negative");
});

test("applyExplicitPreferenceUpdates: stating the opposite clears the earlier contradictory entry — memory never holds both sides", () => {
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "colors", text: "pink", polarity: "negative" }]);
  assert.equal(activeTraits(prefs, "colors").filter((t) => t.polarity === "negative").length, 1);
  prefs = applyExplicitPreferenceUpdates(prefs, [{ category: "colors", text: "pink", polarity: "positive" }]);
  const colors = activeTraits(prefs, "colors");
  assert.equal(colors.filter((t) => t.polarity === "negative").length, 0, "the old negative 'pink' entry must be gone");
  assert.equal(colors.filter((t) => t.polarity === "positive").length, 1);
});

test("recordApprovalSignal: a single Save never promotes a trait to active — repetition is required", () => {
  let prefs = defaultPreferences();
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "lighting", text: "warm natural light", polarity: "positive" }], signal: "saved" });
  assert.equal(activeTraits(prefs, "lighting").length, 0, "one save must not be enough to promote a preference");
});

test("recordApprovalSignal: three Saves of the same trait promotes it to an active (inferred) preference", () => {
  let prefs = defaultPreferences();
  for (let i = 0; i < 3; i += 1) {
    prefs = recordApprovalSignal(prefs, { traits: [{ category: "lighting", text: "warm natural light", polarity: "positive" }], signal: "saved" });
  }
  const active = activeTraits(prefs, "lighting");
  assert.equal(active.length, 1);
  assert.equal(active[0].source, "inferred");
  assert.equal(active[0].text, "warm natural light");
});

test("recordApprovalSignal: repeated Undo on a still-candidate trait removes it — never becomes an active dislike out of nowhere", () => {
  let prefs = defaultPreferences();
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "mood", text: "dark and moody", polarity: "positive" }], signal: "saved" });
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "mood", text: "dark and moody", polarity: "positive" }], signal: "undone" });
  assert.equal(prefs.mood.traits.length, 0, "a rejected one-time candidate should be dropped, not kept around weakened forever");
});

test("recordApprovalSignal: Undo never deletes an EXPLICIT preference — only forgetPreference()/a new explicit statement can", () => {
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "mood", text: "elegant", polarity: "positive" }]);
  for (let i = 0; i < 5; i += 1) {
    prefs = recordApprovalSignal(prefs, { traits: [{ category: "mood", text: "elegant", polarity: "positive" }], signal: "undone" });
  }
  const entry = prefs.mood.traits.find((t) => t.text === "elegant");
  assert.ok(entry, "an explicit trait must still exist in memory after repeated undo signals");
  assert.equal(entry.source, "explicit");
});

test("forgetPreference removes exactly one trait, explicit or not", () => {
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [
    { category: "colors", text: "cream", polarity: "positive" },
    { category: "colors", text: "blush", polarity: "positive" }
  ]);
  prefs = forgetPreference(prefs, { category: "colors", text: "cream" });
  const texts = prefs.colors.traits.map((t) => t.text);
  assert.deepEqual(texts, ["blush"]);
});

test("resetPreferences clears everything back to the empty default shape", () => {
  const prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "mood", text: "elegant", polarity: "positive" }]);
  assert.deepEqual(resetPreferences(), defaultPreferences());
  assert.notDeepEqual(prefs, defaultPreferences(), "sanity: the pre-reset state really did have data");
});

test("buildStyleSummary is empty for a brand-new shop with no learned style", () => {
  assert.equal(buildStyleSummary(defaultPreferences()), "");
});

test("buildStyleSummary summarizes only ACTIVE traits, never a still-building candidate", () => {
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "lighting", text: "warm natural light", polarity: "positive" }]);
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "mood", text: "moody", polarity: "positive" }], signal: "saved" }); // only 1 save — still a candidate
  const summary = buildStyleSummary(prefs);
  assert.match(summary, /warm natural light/);
  assert.doesNotMatch(summary, /moody/, "a candidate with only one saved signal must not appear in the prompt-facing summary");
});

test("buildStyleSummary includes both positive and negative sides, and general_avoid", () => {
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [
    { category: "colors", text: "cream", polarity: "positive" },
    { category: "colors", text: "neon pink", polarity: "negative" },
    { category: "general_avoid", text: "cluttered", polarity: "negative" }
  ]);
  const summary = buildStyleSummary(prefs);
  assert.match(summary, /cream/);
  assert.match(summary, /avoid.*neon pink/);
  assert.match(summary, /always avoid.*cluttered/);
});
