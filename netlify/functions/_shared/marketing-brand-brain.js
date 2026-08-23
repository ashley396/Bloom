/**
 * Lily's per-shop learned marketing "Brand Brain" — the persistent brand
 * voice/style memory the Marketing Studio build directive (Section 15)
 * calls for.
 *
 * Deliberately the same shape and learning rules as
 * _shared/ai-style-memory.js (visual creative style): an explicit
 * statement ("always use the word 'artisan', never 'cheap'") writes
 * immediately at full strength; a trait that keeps showing up across
 * repeated Approve/Publish signals gets promoted after real repetition; a
 * trait that keeps getting Rejected/Regenerated weakens. This is a
 * *separate* table/domain from visual style (marketing voice/tone/CTAs vs.
 * flyer/background aesthetics) — a shop's Brand Brain and its Lily Visual
 * Creation Studio style memory are independent and never merged, since
 * "avoid neon colors" and "avoid the word 'cheap'" are different kinds of
 * preference with different UIs (My Style vs. Marketing Studio settings).
 *
 * Every function here is a pure transform over a plain `preferences`
 * object EXCEPT loadBrandBrain()/saveBrandBrain(), which are the only two
 * that touch the database — keeps the learning logic fully unit-testable
 * without a fake client.
 */

export const BRAND_CATEGORIES = Object.freeze([
  "voice_tone", // "warm and conversational", "professional and polished"
  "preferred_words", // "artisan", "hand-tied", "local"
  "avoided_words", // "cheap", "basic", "discount"
  "cta_style", // "Shop Now", "Book Your Bouquet" / soft-sell negative
  "content_density", // "concise captions", "detailed storytelling"
  "audience_description", // "busy local moms", "wedding couples"
  "posting_personality", // "playful", "elegant", "down-to-earth"
  "hashtag_style", // "minimal (2-3)", "discovery-heavy"
  "approved_content_themes", // "behind-the-scenes", "seasonal collections"
  "rejected_content_themes", // themes the shop has declined repeatedly
  "general_avoid" // cross-cutting negative-only traits, any category
]);

const PROMOTE_THRESHOLD = 3; // repeated approve/publish signals before an inferred trait activates

function emptyCategory() {
  return { traits: [] };
}

export function defaultPreferences() {
  const prefs = {};
  for (const c of BRAND_CATEGORIES) prefs[c] = emptyCategory();
  return prefs;
}

/** Fills in any category missing from a stored row without ever dropping real data. */
export function normalizePreferences(raw) {
  const base = defaultPreferences();
  if (!raw || typeof raw !== "object") return base;
  for (const category of BRAND_CATEGORIES) {
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

/** Explicit statement path — writes immediately, full strength, source
 * "explicit". Clears any conflicting opposite-polarity entry for the same
 * text (the shop changed its mind about a word/theme). */
export function applyExplicitBrandUpdates(preferences, updates = []) {
  const next = { ...preferences };
  for (const raw of updates) {
    const category = BRAND_CATEGORIES.includes(raw?.category) ? raw.category : null;
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

/** Approval-signal path — fires from a real Approve/Publish (reinforces) or
 * a real Reject/Regenerate-without-publishing (weakens). Explicit traits
 * are sticky: repeated rejection can weaken one toward inactive, but never
 * silently erases something the florist stated outright. */
export function recordBrandSignal(preferences, { traits = [], signal } = {}) {
  if (signal !== "approved" && signal !== "rejected") return preferences;
  const next = { ...preferences };
  const now = new Date().toISOString();
  for (const t of traits) {
    const category = BRAND_CATEGORIES.includes(t?.category) ? t.category : null;
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

/** "Forget this" — removes one trait outright, explicit or not. */
export function forgetBrandTrait(preferences, { category, text }) {
  if (!BRAND_CATEGORIES.includes(category)) return preferences;
  const idx = findTraitIndex(preferences[category] || emptyCategory(), text);
  if (idx === -1) return preferences;
  const bucket = { traits: preferences[category].traits.filter((_, i) => i !== idx) };
  return { ...preferences, [category]: bucket };
}

/** "Reset Brand Brain" — clears everything Lily has learned for this shop. */
export function resetPreferences() {
  return defaultPreferences();
}

/** Only ACTIVE traits count as "the shop's brand" for prompt-building and
 * the Marketing Studio settings screen's headline chips. */
export function activeTraits(preferences, category) {
  return (preferences[category]?.traits || []).filter((t) => t.active);
}

/** A short, human-readable summary of the shop's active learned brand
 * voice — handed to Lily's content-generation prompts as extra grounding.
 * Returns "" for a brand-new shop with no learned style yet. */
export function buildBrandSummary(preferences) {
  const lines = [];
  for (const category of BRAND_CATEGORIES) {
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

const TABLE = "marketing_brand_brain";

export async function loadBrandBrain(client, shopId) {
  const { data, error } = await client.from(TABLE).select("preferences").eq("shop_id", shopId).maybeSingle();
  if (error) return { preferences: defaultPreferences(), error: error.message };
  return { preferences: normalizePreferences(data?.preferences), error: null };
}

export async function saveBrandBrain(client, shopId, preferences) {
  const { error } = await client
    .from(TABLE)
    .upsert({ shop_id: shopId, preferences, updated_at: new Date().toISOString() }, { onConflict: "shop_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
