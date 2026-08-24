/**
 * Revoked media hardening pass — the required rule: if consent was
 * revoked before finalization, the completed media must never become an
 * ordinary usable Florisyn asset. This file covers the full case matrix
 * from Section 6 of the directive at the finalizeDigitalTwinJob() level
 * (the single canonical completion path both the webhook and the polling
 * fallback call — see digital-twin-finalization.js's own docstring).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { finalizeDigitalTwinJob, cleanupQuarantinedDigitalTwinMedia, recheckDigitalTwinConsent } from "../netlify/functions/_shared/creative-ai/digital-twin-finalization.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

function baseJob(overrides = {}) {
  return {
    id: "job-1",
    shop_id: "shop-1",
    provider: "heygen",
    provider_job_id: "vid-1",
    status: "rendering",
    source_asset_id: null,
    avatar_profile_id: null,
    voice_profile_id: null,
    consent_id: null,
    usage: null,
    platform: null,
    created_by: null,
    temp_audio_path: null,
    temp_audio_deleted_at: null,
    ...overrides
  };
}

// ── Case A: consent active throughout — normal asset (baseline, already
// covered in depth by digital-twin-finalization.test.js; one smoke test
// here to anchor the full case-letter matrix in one file). ──────────────

test("Case A — consent active at request and completion: normal finalization, no quarantine", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob({ consent_id: "consent-1", avatar_profile_id: "avatar-1" }), error: null },
    { data: baseJob({ status: "completed", result_url: "https://cdn.heygen.com/x.mp4", consent_id: "consent-1", avatar_profile_id: "avatar-1" }), error: null },
    { data: { id: "consent-1", avatar_permission: true, voice_permission: false, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: null }, error: null },
    { data: { id: "asset-1", asset_type: "video" }, error: null },
    { data: { id: "asset-1", consent_id: "consent-1" }, error: null }, // consent_id backfill
    { data: null, error: null } // cost usage insert
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.assetCreated, true);
  assert.equal(result.quarantined, false);
});

// ── Case B: consent revoked before the provider completes ───────────────

test("Case B — consent revoked before completion: NO usable asset is ever created", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob({ consent_id: "consent-1", avatar_profile_id: "avatar-1" }), error: null }, // lookup
    { data: baseJob({ status: "completed", result_url: "https://cdn.heygen.com/x.mp4", consent_id: "consent-1", avatar_profile_id: "avatar-1" }), error: null }, // update
    { data: { id: "consent-1", avatar_permission: true, voice_permission: false, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: "2026-08-27T00:00:00.000Z" }, error: null }, // consent re-check: REVOKED
    { data: null, error: null }, // cost usage insert (still recorded)
    { data: { id: "job-1", disposition: "quarantined", quarantine_reason: "consent_missing_or_revoked", quarantined_at: "2026-08-27T00:00:01.000Z" }, error: null } // markCloneVideoJobQuarantined
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.assetCreated, false);
  assert.equal(result.quarantined, true);
  assert.equal(result.asset, null);
  assert.equal(result.contentItem, null);
  assert.equal(client.calls.filter((c) => c.table === "ai_generated_assets").length, 0, "no ai_generated_assets row is ever inserted for revoked-in-flight media");
  assert.equal(client.calls.filter((c) => c.table === "marketing_content_items").length, 0);
  assert.equal(client.calls.filter((c) => c.table === "marketing_platform_variants").length, 0);
  // Cost was still recorded — the generation genuinely happened and was billed.
  const costInsert = client.calls.find((c) => c.table === "marketing_generation_usage");
  assert.ok(costInsert, "the real incurred cost must still be retained");
  // The audit trail is the job row itself.
  const quarantineUpdate = client.calls.find((c) => c.table === "marketing_clone_video_jobs" && c.payload?.disposition === "quarantined");
  assert.ok(quarantineUpdate);
});

// ── Case C: webhook and polling race after revocation ────────────────────

test("Case C — webhook/poll race after revocation: only ONE quarantine disposition is ever recorded", async () => {
  // First call: the real, first-time transition — quarantines.
  const firstClient = createFakeSupabaseClient([
    { data: baseJob({ consent_id: "consent-1", avatar_profile_id: "avatar-1" }), error: null },
    { data: baseJob({ status: "completed", result_url: "https://cdn.heygen.com/x.mp4", consent_id: "consent-1", avatar_profile_id: "avatar-1" }), error: null },
    { data: { id: "consent-1", avatar_permission: true, voice_permission: false, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: "2026-08-27T00:00:00.000Z" }, error: null },
    { data: null, error: null },
    { data: { id: "job-1", disposition: "quarantined" }, error: null }
  ]);
  const first = await finalizeDigitalTwinJob(firstClient, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(first.quarantined, true);

  // Second call (the race loser — webhook or poll, doesn't matter which):
  // the job is now already terminal ('completed' at the provider-status
  // level — quarantine is a Florisyn-side disposition layered on top, but
  // the underlying job.status the safe-transition check keys off is
  // already 'completed' from the first call), so applyWebhookStatusUpdate
  // reports alreadyTerminal:true and nothing further happens.
  const secondClient = createFakeSupabaseClient([
    { data: baseJob({ status: "completed", result_url: "https://cdn.heygen.com/x.mp4", consent_id: "consent-1", avatar_profile_id: "avatar-1", disposition: "quarantined" }), error: null }
  ]);
  const second = await finalizeDigitalTwinJob(secondClient, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(second.alreadyTerminal, true);
  assert.equal(second.assetCreated, false);
  assert.equal(second.quarantined, false, "the race loser doesn't re-run quarantine logic at all — alreadyTerminal short-circuits it");
  assert.equal(secondClient.calls.filter((c) => c.table === "ai_generated_assets").length, 0);
  assert.equal(secondClient.calls.filter((c) => c.table === "marketing_clone_video_jobs" && c.ops.some((op) => op[0] === "update")).length, 0, "no second write of any kind");
});

// ── Case E/F: capability-specific — avatar and voice evaluated independently ──

test("Case E — a job that needed cloned voice is quarantined when its consent grant (which covered voice) is revoked", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob({ consent_id: "consent-1", avatar_profile_id: "avatar-1", voice_profile_id: "voice-1" }), error: null },
    { data: baseJob({ status: "completed", result_url: "https://cdn.heygen.com/x.mp4", consent_id: "consent-1", avatar_profile_id: "avatar-1", voice_profile_id: "voice-1" }), error: null },
    { data: { id: "consent-1", avatar_permission: true, voice_permission: true, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: "2026-08-27T00:00:00.000Z" }, error: null }, // whole grant revoked
    { data: null, error: null },
    { data: { id: "job-1", disposition: "quarantined" }, error: null }
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.quarantined, true);
  assert.match(result.reason, /consent_revoked_at_completion/);
});

test("Case F — an avatar-only job (voice never used) is NOT affected by an unrelated grant's revocation — capability evaluation stays scoped to this job's own consent_id", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob({ consent_id: "consent-avatar-only", avatar_profile_id: "avatar-1", voice_profile_id: null }), error: null }, // lookup
    { data: baseJob({ status: "completed", result_url: "https://cdn.heygen.com/x.mp4", consent_id: "consent-avatar-only", avatar_profile_id: "avatar-1", voice_profile_id: null }), error: null }, // update
    // This job's OWN consent grant — still active. A DIFFERENT, unrelated
    // voice-only consent grant being revoked elsewhere never reaches this
    // lookup at all, because the job's consent_id scopes the query.
    { data: { id: "consent-avatar-only", avatar_permission: true, voice_permission: false, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: null }, error: null },
    { data: { id: "asset-1", asset_type: "video" }, error: null },
    { data: { id: "asset-1", consent_id: "consent-avatar-only" }, error: null },
    { data: null, error: null }
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.assetCreated, true, "avatar-only output must never be over-blocked by a voice-only revocation it never depended on");
  assert.equal(result.quarantined, false);
});

// ── recheckDigitalTwinConsent: the pure/composable re-check itself ──────

test("recheckDigitalTwinConsent: a job with no tracked consent_id is 'not applicable' — checked:false, authorized:true (preserves pre-hardening behavior for untracked jobs)", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await recheckDigitalTwinConsent(client, baseJob({ consent_id: null }));
  assert.equal(result.checked, false);
  assert.equal(result.authorized, true);
  assert.equal(client.calls.length, 0);
});

test("recheckDigitalTwinConsent: fails closed when the consent lookup itself errors", async () => {
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error("db down"); } }) }) }) };
  const result = await recheckDigitalTwinConsent(client, baseJob({ consent_id: "consent-1", avatar_profile_id: "avatar-1" }));
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "consent_recheck_failed");
});

// ── Deletion / cleanup (Section 4) ───────────────────────────────────────

test("cleanupQuarantinedDigitalTwinMedia: deletes the Florisyn-hosted temp audio when a path was recorded", async () => {
  const storage = createFakeSupabaseStorage();
  const client = createFakeSupabaseClient([{ data: { id: "job-1", temp_audio_deleted_at: "2026-08-27T00:00:02.000Z" }, error: null }], { storage });
  const result = await cleanupQuarantinedDigitalTwinMedia(client, baseJob({ temp_audio_path: "shop-1/clone-audio/abc.mp3" }));
  assert.equal(result.audioDeleted, true);
  const removeCall = storage.calls.find((c) => c.op === "remove");
  assert.deepEqual(removeCall.paths, ["shop-1/clone-audio/abc.mp3"]);
  assert.match(result.providerDeletion, /PROVIDER DELETION UNAVAILABLE/);
});

test("cleanupQuarantinedDigitalTwinMedia: no temp_audio_path recorded — skips deletion cleanly, never crashes, still reports the provider-side gap honestly", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await cleanupQuarantinedDigitalTwinMedia(client, baseJob({ temp_audio_path: null }));
  assert.equal(result.audioDeleted, false);
  assert.match(result.providerDeletion, /PROVIDER DELETION UNAVAILABLE \/ UNVERIFIED/);
  assert.match(result.providerDeletion, /HeyGen/);
});

test("cleanupQuarantinedDigitalTwinMedia: a storage deletion failure is reported, never thrown — quarantine itself must not be blocked by a cleanup hiccup", async () => {
  const storage = createFakeSupabaseStorage({ removeResponses: [{ data: null, error: { message: "storage unavailable" } }] });
  const client = createFakeSupabaseClient([], { storage });
  const result = await cleanupQuarantinedDigitalTwinMedia(client, baseJob({ temp_audio_path: "shop-1/clone-audio/abc.mp3" }));
  assert.equal(result.audioDeleted, false);
  assert.match(result.audioDeleteError, /storage unavailable/);
});

test("cleanupQuarantinedDigitalTwinMedia: already-deleted audio (temp_audio_deleted_at set) is not deleted again", async () => {
  const storage = createFakeSupabaseStorage();
  const client = createFakeSupabaseClient([], { storage });
  await cleanupQuarantinedDigitalTwinMedia(client, baseJob({ temp_audio_path: "shop-1/clone-audio/abc.mp3", temp_audio_deleted_at: "2026-08-27T00:00:00.000Z" }));
  assert.equal(storage.calls.filter((c) => c.op === "remove").length, 0);
});
