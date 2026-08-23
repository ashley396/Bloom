import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONAL_BRAND_CATEGORIES,
  defaultPreferences,
  defaultProfileFields,
  normalizePreferences,
  applyExplicitPreferenceUpdates,
  recordApprovalSignal,
  forgetPreference,
  resetPreferences,
  activeTraits,
  buildPersonalBrandStyleSummary,
  loadPersonalBrandProfile,
  savePersonalBrandProfileFields,
  savePersonalBrandPreferences
} from "../netlify/functions/_shared/personal-brand-memory.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

test("defaultPreferences covers every documented category with an empty bucket, and holds no sensitive-trait category", () => {
  const prefs = defaultPreferences();
  for (const category of PERSONAL_BRAND_CATEGORIES) {
    assert.ok(Array.isArray(prefs[category]?.traits), `missing category: ${category}`);
    assert.equal(prefs[category].traits.length, 0);
  }
  for (const forbidden of ["health", "religion", "political_affiliation", "sexual_orientation", "race_ethnicity"]) {
    assert.ok(!PERSONAL_BRAND_CATEGORIES.includes(forbidden), `sensitive category must never exist: ${forbidden}`);
  }
});

test("normalizePreferences fills in missing categories without dropping real data, never throws on garbage", () => {
  const stored = { clothing_style: { traits: [{ text: "black apron", polarity: "positive", source: "explicit", active: true, evidence_count: 1 }] } };
  const normalized = normalizePreferences(stored);
  assert.equal(normalized.clothing_style.traits[0].text, "black apron");
  assert.ok(Array.isArray(normalized.lighting.traits));
  assert.deepEqual(normalizePreferences(null), defaultPreferences());
  assert.deepEqual(normalizePreferences("garbage"), defaultPreferences());
});

test("applyExplicitPreferenceUpdates: 'I don't dress like that. Remember it.' writes immediately as a negative trait, full strength", () => {
  const next = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "clothing_style", text: "loud novelty prints", polarity: "negative" }]);
  const active = activeTraits(next, "clothing_style");
  assert.equal(active.length, 1);
  assert.equal(active[0].source, "explicit");
  assert.equal(active[0].polarity, "negative");
});

test("applyExplicitPreferenceUpdates: rejects an unknown category outright — no freeform category smuggling", () => {
  const next = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "sexual_orientation", text: "x", polarity: "positive" }]);
  assert.deepEqual(next, defaultPreferences());
});

test("applyExplicitPreferenceUpdates: stating the opposite clears the earlier contradictory entry", () => {
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "lighting", text: "harsh overhead", polarity: "negative" }]);
  prefs = applyExplicitPreferenceUpdates(prefs, [{ category: "lighting", text: "harsh overhead", polarity: "positive" }]);
  const lighting = activeTraits(prefs, "lighting");
  assert.equal(lighting.filter((t) => t.polarity === "negative").length, 0);
  assert.equal(lighting.filter((t) => t.polarity === "positive").length, 1);
});

test("recordApprovalSignal: one Approve never promotes a trait — real repetition is required (Section 4's threshold)", () => {
  let prefs = defaultPreferences();
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "environment_shop", text: "behind the marble counter", polarity: "positive" }], signal: "approved" });
  assert.equal(activeTraits(prefs, "environment_shop").length, 0);
});

test("recordApprovalSignal: three Approvals of the same trait promotes it to active (inferred)", () => {
  let prefs = defaultPreferences();
  for (let i = 0; i < 3; i++) {
    prefs = recordApprovalSignal(prefs, { traits: [{ category: "environment_shop", text: "behind the marble counter", polarity: "positive" }], signal: "approved" });
  }
  const active = activeTraits(prefs, "environment_shop");
  assert.equal(active.length, 1);
  assert.equal(active[0].source, "inferred");
  assert.equal(active[0].active, true);
});

test("recordApprovalSignal: repeated Rejects (\"don't use this hairstyle again\") weaken and eventually remove a fresh inferred candidate", () => {
  let prefs = defaultPreferences();
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "portrait_framing", text: "close-up headshot", polarity: "positive" }], signal: "approved" });
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "portrait_framing", text: "close-up headshot", polarity: "positive" }], signal: "rejected" });
  const bucket = prefs.portrait_framing.traits.find((t) => t.text === "close-up headshot");
  assert.equal(bucket, undefined, "a brand-new candidate removes after one save + one undo");
});

