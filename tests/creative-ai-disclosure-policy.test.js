import test from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_DISCLOSURE_POLICY,
  determineDisclosureRequirement,
  enforcePrePublishDisclosureGate,
  computeDisclosureFields
} from "../netlify/functions/_shared/creative-ai/disclosure-policy.js";

// Must match marketing-social-providers.js's SUPPORTED_PLATFORMS exactly —
// a policy silently missing for a live publish platform would mean
// determineDisclosureRequirement() throws in production for that platform.
const SUPPORTED_PLATFORMS = ["facebook", "instagram", "tiktok", "linkedin", "pinterest", "google_business", "youtube"];

test("PLATFORM_DISCLOSURE_POLICY: covers all 7 Marketing Studio platforms, no more, no less missing", () => {
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.ok(PLATFORM_DISCLOSURE_POLICY[platform], `missing policy for platform "${platform}"`);
  }
});

test("determineDisclosureRequirement: no AI flags set -> never required, regardless of platform", () => {
  for (const platform of SUPPORTED_PLATFORMS) {
    const result = determineDisclosureRequirement({ platform });
    assert.equal(result.required, false, `platform "${platform}" should not require disclosure with no AI used`);
    assert.equal(result.reason, "no_ai_used");
  }
});

test("determineDisclosureRequirement: human_edited alone (no AI) never triggers a requirement", () => {
  const result = determineDisclosureRequirement({ platform: "instagram", humanEdited: true });
  assert.equal(result.required, false);
  assert.equal(result.reason, "human_edited_only_no_ai");
});

test("determineDisclosureRequirement: avatarUsed alone requires disclosure on every platform (fail closed, conservative)", () => {
  for (const platform of SUPPORTED_PLATFORMS) {
    const result = determineDisclosureRequirement({ platform, avatarUsed: true });
    assert.equal(result.required, true, `platform "${platform}" should require disclosure for avatar content`);
    assert.ok(result.mechanism, `platform "${platform}" must carry a mechanism string`);
  }
});

test("determineDisclosureRequirement: voiceUsed alone (cloned voice, no visible avatar) still requires disclosure", () => {
  const result = determineDisclosureRequirement({ platform: "youtube", voiceUsed: true });
  assert.equal(result.required, true);
});

test("determineDisclosureRequirement: generativeVideoUsed and generativeImageUsed each independently trigger a requirement", () => {
  assert.equal(determineDisclosureRequirement({ platform: "tiktok", generativeVideoUsed: true }).required, true);
  assert.equal(determineDisclosureRequirement({ platform: "tiktok", generativeImageUsed: true }).required, true);
});

test("determineDisclosureRequirement: TikTok's policy is marked as auto-detecting, matching this pass's research finding", () => {
  const result = determineDisclosureRequirement({ platform: "tiktok", avatarUsed: true });
  assert.equal(result.autoDetects, true);
});

test("determineDisclosureRequirement: LOW-confidence platforms (Pinterest, Google Business) never claim an unverified mechanism as confirmed", () => {
  const pinterest = determineDisclosureRequirement({ platform: "pinterest", generativeImageUsed: true });
  const googleBusiness = determineDisclosureRequirement({ platform: "google_business", avatarUsed: true });
  assert.equal(pinterest.mechanism, "no_api_mechanism_confirmed");
  assert.equal(googleBusiness.mechanism, "no_api_mechanism_confirmed");
});

test("determineDisclosureRequirement: rejects an unknown platform rather than silently defaulting", () => {
  assert.throws(() => determineDisclosureRequirement({ platform: "myspace" }), /unknown platform/);
});

test("enforcePrePublishDisclosureGate: allows publishing when disclosure isn't required at all", () => {
  const result = enforcePrePublishDisclosureGate({ ai_disclosure_required: false, disclosure_applied: false });
  assert.equal(result.allowed, true);
});

test("enforcePrePublishDisclosureGate: allows publishing when disclosure is required AND has been applied", () => {
  const result = enforcePrePublishDisclosureGate({ ai_disclosure_required: true, disclosure_applied: true });
  assert.equal(result.allowed, true);
});

