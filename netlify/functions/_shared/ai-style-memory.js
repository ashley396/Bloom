/**
 * Lily's per-shop learned creative style memory.
 *
 * Not a settings form the florist fills out — Lily learns it the same way
 * any creative assistant would: an explicit statement ("I like soft luxury
 * backgrounds") writes immediately; a trait that keeps showing up across
 * multiple SAVED creations gets promoted after real repetition; a trait
 * that keeps getting undone/rejected weakens. A one-turn override ("make
 * it dark and dramatic this time") never touches this table at all — see
 * ai-intent-router.js's CLASSIFY_TASK for where that boundary is drawn.
 *
 * Every function here is a pure transform over a plain `preferences`
 * object EXCEPT loadStyleMemory()/saveStyleMemory(), which are the only
 * two that touch the database — keeps the actual learning logic fully
 * unit-testable without a fake client.
 */

export const STYLE_CATEGORIES = Object.freeze([
  "background_style", // "soft luxury", "white marble", "clean studio backdrop"
  "materials", // "marble", "linen", "reclaimed wood"
  "lighting", // "warm natural light", "bright and airy"
  "colors", // "cream", "blush" positive / "neon pink" negative
  "mood", // "elegant", "luxury", "country" / "modern" negative
  "typography", // "classic serif", "handwritten"
  "flyer_style", // "elegant floral", "bold and minimal"
  "product_photo_style", // "bright and airy", "shallow depth of field"
  "social_post_style", // "warm and conversational", "concise"
  "floral_decoration_level", // "minimal", "moderate", "abundant"
  "realism_level", // "photographic", "stylized"
  "general_avoid" // cross-cutting negative-only traits: "cluttered", "neon"
]);

const PROMOTE_THRESHOLD = 3; // repeated SAVED signals before an inferred trait becomes active
// There's no separate demote-to-remove threshold constant: removal is
// evidence_count reaching 0 (see recordApprovalSignal() below), so a
// candidate removes after exactly as many UNDONE signals as it took SAVED
// signals to accumulate — one save + one undo removes a brand-new
// candidate; a trait that had built up toward PROMOTE_THRESHOLD needs
// that many undos to fully reverse.

function emptyCategory() {
  return { traits: [] };
}

export function defaultPreferences() {
  const prefs = {};
  for (const c of STYLE_CATEGORIES) prefs[c] = emptyCategory();
  return prefs;
}

/** Fills in any category missing from a stored row (e.g. an older row from
 * before a new category was added) without ever dropping real data. */
export function normalizePreferences(raw) {
  const base = defaultPreferences();
  if (!raw || typeof raw !== "object") return base;
  for (const category of STYLE_CATEGORIES) {
    const stored = raw[category];
    if (!stored || !Array.isArray(stored.traits)) continue;
    base[category] = {
      traits: stored.traits
        .filter((t) => t && typeof t.text === "string" && t.text.trim())
        .map((t) => ({
          text: String(t.text).trim().slice(0, 120),
          polarity: t.polarity === "negative" ? "negative" : "positive",
          source: t.source === "explicit" ? "explicit" : "inferred",
          active: Boolean(t.active),
          evidence_count: Math.max(0, Number(t.evidence_count) || 0),
          last_signal_at: t.last_signal_at || null
        }))
    };
  }
  return base;
}

function normText(text) {
  return String(text || "").trim().toLowerCase();
}

function findTraitIndex(category, text) {
  const target = normText(text);
  return category.traits.findIndex((t) => normText(t.text) === target);
}

/** Explicit statement path — "I like soft luxury backgrounds" writes
 * immediately, full strength, source "explicit". An explicit statement in
 * one polarity also clears any conflicting entry in the opposite polarity
 * for the same trait text (the shop changed its mind; memory shouldn't
 * hold both "I love pink" and "I hate pink" for the same word). */
export function applyExplicitPreferenceUpdates(preferences, updates = []) {
  const next = { ...preferences };
  for (const raw of updates) {
    const category = STYLE_CATEGORIES.includes(raw?.category) ? raw.category : null;
    const text = normText(raw?.text);
    const polarity = raw?.polarity === "negative" ? "negative" : "positive";
    if (!category || !text) continue;
    const bucket = { traits: [...(next[category]?.traits || [])] };
    const opposite = polarity === "positive" ? "negative" : "positive";
    const oppIdx = bucket.traits.findIndex((t) => normText(t.text) === text && t.polarity === opposite);
    if (oppIdx !== -1) bucket.traits.splice(oppIdx, 1);
    const idx = bucket.traits.findIndex((t) => normText(t.text) === text && t.polarity === polarity);
    const entry = {
      text: raw.text.trim().slice(0, 120),
      polarity,
      source: "explicit",
      active: true,
      evidence_count: (idx !== -1 ? bucket.traits[idx].evidence_count : 0) + 1,
      last_signal_at: new Date().toISOString()
    };
    if (idx !== -1) bucket.traits[idx] = entry;
    else bucket.traits.push(entry);
    next[category] = bucket;
  }
  return next;
}