test("recordApprovalSignal: explicit traits are sticky — repeated rejection weakens to inactive but forgetPreference() is the only real removal path", () => {
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "expression", text: "genuine smile", polarity: "positive" }]);
  prefs = recordApprovalSignal(prefs, { traits: [{ category: "expression", text: "genuine smile", polarity: "positive" }], signal: "rejected" });
  const stillThere = prefs.expression.traits.find((t) => t.text === "genuine smile");
  assert.ok(stillThere, "an explicit trait must never be silently deleted by a rejection signal");
  assert.equal(stillThere.active, false);
});

test("forgetPreference removes a trait outright, explicit or not", () => {
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "props", text: "vintage watering can", polarity: "positive" }]);
  prefs = forgetPreference(prefs, { category: "props", text: "vintage watering can" });
  assert.equal(prefs.props.traits.length, 0);
});

test("resetPreferences clears every learned trait back to empty", () => {
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [{ category: "colors", text: "cream and sage", polarity: "positive" }]);
  prefs = resetPreferences();
  assert.deepEqual(prefs, defaultPreferences());
});

test("buildPersonalBrandStyleSummary: empty for a brand-new profile, readable once traits are active", () => {
  assert.equal(buildPersonalBrandStyleSummary(defaultPreferences()), "");
  let prefs = applyExplicitPreferenceUpdates(defaultPreferences(), [
    { category: "clothing_style", text: "black apron over a white blouse", polarity: "positive" },
    { category: "lighting", text: "harsh overhead", polarity: "negative" }
  ]);
  const summary = buildPersonalBrandStyleSummary(prefs);
  assert.match(summary, /clothing style: black apron over a white blouse/);
  assert.match(summary, /lighting to avoid: harsh overhead/);
});

// ── DB-touching load/save ────────────────────────────────────────────────

test("loadPersonalBrandProfile: a florist with no row yet gets honest defaults and exists:false, never a fabricated row", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const { profile, exists } = await loadPersonalBrandProfile(client, "shop-1");
  assert.equal(exists, false);
  assert.deepEqual(profile, { ...defaultProfileFields(), preferences: defaultPreferences() });
});

test("loadPersonalBrandProfile: returns the real stored fields and normalized preferences when a row exists", async () => {
  const client = createFakeSupabaseClient([
    {
      data: {
        display_name: "Jordan Lee",
        founder_title: "Owner & Lead Designer",
        founder_story: "Started in a garage in 2019.",
        professional_casual_balance: "casual",
        humor_level: "playful",
        preferences: { clothing_style: { traits: [{ text: "denim apron", polarity: "positive", source: "explicit", active: true, evidence_count: 1 }] } }
      },
      error: null
    }
  ]);
  const { profile, exists } = await loadPersonalBrandProfile(client, "shop-1");
  assert.equal(exists, true);
  assert.equal(profile.display_name, "Jordan Lee");
  assert.equal(profile.humor_level, "playful");
  assert.equal(profile.preferences.clothing_style.traits[0].text, "denim apron");
});

test("savePersonalBrandProfileFields: sanitizes and upserts only recognized fields", async () => {
  const client = createFakeSupabaseClient([{ data: { display_name: "Jordan Lee", humor_level: "playful" }, error: null }]);
  const result = await savePersonalBrandProfileFields(client, "shop-1", { display_name: "Jordan Lee", humor_level: "playful", not_a_field: "x" }, { userId: "u1" });
  assert.equal(result.ok, true);
  const upsertCall = client.calls.find((c) => c.ops.some((op) => op[0] === "upsert"));
  assert.equal(upsertCall.payload.display_name, "Jordan Lee");
  assert.equal(upsertCall.payload.humor_level, "playful");
  assert.equal(upsertCall.payload.not_a_field, undefined);
});

test("savePersonalBrandProfileFields: rejects an invalid enum value silently (never writes garbage into a checked column)", async () => {
  const client = createFakeSupabaseClient([{ data: {}, error: null }]);
  await savePersonalBrandProfileFields(client, "shop-1", { humor_level: "manic" }, { userId: "u1" });
  const upsertCall = client.calls.find((c) => c.ops.some((op) => op[0] === "upsert"));
  assert.equal(upsertCall.payload.humor_level, undefined);
});

test("savePersonalBrandPreferences: upserts the preferences jsonb only", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await savePersonalBrandPreferences(client, "shop-1", defaultPreferences());
  assert.equal(result.ok, true);
});
