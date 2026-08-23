/**
 * AI Clone (Digital Twin Studio) consent validation — Section 11 of the
 * build directive. Pure validation only; the actual consent row lives in
 * marketing_clone_consent (Stage B migration) and is written/read by
 * marketing-studio.js. Kept separate and pure so the rules (what counts as
 * a valid consent grant) are unit-testable without a database.
 */

import { SUPPORTED_PLATFORMS } from "./marketing-social-providers.js";

/** Closed vocabulary on purpose — Section 11 requires consent to name
 * exactly what usage was approved, not an open-ended freeform string a
 * later prompt-injection or typo could quietly widen. */
export const CLONE_USAGE_TYPES = Object.freeze(["social_video", "website_video", "voicemail_greeting", "ads"]);

function trimStr(value, max) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function sanitizeStringArray(value, allowed, max) {
  if (!Array.isArray(value)) return { valid: true, list: [] };
  const list = [...new Set(value.map((v) => String(v || "").trim()))].filter(Boolean);
  if (list.length > max) return { valid: false, list: null };
  if (allowed && !list.every((v) => allowed.includes(v))) return { valid: false, list: null };
  return { valid: true, list };
}

/**
 * Validates a consent-grant request. Requires a named real person, at
 * least one of avatar/voice permission explicitly true, and — since a
 * "yes you can clone me" with no stated boundary is not real consent —
 * at least one approved_usage and one approved_platforms entry.
 */
export function validateCloneConsentBody(body = {}) {
  const person_name = trimStr(body.person_name, 160);
  if (!person_name) return { valid: false, error: "person_name is required." };

  const avatar_permission = Boolean(body.avatar_permission);
  const voice_permission = Boolean(body.voice_permission);
  if (!avatar_permission && !voice_permission) {
    return { valid: false, error: "At least one of avatar_permission or voice_permission must be true." };
  }

  const usage = sanitizeStringArray(body.approved_usage, CLONE_USAGE_TYPES, 10);
  if (!usage.valid) return { valid: false, error: `approved_usage must only contain: ${CLONE_USAGE_TYPES.join(", ")}.` };
  if (usage.list.length === 0) return { valid: false, error: "approved_usage must name at least one specific use." };

  const platforms = sanitizeStringArray(body.approved_platforms, SUPPORTED_PLATFORMS, 10);
  if (!platforms.valid) return { valid: false, error: `approved_platforms must only contain: ${SUPPORTED_PLATFORMS.join(", ")}.` };
  if (platforms.list.length === 0) return { valid: false, error: "approved_platforms must name at least one specific platform." };

  return {
    valid: true,
    sanitized: {
      person_name,
      avatar_permission,
      voice_permission,
      approved_usage: usage.list,
      approved_platforms: platforms.list
    }
  };
}

/** True once a consent record has been revoked — the one check every
 * caller (generation, enrollment, publish) must run before ever using an
 * avatar/voice profile tied to it. */
export function isConsentActive(consentRow) {
  return Boolean(consentRow) && !consentRow.revoked_at;
}