/** Approval-signal path — never fires from a bare generation, only from a
 * real Save (reinforces) or a real Undo-without-saving (weakens). Explicit
 * traits are sticky here: an undone signal can weaken an inferred trait
 * toward removal, but never silently erases something the florist stated
 * outright — that only ever changes via forgetPreference() or a new
 * explicit statement. */
export function recordApprovalSignal(preferences, { traits = [], signal } = {}) {
  if (signal !== "saved" && signal !== "undone") return preferences;
  const next = { ...preferences };
  const now = new Date().toISOString();
  for (const t of traits) {
    const category = STYLE_CATEGORIES.includes(t?.category) ? t.category : null;
    const text = normText(t?.text);
    const polarity = t?.polarity === "negative" ? "negative" : "positive";
    if (!category || !text) continue;
    const bucket = { traits: [...(next[category]?.traits || [])] };
    const idx = bucket.traits.findIndex((e) => normText(e.text) === text && e.polarity === polarity);

    if (signal === "saved") {
      if (idx === -1) {
        bucket.traits.push({ text: t.text.trim().slice(0, 120), polarity, source: "inferred", active: false, evidence_count: 1, last_signal_at: now });
      } else {
        const entry = { ...bucket.traits[idx], evidence_count: bucket.traits[idx].evidence_count + 1, last_signal_at: now };
        if (!entry.active && entry.evidence_count >= PROMOTE_THRESHOLD) entry.active = true;
        bucket.traits[idx] = entry;
      }
    } else if (idx !== -1) {
      const entry = { ...bucket.traits[idx], evidence_count: Math.max(0, bucket.traits[idx].evidence_count - 1), last_signal_at: now };
      if (entry.source === "explicit") {
        // Sticky — weaken toward inactive on repeated rejection, but never delete outright.
        if (entry.evidence_count <= 0) entry.active = false;
        bucket.traits[idx] = entry;
      } else if (entry.evidence_count <= 0 && !entry.active) {
        bucket.traits.splice(idx, 1);
      } else {
        if (entry.evidence_count <= 0) entry.active = false;
        bucket.traits[idx] = entry;
      }
    }
    next[category] = bucket;
  }
  return next;
}

/** "Forget this preference" — removes one trait outright, explicit or not. */
export function forgetPreference(preferences, { category, text }) {
  if (!STYLE_CATEGORIES.includes(category)) return preferences;
  const idx = findTraitIndex(preferences[category] || emptyCategory(), text);
  if (idx === -1) return preferences;
  const bucket = { traits: preferences[category].traits.filter((_, i) => i !== idx) };
  return { ...preferences, [category]: bucket };
}

/** "Reset style" — clears everything Lily has learned for this shop. */
export function resetPreferences() {
  return defaultPreferences();
}

/** Only ACTIVE traits count as "the shop's style" for prompt-building and
 * for the My Style screen's headline chips — a candidate still building
 * evidence is real data (visible nowhere else, so nothing is hidden), but
 * it isn't confident enough yet to steer a generation. */
export function activeTraits(preferences, category) {
  return (preferences[category]?.traits || []).filter((t) => t.active);
}

/** A short, human-readable summary of the shop's active learned style —
 * this is what gets handed to the classifier as extra input, with an
 * explicit priority instruction (current message > this summary > generic
 * defaults) baked into CLASSIFY_TASK, not decided here. Returns "" when
 * the shop has no active style yet, so a brand-new shop's prompts are
 * unaffected. */
export function buildStyleSummary(preferences) {
  const lines = [];
  for (const category of STYLE_CATEGORIES) {
    if (category === "general_avoid") continue;
    const positive = activeTraits(preferences, category).filter((t) => t.polarity === "positive").map((t) => t.text);
    const negative = activeTraits(preferences, category).filter((t) => t.polarity === "negative").map((t) => t.text);
    if (positive.length) lines.push(`${category.replace(/_/g, " ")}: ${positive.join(", ")}`);
    if (negative.length) lines.push(`${category.replace(/_/g, " ")} to avoid: ${negative.join(", ")}`);
  }
  const avoid = activeTraits(preferences, "general_avoid").map((t) => t.text);
  if (avoid.length) lines.push(`always avoid: ${avoid.join(", ")}`);
  return lines.join("; ");
}

const TABLE = "ai_style_memory";

export async function loadStyleMemory(client, shopId) {
  const { data, error } = await client.from(TABLE).select("preferences").eq("shop_id", shopId).maybeSingle();
  if (error) return { preferences: defaultPreferences(), error: error.message };
  return { preferences: normalizePreferences(data?.preferences), error: null };
}

export async function saveStyleMemory(client, shopId, preferences) {
  const { error } = await client
    .from(TABLE)
    .upsert({ shop_id: shopId, preferences, updated_at: new Date().toISOString() }, { onConflict: "shop_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
