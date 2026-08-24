import test from "node:test";
import assert from "node:assert/strict";
import { finalizeDigitalTwinJob, validateDigitalTwinOutput } from "../netlify/functions/_shared/creative-ai/digital-twin-finalization.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

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
    ...overrides
  };
}

// ── validateDigitalTwinOutput: pure output validation ────────────────────

test("validateDigitalTwinOutput: rejects a missing/empty result URL", () => {
  assert.equal(validateDigitalTwinOutput({}).valid, false);
  assert.equal(validateDigitalTwinOutput({ resultUrl: "" }).valid, false);
  assert.equal(validateDigitalTwinOutput({ resultUrl: "   " }).valid, false);
});

test("validateDigitalTwinOutput: rejects a non-https URL — never trust an unexpected scheme", () => {
  const result = validateDigitalTwinOutput({ resultUrl: "http://cdn.heygen.com/x.mp4" });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "result_url_not_https");
});

test("validateDigitalTwinOutput: accepts a real https URL", () => {
  assert.equal(validateDigitalTwinOutput({ resultUrl: "https://cdn.heygen.com/x.mp4" }).valid, true);
});

// ── finalizeDigitalTwinJob: idempotency, races, failure states ──────────

test("finalizeDigitalTwinJob: an unknown job (never recorded) is honestly reported, never crashes", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]); // getCloneVideoJob: not found
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-unknown", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.found, false);
  assert.equal(result.assetCreated, false);
  assert.equal(result.reason, "job_not_found");
});

test("finalizeDigitalTwinJob: a job already terminal (webhook/poll race, or a duplicate) is never re-finalized — no second asset", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob({ status: "completed", result_url: "https://cdn.heygen.com/x.mp4" }), error: null } // lookup only — already terminal, no update attempted
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.alreadyTerminal, true);
  assert.equal(result.assetCreated, false);
  assert.equal(result.reason, "already_terminal");
  assert.equal(client.calls.filter((c) => c.table === "ai_generated_assets").length, 0);
});

test("finalizeDigitalTwinJob: a genuine first-time 'failed' transition creates no asset", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob(), error: null }, // lookup: rendering
    { data: baseJob({ status: "failed", error_message: "render error" }), error: null } // update
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "failed", error: "render error" });
  assert.equal(result.alreadyTerminal, false);
  assert.equal(result.assetCreated, false);
  assert.equal(result.reason, "generation_failed");
  assert.equal(client.calls.filter((c) => c.table === "ai_generated_assets").length, 0);
});

test("finalizeDigitalTwinJob: malformed/missing output on a reported completion is refused — never trust 'completed' blindly", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob(), error: null },
    { data: baseJob({ status: "completed", result_url: null }), error: null } // provider said done, but no real URL landed
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: null });
  assert.equal(result.assetCreated, false);
  assert.match(result.reason, /^invalid_output/);
  assert.equal(client.calls.filter((c) => c.table === "ai_generated_assets").length, 0);
});

test("finalizeDigitalTwinJob: a genuine first-time completion creates one real asset, records cost once, and marks the job finalized", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob(), error: null }, // lookup
    { data: baseJob({ status: "completed", result_url: "https://cdn.heygen.com/x.mp4" }), error: null }, // update
    { data: { id: "asset-1", asset_type: "video" }, error: null }, // persistGeneratedAsset insert
    { data: null, error: null }, // marketing_generation_usage insert
    { data: { id: "job-1", resulting_asset_id: "asset-1" }, error: null } // markCloneVideoJobFinalized
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.assetCreated, true);
  assert.equal(result.asset.id, "asset-1");
  const usageInsert = client.calls.find((c) => c.table === "marketing_generation_usage");
  assert.ok(usageInsert, "must record the master-generation cost exactly once");
  const finalizeUpdate = client.calls.find((c) => c.table === "marketing_clone_video_jobs" && c.payload?.resulting_asset_id);
  assert.equal(finalizeUpdate.payload.resulting_asset_id, "asset-1");
});

// Behavior legitimately changed this pass (revoked-media hardening):
// consent revoked before finalization no longer produces a usable asset
// at ALL — see tests/digital-twin-quarantine.test.js for the full
// quarantine-path coverage this replaces.
test("finalizeDigitalTwinJob: valid consent + a target platform creates a real, review-gated content item with disclosure metadata pre-filled", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob({ consent_id: "consent-1", avatar_profile_id: "avatar-1", voice_profile_id: "voice-1", platform: "tiktok", usage: "social_video" }), error: null },
    {
      data: baseJob({
        status: "completed",
        result_url: "https://cdn.heygen.com/x.mp4",
        consent_id: "consent-1",
        avatar_profile_id: "avatar-1",
        voice_profile_id: "voice-1",
        platform: "tiktok",
        usage: "social_video",
        created_by: "u1"
      }),
      error: null
    },
    { data: { id: "consent-1", avatar_permission: true, voice_permission: true, approved_usage: ["social_video"], approved_platforms: ["tiktok"], revoked_at: null }, error: null }, // consent re-check: valid
    { data: { id: "asset-1", asset_type: "video" }, error: null }, // persistGeneratedAsset insert
    { data: { id: "asset-1", consent_id: "consent-1" }, error: null }, // ai_generated_assets.consent_id backfill
    { data: null, error: null }, // cost usage insert
    { data: { id: "item-1", content_type: "reel", title: "Digital Twin video", status: "in_review" }, error: null }, // content_items insert
    { data: { id: "variant-1", platform: "tiktok", ai_disclosure_required: true }, error: null }, // platform_variants insert
    { data: { id: "job-1", resulting_asset_id: "asset-1" }, error: null } // markCloneVideoJobFinalized
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.assetCreated, true);
  assert.ok(result.contentItem);
  assert.equal(result.contentItem.contentItem.status, "in_review", "successful generation is never itself approval to publish");
  const contentItemInsert = client.calls.find((c) => c.table === "marketing_content_items");
  assert.equal(contentItemInsert.payload.uses_ai_clone, true);
  assert.equal(contentItemInsert.payload.requires_human_approval, true);
  const variantInsert = client.calls.find((c) => c.table === "marketing_platform_variants");
  assert.equal(variantInsert.payload.avatar_used, true);
  assert.equal(variantInsert.payload.voice_used, true);
  assert.equal(variantInsert.payload.disclosure_applied, undefined, "disclosure_applied is never set true automatically — a human still has to apply it");
});

test("finalizeDigitalTwinJob: an asset-creation failure is reported honestly, never silently swallowed into a false success", async () => {
  const client = createFakeSupabaseClient([
    { data: baseJob(), error: null },
    { data: baseJob({ status: "completed", result_url: "https://cdn.heygen.com/x.mp4" }), error: null },
    { data: null, error: { message: "insert failed" } } // persistGeneratedAsset insert fails
  ]);
  const result = await finalizeDigitalTwinJob(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.assetCreated, false);
  assert.equal(result.reason, "asset_creation_failed");
  // The underlying status transition itself is still real and reported —
  // a bookkeeping failure downstream never erases that the job DID complete.
  assert.equal(result.alreadyTerminal, false);
  assert.equal(result.found, true);
});
