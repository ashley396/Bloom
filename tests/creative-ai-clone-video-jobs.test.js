import test from "node:test";
import assert from "node:assert/strict";
import { recordCloneVideoJob, getCloneVideoJob, applyWebhookStatusUpdate } from "../netlify/functions/_shared/creative-ai/clone-video-jobs.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

test("recordCloneVideoJob: requires shopId, provider, and providerJobId", async () => {
  const client = createFakeSupabaseClient([]);
  await assert.rejects(() => recordCloneVideoJob(client, { provider: "heygen", providerJobId: "vid-1" }), /shopId/);
  await assert.rejects(() => recordCloneVideoJob(client, { shopId: "shop-1", providerJobId: "vid-1" }), /provider/);
  await assert.rejects(() => recordCloneVideoJob(client, { shopId: "shop-1", provider: "heygen" }), /providerJobId/);
});

test("recordCloneVideoJob: inserts a real job row in the 'rendering' state", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "rendering" }, error: null }
  ]);
  const result = await recordCloneVideoJob(client, { shopId: "shop-1", provider: "heygen", providerJobId: "vid-1", source: "preview" });
  assert.equal(result.status, "rendering");
  const insertCall = client.calls.find((c) => c.ops.some((op) => op[0] === "insert"));
  assert.equal(insertCall.payload.shop_id, "shop-1");
  assert.equal(insertCall.payload.status, "rendering");
});

test("getCloneVideoJob: returns null when no matching job exists, never throws", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await getCloneVideoJob(client, { provider: "heygen", providerJobId: "unknown-vid" });
  assert.equal(result, null);
});

test("applyWebhookStatusUpdate: a job not found in Florisyn's records returns found:false without throwing", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await applyWebhookStatusUpdate(client, { provider: "heygen", providerJobId: "unknown-vid", status: "completed" });
  assert.equal(result.found, false);
  assert.equal(result.alreadyTerminal, false);
});

test("applyWebhookStatusUpdate: a rendering job transitions to completed with the result URL", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "rendering" }, error: null }, // lookup
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "completed", result_url: "https://cdn.heygen.com/x.mp4" }, error: null } // update
  ]);
  const result = await applyWebhookStatusUpdate(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/x.mp4" });
  assert.equal(result.found, true);
  assert.equal(result.alreadyTerminal, false);
  assert.equal(result.job.status, "completed");
  assert.equal(result.job.result_url, "https://cdn.heygen.com/x.mp4");
});

test("applyWebhookStatusUpdate: SAFE STATUS TRANSITION — a job already 'completed' is never regressed by a later/duplicate event", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "completed", result_url: "https://cdn.heygen.com/x.mp4" }, error: null } // lookup only
  ]);
  const result = await applyWebhookStatusUpdate(client, { provider: "heygen", providerJobId: "vid-1", status: "failed", error: "a stale/out-of-order event" });
  assert.equal(result.found, true);
  assert.equal(result.alreadyTerminal, true);
  assert.equal(result.job.status, "completed", "must not have been overwritten to 'failed'");
  // No update call was made — only the lookup response was consumed.
  assert.equal(client.calls.filter((c) => c.ops.some((op) => op[0] === "update")).length, 0);
});

test("applyWebhookStatusUpdate: a job already 'failed' is equally protected from being regressed", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "failed", error_message: "original failure" }, error: null }
  ]);
  const result = await applyWebhookStatusUpdate(client, { provider: "heygen", providerJobId: "vid-1", status: "completed", resultUrl: "https://cdn.heygen.com/late.mp4" });
  assert.equal(result.alreadyTerminal, true);
  assert.equal(result.job.status, "failed");
});
