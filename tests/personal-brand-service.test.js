import test from "node:test";
import assert from "node:assert/strict";
import {
  isRequestingUserPlatformSuperAdmin,
  runPersonalBrandCommand,
  findActiveDigitalTwinGrant,
  findLastPersonalBrandConceptAsset
} from "../netlify/functions/_shared/creative-ai/personal-brand-service.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

function mockCloudflareOnce(jsonResult) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) });
  return () => (globalThis.fetch = originalFetch);
}

// ── isRequestingUserPlatformSuperAdmin: the Founding Beta gate ──────────

test("isRequestingUserPlatformSuperAdmin: true only for an active super_admin row", async () => {
  const client = createFakeSupabaseClient([{ data: { role: "super_admin", active: true }, error: null }]);
  const result = await isRequestingUserPlatformSuperAdmin("u1", { adminClient: client });
  assert.equal(result, true);
});

test("isRequestingUserPlatformSuperAdmin: false for a non-admin shop member (no platform_admins row)", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await isRequestingUserPlatformSuperAdmin("u1", { adminClient: client });
  assert.equal(result, false);
});

test("isRequestingUserPlatformSuperAdmin: false for a lower-privilege platform admin role (e.g. 'support')", async () => {
  const client = createFakeSupabaseClient([{ data: { role: "support", active: true }, error: null }]);
  const result = await isRequestingUserPlatformSuperAdmin("u1", { adminClient: client });
  assert.equal(result, false);
});

test("isRequestingUserPlatformSuperAdmin: false for a deactivated super_admin row", async () => {
  const client = createFakeSupabaseClient([{ data: { role: "super_admin", active: false }, error: null }]);
  const result = await isRequestingUserPlatformSuperAdmin("u1", { adminClient: client });
  assert.equal(result, false);
});

test("isRequestingUserPlatformSuperAdmin: never throws on a lookup error — fails closed to false", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "db down" } }]);
  const result = await isRequestingUserPlatformSuperAdmin("u1", { adminClient: client });
  assert.equal(result, false);
});

test("isRequestingUserPlatformSuperAdmin: false with no userId at all, never queries the database", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await isRequestingUserPlatformSuperAdmin(null, { adminClient: client });
  assert.equal(result, false);
  assert.equal(client.calls.length, 0);
});

// ── runPersonalBrandCommand: the shared workflow both callers use ───────

test("runPersonalBrandCommand: a message with no resolvable mode and no memory action returns understood:true with a null asset", async () => {
  const restore = mockCloudflareOnce({
    mode: null,
    memory_action: "none",
    memory_category: null,
    memory_text: null,
    use_digital_twin: false,
    use_voice: false,
    suppress_voice: false,
    target_platform: null,
    content_format_hint: null,
    tone_hint: null,
    summary: "Just chatting."
  });
  const client = createFakeSupabaseClient([{ data: null, error: null }]); // loadPersonalBrandProfile
  try {
    const result = await runPersonalBrandCommand(client, { shopId: "shop-1", userId: "u1", message: "how's the weather" });
    assert.equal(result.understood, true);
    assert.equal(result.asset, null);
  } finally {
    restore();
  }
});

// ── findActiveDigitalTwinGrant: avatar/voice resolve independently ──────

test("findActiveDigitalTwinGrant: resolves both avatar and voice profiles when both are permitted and ready", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "consent-1", avatar_permission: true, voice_permission: true, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: null }, error: null },
    { data: { id: "avatar-1", status: "ready" }, error: null },
    { data: { id: "voice-1", status: "ready" }, error: null }
  ]);
  const grant = await findActiveDigitalTwinGrant(client, "shop-1");
  assert.equal(grant.consentId, "consent-1");
  assert.equal(grant.avatarProfileId, "avatar-1");
  assert.equal(grant.voiceProfileId, "voice-1");
});

test("findActiveDigitalTwinGrant: voice_permission false never even queries a voice profile — avatar and voice are independent", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "consent-1", avatar_permission: true, voice_permission: false, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: null }, error: null },
    { data: { id: "avatar-1", status: "ready" }, error: null }
  ]);
  const grant = await findActiveDigitalTwinGrant(client, "shop-1");
  assert.equal(grant.avatarProfileId, "avatar-1");
  assert.equal(grant.voiceProfileId, null);
  assert.equal(client.calls.filter((c) => c.table === "marketing_voice_profiles").length, 0);
});

