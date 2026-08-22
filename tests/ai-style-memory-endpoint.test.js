import test from "node:test";
import assert from "node:assert/strict";
import { toScreenPayload } from "../netlify/functions/ai-style-memory.js";
import { defaultPreferences, applyExplicitPreferenceUpdates, recordApprovalSignal } from "../netlify/functions/_shared/ai-style-memory.js";

test("toScreenPayload: a brand-new shop has every category present but empty, and an empty summary", () => {
  const payload = toScreenPayload(defaultPreferences());
  assert.equal(payload.summary, "");
  assert.deepEqual(payload.categories.background_style, { active: [], learning: [] });
  assert.ok("materials" in payload.categories);
  assert.ok("general_avoid" in payload.categories);
});

test("toScreenPayload: an explicit statement shows up immediately under 'active', never 'learning'", () => {
  let prefs = defaultPreferences();
  prefs = applyExplicitPreferenceUpdates(prefs, [{ category: "background_style", text: "soft luxury", polarity: "positive" }]);
  const payload = toScreenPayload(prefs);
  assert.equal(payload.categories.background_style.active.length, 1);
  assert.equal(payload.categories.background_style.active[0].text, "soft luxury");
  assert.equal(payload.categories.background_style.learning.length, 0);
});

test("toScreenPayload: an inferred trait still building evidence shows up under 'learning', not 'active' — visible, but honestly labeled as not yet part of the shop's style", () => {
  let prefs = defaultPreferences();
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "colors", text: "cream", polarity: "positive" }], signal: "saved" });
  const payload = toScreenPayload(prefs);
  assert.equal(payload.categories.colors.active.length, 0);
  assert.equal(payload.categories.colors.learning.length, 1);
  assert.equal(payload.categories.colors.learning[0].evidence_count, 1);
});

test("toScreenPayload: once an inferred trait crosses the promotion threshold, it moves from 'learning' to 'active'", () => {
  let prefs = defaultPreferences();
  for (let i = 0; i < 3; i += 1) {
    prefs = recordApprovalSignal(prefs, { traits: [{ category: "colors", text: "cream", polarity: "positive" }], signal: "saved" });
  }
  const payload = toScreenPayload(prefs);
  assert.equal(payload.categories.colors.active.length, 1);
  assert.equal(payload.categories.colors.learning.length, 0);
});

test("toScreenPayload: summary reflects only active traits, matching buildStyleSummary()'s own contract", () => {
  let prefs = defaultPreferences();
  prefs = applyExplicitPreferenceUpdates(prefs, [{ category: "mood", text: "elegant", polarity: "positive" }]);
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "colors", text: "cream", polarity: "positive" }], signal: "saved" }); // only 1 signal — still learning
  const payload = toScreenPayload(prefs);
  assert.match(payload.summary, /elegant/);
  assert.doesNotMatch(payload.summary, /cream/, "a trait still building evidence must not appear in the summary used to steer real generations");
});
