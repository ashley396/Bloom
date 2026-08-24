import test from "node:test";
import assert from "node:assert/strict";
import {
  REFERENCE_PHOTO_LABELS,
  FEEDBACK_REASONS,
  validateReferencePhotoConsentBody,
  canUsePhotoFor,
  isDigitalTwinUseAuthorized
} from "../netlify/functions/_shared/creative-ai/personal-brand-consent.js";

test("validateReferencePhotoConsentBody: refuses to store a photo without explicit consent — no upload-now-consent-later path", () => {
  const result = validateReferencePhotoConsentBody({ data_url: "data:image/jpeg;base64,xx", consented_to_store: false });
  assert.equal(result.valid, false);
  assert.match(result.error, /explicitly true/);
});

test("validateReferencePhotoConsentBody: requires a data_url", () => {
  const result = validateReferencePhotoConsentBody({ consented_to_store: true });
  assert.equal(result.valid, false);
});

test("validateReferencePhotoConsentBody: accepts a valid grant, use-flags default false (store-only is a real, valid state)", () => {
  const result = validateReferencePhotoConsentBody({ data_url: "data:image/jpeg;base64,xx", consented_to_store: true });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.allow_image_generation, false);
  assert.equal(result.sanitized.allow_avatar_generation, false);
  assert.equal(result.sanitized.label, "approved_likeness_reference");
});

test("validateReferencePhotoConsentBody: an unrecognized label falls back to the safe default rather than storing garbage", () => {
  const result = validateReferencePhotoConsentBody({ data_url: "x", consented_to_store: true, label: "not_a_real_label" });
  assert.equal(result.sanitized.label, "approved_likeness_reference");
});

test("REFERENCE_PHOTO_LABELS and FEEDBACK_REASONS are the exact directive vocabularies", () => {
  assert.deepEqual([...REFERENCE_PHOTO_LABELS], ["approved_likeness_reference", "favorite_reference", "professional_reference", "casual_reference", "do_not_use"]);
  assert.equal(FEEDBACK_REASONS.length, 12);
  assert.ok(FEEDBACK_REASONS.includes("doesnt_look_like_me"));
  assert.ok(FEEDBACK_REASONS.includes("love_this"));
});

// ── canUsePhotoFor: the three independent dimensions ────────────────────

function photo(overrides = {}) {
  return {
    consented_to_store: true,
    allow_image_generation: false,
    allow_avatar_generation: false,
    label: "approved_likeness_reference",
    revoked_at: null,
    ...overrides
  };
}

test("canUsePhotoFor 'store': true only when consented_to_store and not revoked", () => {
  assert.equal(canUsePhotoFor(photo(), "store"), true);
  assert.equal(canUsePhotoFor(photo({ consented_to_store: false }), "store"), false);
  assert.equal(canUsePhotoFor(photo({ revoked_at: "2026-01-01T00:00:00Z" }), "store"), false);
});

test("canUsePhotoFor 'image_generation' and 'avatar_generation' are independent — one true does not imply the other", () => {
  const imageOnly = photo({ allow_image_generation: true, allow_avatar_generation: false });
  assert.equal(canUsePhotoFor(imageOnly, "image_generation"), true);
  assert.equal(canUsePhotoFor(imageOnly, "avatar_generation"), false);

  const avatarOnly = photo({ allow_image_generation: false, allow_avatar_generation: true });
  assert.equal(canUsePhotoFor(avatarOnly, "image_generation"), false);
  assert.equal(canUsePhotoFor(avatarOnly, "avatar_generation"), true);
});

test("canUsePhotoFor: a photo labeled 'do_not_use' authorizes no generation use even if both flags are true", () => {
  const p = photo({ allow_image_generation: true, allow_avatar_generation: true, label: "do_not_use" });
  assert.equal(canUsePhotoFor(p, "image_generation"), false);
  assert.equal(canUsePhotoFor(p, "avatar_generation"), false);
  // Storage itself is still whatever consented_to_store says — "do not
  // use" doesn't force deletion, it just blocks generation use.
  assert.equal(canUsePhotoFor(p, "store"), true);
});

test("canUsePhotoFor: revocation blocks every use dimension, not just storage", () => {
  const p = photo({ allow_image_generation: true, allow_avatar_generation: true, revoked_at: "2026-01-01T00:00:00Z" });
  assert.equal(canUsePhotoFor(p, "image_generation"), false);
  assert.equal(canUsePhotoFor(p, "avatar_generation"), false);
});

test("canUsePhotoFor: a use-flag true but consented_to_store false is fail-closed (inconsistent state never authorizes)", () => {
  const p = photo({ consented_to_store: false, allow_image_generation: true });
  assert.equal(canUsePhotoFor(p, "image_generation"), false);
});

// ── isDigitalTwinUseAuthorized: reuses marketing_clone_consent, not a duplicate ──

function consentRow(overrides = {}) {
  return {
    avatar_permission: true,
    voice_permission: true,
    approved_usage: ["social_video"],
    approved_platforms: ["instagram", "facebook"],
    revoked_at: null,
    ...overrides
  };
}

test("isDigitalTwinUseAuthorized: authorized when consent is active and every requested dimension is granted", () => {
  const result = isDigitalTwinUseAuthorized({ consentRow: consentRow(), usage: "social_video", platform: "instagram", needsAvatar: true, needsVoice: true });
  assert.equal(result.authorized, true);
});

test("isDigitalTwinUseAuthorized: a revoked consent row authorizes nothing regardless of its stored flags", () => {
  const result = isDigitalTwinUseAuthorized({ consentRow: consentRow({ revoked_at: "2026-01-01T00:00:00Z" }), usage: "social_video", platform: "instagram", needsAvatar: true });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "consent_missing_or_revoked");
});

test("isDigitalTwinUseAuthorized: avatar and voice permission are checked independently", () => {
  const voiceOnly = consentRow({ avatar_permission: false });
  const result = isDigitalTwinUseAuthorized({ consentRow: voiceOnly, needsAvatar: true });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "avatar_permission_not_granted");
});

test("isDigitalTwinUseAuthorized: an unapproved platform is refused even with valid avatar/voice permission", () => {
  const result = isDigitalTwinUseAuthorized({ consentRow: consentRow(), platform: "tiktok" });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "platform_not_approved");
});

test("isDigitalTwinUseAuthorized: an unapproved usage is refused", () => {
  const result = isDigitalTwinUseAuthorized({ consentRow: consentRow(), usage: "ads" });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "usage_not_approved");
});

test("isDigitalTwinUseAuthorized: no consent row at all is refused, not treated as implicitly authorized", () => {
  const result = isDigitalTwinUseAuthorized({ consentRow: null });
  assert.equal(result.authorized, false);
});
