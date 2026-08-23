import test from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_DISCLOSURE_POLICY,
  determineDisclosureRequirement,
  enforcePrePublishDisclosureGate
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
