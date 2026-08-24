import test from "node:test";
import assert from "node:assert/strict";
import { handleHeygenWebhook } from "../netlify/functions/heygen-webhook.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
});
test.afterEach(() => {
  process.env = { ...savedEnv };
});

function makeEvent(bodyObj, { method = "POST" } = {}) {
  const body = JSON.stringify(bodyObj);
  return {
    httpMethod: method,
    headers: { "heygen-signature": "irrelevant-because-verify-is-mocked", "heygen-timestamp": "123" },
    body,
    isBase64Encoded: false
  };
}

const alwaysValid = () => ({ valid: true });
const alwaysInvalid = () => ({ valid: false, reason: "signature_mismatch" });

test("rejects non-POST methods", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const res = await handleHeygenWebhook(makeEvent({}, { method: "GET" }));
  assert.equal(res.statusCode, 405);
});

test("NOT LIVE — PROVIDER CONFIGURATION REQUIRED: returns 503 without touching the database when no webhook secret is configured", async () => {
  delete process.env.HEYGEN_WEBHOOK_SECRET;
  const client = createFakeSupabaseClient([]);
  const res = await handleHeygenWebhook(makeEvent({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } }), {
    admin: () => client
  });
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error, /NOT LIVE/);
  assert.equal(client.calls.length, 0, "must never touch the database when not configured");
});

test("invalid signature: recorded for audit, then rejected with 401, never applies a status update", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // event existence lookup
    { data: { id: "event-1", status: "rejected" }, error: null } // event insert
  ]);
  const res = await handleHeygenWebhook(makeEvent({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } }), {
    admin: () => client,
    verifyHeygenWebhookSignature: alwaysInvalid
  });
  assert.equal(res.statusCode, 401);
  const insertCall = client.calls.find((c) => c.ops.some((op) => op[0] === "insert"));
  assert.equal(insertCall.payload.signature_valid, false);
  // No update to marketing_clone_video_jobs was ever attempted.
  assert.equal(client.calls.filter((c) => c.table === "marketing_clone_video_jobs").length, 0);
});

test("duplicate delivery: acknowledged 200, no job-status update attempted a second time", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: { id: "event-1", status: "processed" }, error: null } // event existence lookup: FOUND (duplicate)
  ]);
  const res = await handleHeygenWebhook(makeEvent({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } }), {
    admin: () => client,
    verifyHeygenWebhookSignature: alwaysValid
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).duplicate, true);
  assert.equal(client.calls.filter((c) => c.table === "marketing_clone_video_jobs").length, 0);
});

test("malformed JSON body: recorded, then rejected with 400", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // event existence lookup (idempotency key built from "unknown" job id)
    { data: { id: "event-1", status: "received" }, error: null }, // event insert
    { data: { id: "event-1", status: "failed" }, error: null } // markWebhookEventProcessed
  ]);
  const event = {
    httpMethod: "POST",
    headers: { "heygen-signature": "x", "heygen-timestamp": "123" },
    body: "{not valid json",
    isBase64Encoded: false
  };
  const res = await handleHeygenWebhook(event, { admin: () => client, verifyHeygenWebhookSignature: alwaysValid });
  assert.equal(res.statusCode, 400);
});

test("unrecognized event type: acknowledged 200, marked processed, no job-status update attempted", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // event lookup
    { data: { id: "event-1", status: "received" }, error: null }, // event insert
    { data: { id: "event-1", status: "processed" }, error: null } // markWebhookEventProcessed
  ]);
  const res = await handleHeygenWebhook(
    makeEvent({ event_type: "avatar_video.processing", event_data: { video_id: "vid-1" } }),
    { admin: () => client, verifyHeygenWebhookSignature: alwaysValid }
  );
  assert.equal(res.statusCode, 200);
  assert.match(JSON.parse(res.body).note, /not handled/);
});

test("avatar_video.success for a job Florisyn never recorded: acknowledged, correlated:false, never crashes", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // event lookup
    { data: { id: "event-1", status: "received" }, error: null }, // event insert
    { data: null, error: null }, // clone_video_jobs lookup by provider_job_id: not found
    { data: { id: "event-1", status: "processed" }, error: null } // markWebhookEventProcessed
  ]);
  const res = await handleHeygenWebhook(
    makeEvent({ event_type: "avatar_video.success", event_data: { video_id: "vid-orphan", url: "https://cdn.heygen.com/x.mp4" } }),
    { admin: () => client, verifyHeygenWebhookSignature: alwaysValid }
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.correlated, false);
});