test("enforcePrePublishDisclosureGate: FAILS CLOSED — blocks publishing when disclosure is required but not applied", () => {
  const result = enforcePrePublishDisclosureGate({ ai_disclosure_required: true, disclosure_applied: false });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "ai_disclosure_required_but_not_applied");
});

test("enforcePrePublishDisclosureGate: treats a missing/undefined variant as safe-default (not required) rather than throwing", () => {
  const result = enforcePrePublishDisclosureGate({});
  assert.equal(result.allowed, true);
});

// ── computeDisclosureFields (Launch-blocker fix, Blocker 1) ────────────
//
// The real defect this closes: enforcePrePublishDisclosureGate() was
// always correctly fail-closed in DESIGN, but every content-attachment
// call site (generate_content, personal_brand_concept_to_content_item)
// left ai_disclosure_required at its DB default (false) unless a human
// separately called set_content_disclosure afterward — a fail-OPEN gap
// in practice. computeDisclosureFields() is the one helper every such
// call site now goes through so the gate has real data from the moment
// content is attached, not only after an optional follow-up action.

test("computeDisclosureFields: AI image (generativeImageUsed) -> required, with the platform's real mechanism, disclosure_applied untouched", () => {
  const fields = computeDisclosureFields({ platform: "instagram", generativeImageUsed: true, aiContentType: "generative_image" });
  assert.equal(fields.ai_disclosure_required, true);
  assert.equal(fields.generative_image_used, true);
  assert.equal(fields.avatar_used, false);
  assert.equal(fields.voice_used, false);
  assert.equal(fields.ai_content_type, "generative_image");
  assert.equal(fields.disclosure_method, "native_label");
  assert.ok(fields.disclosure_checked_at, "must record when this was actually checked");
  assert.ok(!("disclosure_applied" in fields), "disclosure_applied stays exclusively set_content_disclosure's job — never silently marked complete here");
});

test("computeDisclosureFields: Digital Twin (avatarUsed + voiceUsed) -> required, ai_content_type avatar_video", () => {
  const fields = computeDisclosureFields({ platform: "facebook", avatarUsed: true, voiceUsed: true, aiContentType: "avatar_video" });
  assert.equal(fields.ai_disclosure_required, true);
  assert.equal(fields.avatar_used, true);
  assert.equal(fields.voice_used, true);
});

test("computeDisclosureFields: synthetic voice alone (no visible avatar) still trips the requirement", () => {
  const fields = computeDisclosureFields({ platform: "youtube", voiceUsed: true, aiContentType: "voice_only" });
  assert.equal(fields.ai_disclosure_required, true);
  assert.equal(fields.voice_used, true);
  assert.equal(fields.avatar_used, false);
});

test("computeDisclosureFields: ordinary non-AI media (no flags) -> not required, but still explicitly checked (never left unchecked)", () => {
  const fields = computeDisclosureFields({ platform: "linkedin", aiContentType: "none" });
  assert.equal(fields.ai_disclosure_required, false);
  assert.equal(fields.ai_content_type, "none");
  assert.ok(fields.disclosure_checked_at, "a deliberate 'checked, not required' record beats a silently-unset column");
});

test("computeDisclosureFields: a platform with an uncertain/unconfirmed disclosure mechanism still fails closed on 'required'", () => {
  const pinterest = computeDisclosureFields({ platform: "pinterest", generativeImageUsed: true, aiContentType: "generative_image" });
  const googleBusiness = computeDisclosureFields({ platform: "google_business", avatarUsed: true, aiContentType: "avatar_video" });
  assert.equal(pinterest.ai_disclosure_required, true);
  assert.equal(pinterest.disclosure_method, "no_api_mechanism_confirmed");
  assert.equal(googleBusiness.ai_disclosure_required, true);
  assert.equal(googleBusiness.disclosure_method, "no_api_mechanism_confirmed");
});
