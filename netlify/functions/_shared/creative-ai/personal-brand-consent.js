/**
 * Personal Brand Studio — reference-photo consent (Section 5/6 of the
 * directive).
 *
 * Section 6 is explicit: permission to STORE a reference photo, permission
 * to use it for IMAGE generation, and permission to use it for AVATAR
 * generation are three separate grants, never one blanket checkbox. This
 * module is the pure validation/authorization layer for those three —
 * dimensions 4/5/6 (avatar-in-marketing, voice, publish) are NOT
 * reimplemented here; they already exist as marketing_clone_consent's
 * avatar_permission/voice_permission/approved_usage/approved_platforms
 * (see marketing-clone-consent.js), which this module explicitly reuses
 * rather than duplicates for isDigitalTwinUseAuthorized().
 *
 * A row can be revoked (revoked_at set) without being deleted — revocation
 * is a status change, not a row removal, matching the audit-trail
 * precedent marketing_clone_consent already established. Every check here
 * treats a revoked row as authorizing nothing, full stop.
 */

import { isConsentActive } from "../marketing-clone-consent.js";

export const REFERENCE_PHOTO_LABELS = Object.freeze([
  "approved_likeness_reference",
  "favorite_reference",
  "professional_reference",
  "casual_reference",
  "do_not_use"
]);

export const FEEDBACK_REASONS = Object.freeze([
  "doesnt_look_like_me",
  "face_wrong",
  "hair_wrong",
  "outfit_wrong",
  "expression_wrong",
  "too_artificial",
  "wrong_setting",
  "wrong_flowers",
  "wrong_personality",
  "too_formal",
  "too_casual",
  "love_this"
]);

/** Validates an upload/consent-grant body. Storing a photo without
 * explicitly consenting to store it is refused outright — there is no
 * "upload now, consent later" path; a florist can revoke immediately after
 * if they want the photo gone, but they must affirmatively consent to
 * store it in the first place. */
export function validateReferencePhotoConsentBody(body = {}) {
  if (!body.data_url) return { valid: false, error: "data_url is required." };
  if (body.consented_to_store !== true) {
    return { valid: false, error: "consented_to_store must be explicitly true — Florisyn never stores a reference photo without affirmative consent." };
  }
  const label = REFERENCE_PHOTO_LABELS.includes(body.label) ? body.label : "approved_likeness_reference";
  return {
    valid: true,
    sanitized: {
      label,
      consented_to_store: true,
      allow_image_generation: Boolean(body.allow_image_generation),
      allow_avatar_generation: Boolean(body.allow_avatar_generation)
    }
  };
}

/** A photo labeled "do not use" never authorizes any generation use,
 * regardless of what its boolean flags say — the label is a hard override
 * a florist can set with one click without hunting for two checkboxes. */
function photoIsUsable(photo) {
  return Boolean(photo) && !photo.revoked_at && photo.label !== "do_not_use";
}

/**
 * The single authorization check every reference-photo consumer (Photo
 * Studio composite, avatar-training kickoff) must run before touching a
 * photo. purpose: 'store' | 'image_generation' | 'avatar_generation'.
 */
export function canUsePhotoFor(photo, purpose) {
  if (purpose === "store") return Boolean(photo) && photo.consented_to_store === true && !photo.revoked_at;
  if (!photoIsUsable(photo)) return false;
  if (!photo.consented_to_store) return false; // use-permission without store-permission is meaningless/inconsistent — fail closed
  if (purpose === "image_generation") return photo.allow_image_generation === true;
  if (purpose === "avatar_generation") return photo.allow_avatar_generation === true;
  return false;
}

/**
 * Composite authorization for actually using a trained Digital Twin
 * (avatar and/or voice) in marketing — dimensions 4/5/6 of Section 6.
 * Reuses marketing_clone_consent's existing isConsentActive() and its
 * approved_usage/approved_platforms grant rather than re-deriving consent
 * rules. usage must be one of CLONE_USAGE_TYPES (marketing-clone-consent.js).
 */
export function isDigitalTwinUseAuthorized({ consentRow, usage, platform, needsAvatar = false, needsVoice = false } = {}) {
  if (!isConsentActive(consentRow)) return { authorized: false, reason: "consent_missing_or_revoked" };
  if (needsAvatar && !consentRow.avatar_permission) return { authorized: false, reason: "avatar_permission_not_granted" };
  if (needsVoice && !consentRow.voice_permission) return { authorized: false, reason: "voice_permission_not_granted" };
  if (usage && !consentRow.approved_usage?.includes(usage)) return { authorized: false, reason: "usage_not_approved" };
  if (platform && !consentRow.approved_platforms?.includes(platform)) return { authorized: false, reason: "platform_not_approved" };
  return { authorized: true, reason: null };
}