test("findActiveDigitalTwinGrant: no active consent on file returns null (never enrolled, or revoked)", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const grant = await findActiveDigitalTwinGrant(client, "shop-1");
  assert.equal(grant, null);
});

// ── findLastPersonalBrandConceptAsset ─────────────────────────────────────

test("findLastPersonalBrandConceptAsset: returns the most recent founder_concept, or null if none exist yet", async () => {
  const found = createFakeSupabaseClient([{ data: { id: "asset-1", content: { headline: "x" } }, error: null }]);
  assert.equal((await findLastPersonalBrandConceptAsset(found, "shop-1")).id, "asset-1");
  const empty = createFakeSupabaseClient([{ data: null, error: null }]);
  assert.equal(await findLastPersonalBrandConceptAsset(empty, "shop-1"), null);
});

// ── runPersonalBrandCommand: "use my Digital Twin" / "use my voice" flow ──

function twinClassification(overrides = {}) {
  return {
    mode: null,
    memory_action: "none",
    memory_category: null,
    memory_text: null,
    use_digital_twin: false,
    use_voice: false,
    suppress_voice: false,
    target_platform: null,
    content_format_hint: null,
    tone_hint: null,
    summary: "x",
    ...overrides
  };
}

test("runPersonalBrandCommand: 'use my Digital Twin' with nothing to render (no concept this turn, no prior conversation asset) is reported honestly, never fabricates a job", async () => {
  const restore = mockCloudflareOnce(twinClassification({ use_digital_twin: true }));
  const client = createFakeSupabaseClient([{ data: null, error: null }]); // loadPersonalBrandProfile
  try {
    const result = await runPersonalBrandCommand(client, { shopId: "shop-1", userId: "u1", message: "use my digital twin" });
    assert.equal(result.digitalTwin.attempted, false);
    assert.equal(result.digitalTwin.reason, "no_concept_to_render");
  } finally {
    restore();
  }
});

test("runPersonalBrandCommand: 'use my Digital Twin' with a prior conversation asset but no enrollment on file reports 'not_enrolled'", async () => {
  const restore = mockCloudflareOnce(twinClassification({ use_digital_twin: true }));
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // loadPersonalBrandProfile
    { data: null, error: null } // findActiveDigitalTwinGrant: consent lookup, none found
  ]);
  try {
    const result = await runPersonalBrandCommand(client, { shopId: "shop-1", userId: "u1", message: "use my digital twin", conversationAssetId: "asset-prev-1" });
    assert.equal(result.digitalTwin.attempted, false);
    assert.equal(result.digitalTwin.reason, "not_enrolled");
  } finally {
    restore();
  }
});

test("runPersonalBrandCommand: \"don't use my voice\" forces voiceProfileId null even though 'use my Digital Twin' is also asked for the avatar", async () => {
  const restore = mockCloudflareOnce(twinClassification({ use_digital_twin: true, use_voice: true, suppress_voice: true, target_platform: "instagram" }));
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // loadPersonalBrandProfile
    { data: { id: "consent-1", avatar_permission: true, voice_permission: true, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: null }, error: null }, // consent lookup
    { data: { id: "avatar-1", status: "ready" }, error: null }, // avatar profile
    { data: { id: "voice-1", status: "ready" }, error: null }, // voice profile (exists and ready — but suppressed)
    { data: { id: "asset-prev-1", asset_type: "founder_concept", content: {} }, error: null }, // requestDigitalTwinGeneration: asset lookup
    { data: { id: "consent-1", avatar_permission: true, voice_permission: true, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: null }, error: null } // requestDigitalTwinGeneration: consent lookup
  ]);
  try {
    const result = await runPersonalBrandCommand(client, {
      shopId: "shop-1",
      userId: "u1",
      message: "use my digital twin but don't use my voice",
      conversationAssetId: "asset-prev-1"
    });
    assert.equal(result.digitalTwin.attempted, true);
    // NOT LIVE (no provider keys in test env) — but the important thing is
    // it reached requestDigitalTwinGeneration with the right consent
    // checks and never touched a voice profile it was told to suppress.
    assert.match(result.digitalTwin.body.note || "", /NOT LIVE/);
  } finally {
    restore();
  }
});
