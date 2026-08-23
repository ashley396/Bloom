import test from "node:test";
import assert from "node:assert/strict";
import { validateCloneConsentBody, isConsentActive, CLONE_USAGE_TYPES } from "../netlify/functions/_shared/marketing-clone-consent.js";

const VALID = {
  person_name: "Ashley Rivera",
  avatar_permission: true,
  approved_usage: ["social_video"],
  approved_platforms: ["instagram", "facebook"]
};

test("validateCloneConsentBody accepts a well-formed grant", () => {
  const result = validateCloneConsentBody(VALID);
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.person_name, "Ashley Rivera");
  assert.equal(result.sanitized.avatar_permission, true);
  assert.equal(result.sanitized.voice_permission, false);
});

test("validateCloneConsentBody rejects a missing person_name", () => {
  const result = validateCloneConsentBody({ ...VALID, person_name: "" });
  assert.equal(result.valid, false);
});

test("validateCloneConsentBody rejects a grant with neither avatar_permission nor voice_permission set", () => {
  const result = validateCloneConsentBody({ ...VALID, avatar_permission: false, voice_permission: false });
  assert.equal(result.valid, false);
  assert.match(result.error, /avatar_permission or voice_permission/);
});

test("validateCloneConsentBody accepts voice_permission alone, without avatar_permission", () => {
  const result = validateCloneConsentBody({ ...VALID, avatar_permission: false, voice_permission: true });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.voice_permission, true);
});

test("validateCloneConsentBody rejects an approved_usage value outside the closed vocabulary — never a freeform open string", () => {
  const result = validateCloneConsentBody({ ...VALID, approved_usage: ["do_anything_you_want"] });
  assert.equal(result.valid, false);
});

test("validateCloneConsentBody requires at least one approved_usage entry — a blank approval is not real consent", () => {
  const result = validateCloneConsentBody({ ...VALID, approved_usage: [] });
  assert.equal(result.valid, false);
});

test("validateCloneConsentBody rejects an approved_platforms value outside the 7 supported platforms", () => {
  const result = validateCloneConsentBody({ ...VALID, approved_platforms: ["myspace"] });
  assert.equal(result.valid, false);
});

test("validateCloneConsentBody requires at least one approved_platforms entry", () => {
  const result = validateCloneConsentBody({ ...VALID, approved_platforms: [] });
  assert.equal(result.valid, false);
});

test("validateCloneConsentBody de-duplicates repeated usage/platform entries", () => {
  const result = validateCloneConsentBody({ ...VALID, approved_usage: ["social_video", "social_video"], approved_platforms: ["facebook", "facebook", "instagram"] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.sanitized.approved_usage, ["social_video"]);
  assert.deepEqual(result.sanitized.approved_platforms, ["facebook", "instagram"]);
});

test("CLONE_USAGE_TYPES is a small, closed, real vocabulary", () => {
  assert.ok(CLONE_USAGE_TYPES.length > 0);
  assert.ok(CLONE_USAGE_TYPES.every((t) => typeof t === "string" && t.length > 0));
});

test("isConsentActive: a consent row with no revoked_at is active", () => {
  assert.equal(isConsentActive({ revoked_at: null }), true);
});

test("isConsentActive: a consent row with a revoked_at is NOT active", () => {
  assert.equal(isConsentActive({ revoked_at: "2026-01-01T00:00:00Z" }), false);
});

test("isConsentActive: a missing consent row is never treated as active", () => {
  assert.equal(isConsentActive(null), false);
  assert.equal(isConsentActive(undefined), false);
});
