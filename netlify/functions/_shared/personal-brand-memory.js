/**
 * Personal Brand Studio — Lily's learned "how does THIS florist want to
 * show up in their own marketing" memory.
 *
 * Deliberately the same shape and learning rules as ai-style-memory.js
 * (visual creative aesthetics) and marketing-brand-brain.js (marketing
 * voice/tone) — a third instance of the same proven engine, not a new
 * opaque memory system: an explicit statement ("I always wear my black
 * apron") writes immediately at full strength; a trait that keeps showing
 * up across repeated Approve/Save signals gets promoted after real
 * repetition; a trait that keeps getting Rejected/Regenerated weakens.
 * This is a *separate* domain from both of those — shop brand voice,
 * visual aesthetic style, and personal presentation preference are three
 * different kinds of learned preference with three different UIs/screens,
 * never merged.
 *
 * Every function here is a pure transform over a plain `preferences`
 * object EXCEPT the load/save functions at the bottom, which are the only
 * ones that touch the database — keeps the learning logic fully
 * unit-testable without a fake client.
 *
 * Explicitly OUT OF SCOPE for this memory (Section 1 of the directive):
 * health information, religion, political affiliation, sexual orientation,
 * race/ethnicity, or other protected/sensitive traits. This module has no
 * category for any of them, and applyExplicitPreferenceUpdates() rejects
 * any category not in PERSONAL_BRAND_CATEGORIES outright — there is no
 * freeform category a caller could smuggle a sensitive trait into.
 */

export const PERSONAL_BRAND_CATEGORIES = Object.freeze([
  "clothing_style", // "black apron over a white blouse", "no logos on outerwear"
  "colors", // "cream and sage" positive / "loud prints" negative
  "jewelry_accessories", // "simple gold hoops" positive / "no visible watch" negative
  "environment_shop", // "behind the marble design counter", "near the cooler wall"
  "environment_office", // "at the reclaimed-wood desk", "never the stockroom"
  "flower_preferences", // "garden roses", "always include eucalyptus"
  "props", // "kraft paper and twine", "vintage watering can"
  "portrait_framing", // "waist-up", "candid mid-task, not posed"
  "camera_distance", // "close, intimate", "wide, shows the whole shop"
  "lighting", // "warm natural window light", "never harsh overhead"
  "expression", // "genuine smile, mid-laugh", "calm and focused, not posed-serious"
  "personality_descriptors", // explicitly provided by the user, e.g. "witty", "plainspoken", "detail-obsessed"
  "general_avoid" // cross-cutting negative-only traits: "stock-photo look", "corporate office backdrop"
]);

const PROMOTE_THRESHOLD = 3; // repeated SAVED/APPROVED signals before an inferred trait becomes active

function emptyCategory() {
  return { traits: [] };
}

export function defaultPreferences() {
  const prefs = {};
  for (const c of PERSONAL_BRAND_CATEGORIES) prefs[c] = emptyCategory();
  return prefs;
}

export function defaultProfileFields() {
  return {
    display_name: "",
    founder_title: "",
    founder_story: "",
    professional_casual_balance: "balanced",
    humor_level: "light"
  };
}

/** Fills in any category missing from a stored row (e.g. an older row from
 * before a new category was added) without ever dropping real data. */
