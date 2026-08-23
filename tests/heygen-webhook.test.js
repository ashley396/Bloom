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

test("avatar_video.success for a correctly recorded job: correlates and applies the status update end to end", async () => {
  process.env.HEYGEN_WEBHOOK_SECRET = "secret";
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // event lookup: not found
    { data: { id: "event-1", status: "received" }, error: null }, // event insert
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "rendering" }, error: null }, // clone_video_jobs lookup: found, rendering
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "completed", result_url: "https://cdn.heygen.com/x.mp4" }, error: null }, // clone_video_jobs update
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
});

test("avatar_video.fail maps to a 'failed' status update", async () => {
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
  const updateCall = client.calls.find((c) => c.table === "marketing_clone_video_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.status, "failed");
});
