/**
 * Customer communication preferences — operational contact vs marketing consent.
 * Marketing is never silently opted in; explicit opt-in required.
 */

export const CONTACT_METHODS = Object.freeze(["phone", "text", "email", "none"]);

export const CONTACT_METHOD_LABELS = Object.freeze({
  phone: "Phone",
  text: "Text",
  email: "Email",
  none: "No preference",
});

const METHOD_SET = new Set(CONTACT_METHODS);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function normalizeContactMethod(value) {
  const raw = String(value || "none").trim().toLowerCase();
  return METHOD_SET.has(raw) ? raw : "none";
}

/**
 * Normalize contact_preferences for create/update.
 * @param {object|null|undefined} raw - Existing DB value or request body fragment
 * @param {object} [options]
 * @param {boolean} [options.isCreate=false] - New customer — marketing defaults off
 * @param {object|null} [options.previous=null] - Prior preferences for PATCH audit diffs
 */
export function normalizeContactPreferences(raw, { isCreate = false, previous = null } = {}) {
  const input = asObject(raw);
  const prev = asObject(previous);
  const preferred_method = normalizeContactMethod(
    input.preferred_method ?? input.preferredMethod ?? prev.preferred_method ?? "none",
  );

  let marketing_opt_in;
  if ("marketing_opt_in" in input || "marketingOptIn" in input) {
    marketing_opt_in = Boolean(input.marketing_opt_in ?? input.marketingOptIn);
  } else if (isCreate) {
    marketing_opt_in = false;
  } else {
    marketing_opt_in = Boolean(prev.marketing_opt_in);
  }

  const now = new Date().toISOString();
  const out = {
    preferred_method,
    marketing_opt_in,
  };

  if (marketing_opt_in && !prev.marketing_opt_in) {
    out.marketing_opt_in_at = input.marketing_opt_in_at || now;
    out.marketing_opt_out_at = null;
  } else if (!marketing_opt_in && prev.marketing_opt_in) {
    out.marketing_opt_out_at = input.marketing_opt_out_at || now;
    out.marketing_opt_in_at = prev.marketing_opt_in_at || null;
  } else {
    out.marketing_opt_in_at = prev.marketing_opt_in_at || (marketing_opt_in ? now : null);
    out.marketing_opt_out_at = prev.marketing_opt_out_at || null;
  }

  return out;
}

/** Legacy/null customers — safe read defaults without mutating stored data. */
export function resolveContactPreferences(stored) {
  if (!stored || typeof stored !== "object") {
    return normalizeContactPreferences({}, { isCreate: true });
  }
  return normalizeContactPreferences(stored, { isCreate: false, previous: stored });
}

export function contactPreferenceSummary(prefs) {
  const resolved = resolveContactPreferences(prefs);
  const method = CONTACT_METHOD_LABELS[resolved.preferred_method] || "No preference";
  const marketing = resolved.marketing_opt_in ? "Marketing opted in" : "Marketing opted out";
  return `${method} · ${marketing}`;
}

export function contactPreferenceAuditMetadata(before, after) {
  const prev = resolveContactPreferences(before);
  const next = resolveContactPreferences(after);
  const changes = {};
  if (prev.preferred_method !== next.preferred_method) {
    changes.preferred_method = { from: prev.preferred_method, to: next.preferred_method };
  }
  if (prev.marketing_opt_in !== next.marketing_opt_in) {
    changes.marketing_opt_in = { from: prev.marketing_opt_in, to: next.marketing_opt_in };
  }
  return Object.keys(changes).length ? changes : null;
}