export function normalizePreferences(raw) {
  const base = defaultPreferences();
  if (!raw || typeof raw !== "object") return base;
  for (const category of PERSONAL_BRAND_CATEGORIES) {
    const stored = raw[category];
    if (!stored || !Array.isArray(stored.traits)) continue;
    base[category] = {
      traits: stored.traits
        .filter((t) => t && typeof t.text === "string" && t.text.trim())
        .map((t) => ({
          text: String(t.text).trim().slice(0, 160),
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

/** Explicit statement path — "I don't dress like that. Remember it." /
 * "I love this background. Remember this style." write immediately, full
 * strength, source "explicit". An explicit statement in one polarity also
 * clears any conflicting entry in the opposite polarity for the same trait
 * text — the florist changed their mind; memory shouldn't hold both. */
export function applyExplicitPreferenceUpdates(preferences, updates = []) {
  const next = { ...preferences };
  for (const raw of updates) {
    const category = PERSONAL_BRAND_CATEGORIES.includes(raw?.category) ? raw.category : null;
    const text = normText(raw?.text);
    const polarity = raw?.polarity === "negative" ? "negative" : "positive";
    if (!category || !text) continue;
    const bucket = { traits: [...(next[category]?.traits || [])] };
    const opposite = polarity === "positive" ? "negative" : "positive";
    const oppIdx = bucket.traits.findIndex((t) => normText(t.text) === text && t.polarity === opposite);
    if (oppIdx !== -1) bucket.traits.splice(oppIdx, 1);
    const idx = bucket.traits.findIndex((t) => normText(t.text) === text && t.polarity === polarity);
    const entry = {
      text: raw.text.trim().slice(0, 160),
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

/** Approval-signal path — fires from a real Approve/Favorite/Publish
 * (reinforces) or a real Reject/"Don't do this again" (weakens). Never
 * fires from a bare generation. Explicit traits are sticky: repeated
 * rejection can weaken one toward inactive, but forgetPreference() or a
 * new explicit statement is the only way to remove one outright. */
export function recordApprovalSignal(preferences, { traits = [], signal } = {}) {
  if (signal !== "approved" && signal !== "rejected") return preferences;
  const next = { ...preferences };
  const now = new Date().toISOString();
  for (const t of traits) {
    const category = PERSONAL_BRAND_CATEGORIES.includes(t?.category) ? t.category : null;
    const text = normText(t?.text);
    const polarity = t?.polarity === "negative" ? "negative" : "positive";
    if (!category || !text) continue;
    const bucket = { traits: [...(next[category]?.traits || [])] };
    const idx = bucket.traits.findIndex((e) => normText(e.text) === text && e.polarity === polarity);

    if (signal === "approved") {
      if (idx === -1) {
        bucket.traits.push({ text: t.text.trim().slice(0, 160), polarity, source: "inferred", active: false, evidence_count: 1, last_signal_at: now });
      } else {
        const entry = { ...bucket.traits[idx], evidence_count: bucket.traits[idx].evidence_count + 1, last_signal_at: now };
        if (!entry.active && entry.evidence_count >= PROMOTE_THRESHOLD) entry.active = true;
        bucket.traits[idx] = entry;
      }
    } else if (idx !== -1) {
      const entry = { ...bucket.traits[idx], evidence_count: Math.max(0, bucket.traits[idx].evidence_count - 1), last_signal_at: now };
      if (entry.source === "explicit") {
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
  if (!PERSONAL_BRAND_CATEGORIES.includes(category)) return preferences;
  const idx = findTraitIndex(preferences[category] || emptyCategory(), text);
  if (idx === -1) return preferences;
  const bucket = { traits: preferences[category].traits.filter((_, i) => i !== idx) };
  return { ...preferences, [category]: bucket };
}

/** "Reset learned preferences" — clears everything Lily has learned about
 * this florist's personal presentation. Does NOT touch the explicit
 * profile fields (display_name/founder_title/founder_story/etc) — those
 * are reset independently, since "forget my learned style" and "erase my
 * founder story" are different requests. */
export function resetPreferences() {
  return defaultPreferences();
}

/** Only ACTIVE traits count as "how this florist presents themselves" for
 * prompt-building and for the My Style screen's headline chips. */
export function activeTraits(preferences, category) {
  return (preferences[category]?.traits || []).filter((t) => t.active);
}

/** A short, human-readable summary of the florist's active learned
 * presentation preferences — what "Why Lily chose this" shows, and what
 * gets folded into a founder-concept generation prompt. Returns "" for a
 * florist with no learned preferences yet, so a brand-new profile's
 * prompts are unaffected. */
export function buildPersonalBrandStyleSummary(preferences) {
  const lines = [];
  for (const category of PERSONAL_BRAND_CATEGORIES) {
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

const TABLE = "marketing_personal_brand_profiles";
const PROFILE_FIELDS = ["display_name", "founder_title", "founder_story", "professional_casual_balance", "humor_level"];

function sanitizeProfileFields(fields = {}) {
  const out = {};
  if (typeof fields.display_name === "string") out.display_name = fields.display_name.trim().slice(0, 160);
  if (typeof fields.founder_title === "string") out.founder_title = fields.founder_title.trim().slice(0, 160);
  if (typeof fields.founder_story === "string") out.founder_story = fields.founder_story.trim().slice(0, 4000);
  if (["professional", "balanced", "casual"].includes(fields.professional_casual_balance)) {
    out.professional_casual_balance = fields.professional_casual_balance;
  }
  if (["serious", "light", "playful"].includes(fields.humor_level)) {
    out.humor_level = fields.humor_level;
  }
  return out;
}

/** Loads the full profile row (fields + learned preferences). A florist
 * with no row yet gets honest defaults and exists:false — never a
 * fabricated row. */
export async function loadPersonalBrandProfile(client, shopId) {
  const { data, error } = await client.from(TABLE).select("*").eq("shop_id", shopId).maybeSingle();
  if (error) return { profile: { ...defaultProfileFields(), preferences: defaultPreferences() }, exists: false, error: error.message };
  if (!data) return { profile: { ...defaultProfileFields(), preferences: defaultPreferences() }, exists: false, error: null };
  const fields = defaultProfileFields();
  for (const key of PROFILE_FIELDS) if (data[key] != null) fields[key] = data[key];
  return { profile: { ...fields, preferences: normalizePreferences(data.preferences) }, exists: true, error: null };
}

/** Upserts the explicit single-value profile fields (display name, title,
 * founder story, tone defaults). Never touches `preferences` — pass an
 * empty object plus real fields to update only what's given. */
export async function savePersonalBrandProfileFields(client, shopId, fields, { userId } = {}) {
  const sanitized = sanitizeProfileFields(fields);
  const { data, error } = await client
    .from(TABLE)
    .upsert(
      { shop_id: shopId, ...sanitized, created_by: userId || null, updated_at: new Date().toISOString() },
      { onConflict: "shop_id" }
    )
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, profile: data };
}

/** Upserts just the learned preferences jsonb. */
export async function savePersonalBrandPreferences(client, shopId, preferences) {
  const { error } = await client
    .from(TABLE)
    .upsert({ shop_id: shopId, preferences, updated_at: new Date().toISOString() }, { onConflict: "shop_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