// Behavior legitimately changed this pass (Digital Twin result lifecycle,
// 20260826000000): a completed webhook now runs through
// finalizeDigitalTwinJob(), which — on the one real, first-time
// transition to 'completed' — also persists a real ai_generated_assets
// row, records the master-generation cost once, and marks the job
// finalized. The response queue below reflects every one of those real
// calls, in the exact order finalizeDigitalTwinJob makes them.
test("avatar_video.success for a correctly recorded job: correlates, applies the status update, AND creates a real finished asset", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // event lookup: not found
    { data: { id: "event-1", status: "received" }, error: null }, // event insert
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "rendering", source_asset_id: null, consent_id: null, platform: null }, error: null }, // clone_video_jobs lookup: found, rendering
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "completed", result_url: "https://cdn.heygen.com/x.mp4", source_asset_id: null, avatar_profile_id: null, voice_profile_id: null, consent_id: null, usage: null, platform: null, created_by: null }, error: null }, // clone_video_jobs update (applyWebhookStatusUpdate)
    { data: { id: "asset-1", asset_type: "video" }, error: null }, // persistGeneratedAsset insert
    { data: null, error: null }, // marketing_generation_usage insert (master-generation cost, recorded once)
    { data: { id: "job-1", resulting_asset_id: "asset-1", finalized_at: "2026-08-26T00:00:00.000Z" }, error: null }, // markCloneVideoJobFinalized update
    { data: { id: "event-1", status: "processed" }, error: null } // markWebhookEventProcessed
  ]);
  const res = await handleHeygenWebhook(
    makeEvent({ event_type: "avatar_video.success", event_data: { video_id: "vid-1", url: "https://cdn.heygen.com/x.mp4" } }),
    { admin: () => client, verifyHeygenWebhookSignature: alwaysValid }
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.correlated, true);
  assert.equal(body.alreadyTerminal, false);
  assert.equal(body.assetCreated, true);
  assert.equal(body.assetId, "asset-1");

  const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(assetInsert.payload.asset_type, "video");
  assert.equal(assetInsert.payload.parent_asset_id, null, "no source_asset_id on this job -> no parent link, never fabricated");
  assert.equal(assetInsert.payload.content.video_url, "https://cdn.heygen.com/x.mp4");

  const costInsert = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(costInsert.payload.purpose, "avatar_video");

  const finalizedUpdate = client.calls.find((c) => c.table === "marketing_clone_video_jobs" && c.ops.some((op) => op[0] === "update") && c.payload.resulting_asset_id);
  assert.equal(finalizedUpdate.payload.resulting_asset_id, "asset-1");
});

test("avatar_video.success for a job that already has a source Personal Brand concept: the video asset links back via parent_asset_id", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: null, error: null },
    { data: { id: "event-1", status: "received" }, error: null },
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "rendering", source_asset_id: "concept-1", consent_id: null, platform: null }, error: null },
    {
      data: {
        id: "job-1",
        shop_id: "shop-1",
        provider: "heygen",
        provider_job_id: "vid-1",
        status: "completed",
        result_url: "https://cdn.heygen.com/x.mp4",
        source_asset_id: "concept-1",
        avatar_profile_id: "avatar-1",
        voice_profile_id: "voice-1",
        consent_id: null,
        usage: null,
        platform: null,
        created_by: "u1"
      },
      error: null
    },
    { data: { id: "asset-2", asset_type: "video" }, error: null }, // persistGeneratedAsset insert
    { data: null, error: null }, // cost usage insert
    { data: { id: "job-1", resulting_asset_id: "asset-2" }, error: null }, // markCloneVideoJobFinalized
    { data: { id: "event-1", status: "processed" }, error: null } // markWebhookEventProcessed
  ]);
  const res = await handleHeygenWebhook(
    makeEvent({ event_type: "avatar_video.success", event_data: { video_id: "vid-1", url: "https://cdn.heygen.com/x.mp4" } }),
    { admin: () => client, verifyHeygenWebhookSignature: alwaysValid }
  );
  assert.equal(res.statusCode, 200);
  const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(assetInsert.payload.parent_asset_id, "concept-1", "must link back to the founder concept that requested this render");
  assert.equal(assetInsert.payload.content.avatar_profile_id, "avatar-1");
  assert.equal(assetInsert.payload.content.voice_profile_id, "voice-1");
});

test("avatar_video.fail maps to a 'failed' status update and creates NO asset", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: null, error: null },
    { data: { id: "event-1", status: "received" }, error: null },
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "rendering" }, error: null },
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "failed" }, error: null },
    { data: { id: "event-1", status: "processed" }, error: null }
  ]);
  const res = await handleHeygenWebhook(
    makeEvent({ event_type: "avatar_video.fail", event_data: { video_id: "vid-1", error: "render failed" } }),
    { admin: () => client, verifyHeygenWebhookSignature: alwaysValid }
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.assetCreated, false);
  assert.equal(body.assetId, null);
  const updateCall = client.calls.find((c) => c.table === "marketing_clone_video_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.status, "failed");
  assert.equal(client.calls.filter((c) => c.table === "ai_generated_assets").length, 0, "a failed generation must never produce an asset");
});

test("a duplicate webhook for an already-completed job never creates a second asset (idempotent finalization)", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // event lookup: not found (different delivery, same underlying job)
    { data: { id: "event-2", status: "received" }, error: null }, // event insert
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "completed", result_url: "https://cdn.heygen.com/x.mp4" }, error: null }, // job lookup: ALREADY terminal
    { data: { id: "event-2", status: "processed" }, error: null } // markWebhookEventProcessed
  ]);
  const res = await handleHeygenWebhook(
    makeEvent({ event_type: "avatar_video.success", event_data: { video_id: "vid-1", url: "https://cdn.heygen.com/x.mp4" } }),
    { admin: () => client, verifyHeygenWebhookSignature: alwaysValid }
  );
  const body = JSON.parse(res.body);
  assert.equal(body.alreadyTerminal, true);
  assert.equal(body.assetCreated, false);
  assert.equal(client.calls.filter((c) => c.table === "ai_generated_assets").length, 0);
});
