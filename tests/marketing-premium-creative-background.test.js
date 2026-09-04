import test from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";
import { createMarketingPremiumCreativeBackgroundHandler } from "../netlify/functions/marketing-premium-creative-background.js";
import { PREMIUM_JOB_TYPE } from "../netlify/functions/_shared/marketing-premium-creative-job.js";

// Hybrid Marketing Studio Batch 4, Part D — the real Background Function
// that does the SLOW part (the actual OpenAI call) out of band. Every
// test here injects a fake provider execution (never touches OpenAI) and
// a fake Supabase client (never touches a real database).

function baseEvent(body, headers = {}) {
  return { httpMethod: "POST", headers: { "x-premium-job-secret": "s3cret", ...headers }, body: JSON.stringify(body) };
}

function withSecret(fn) {
  const original = process.env.MARKETING_PREMIUM_JOB_SECRET;
  process.env.MARKETING_PREMIUM_JOB_SECRET = "s3cret";
  return fn().finally(() => {
    if (original === undefined) delete process.env.MARKETING_PREMIUM_JOB_SECRET;
    else process.env.MARKETING_PREMIUM_JOB_SECRET = original;
  });
}

const plannedJob = {
  id: "job-1",
  shop_id: "shop-1",
  job_type: PREMIUM_JOB_TYPE,
  created_by: "user-1",
  status: "planned",
  plan: [{ id: "attempt-0", attempt_index: 0, usage_id: "usage-1", status: "planned" }],
  result: {
    content_item_id: "item-1",
    trace_id: "trace-1",
    canonical_concept: { assetType: "flyer" },
    creative_direction: { mood: "cheerful" },
    fact_safe_copy_plan: { headline: "H", body: "B", cta: "C" },
    verified_shop_brand_data: { name: "Test Florals" },
    aspect_ratio: "1:1",
    quality_tier: "medium",
    flyer_asset_context: { on_image_headline: "H", on_image_body: "B", on_image_cta: "C", caption: "Cap", primary_platform: "facebook", occasion_title: "Everyday" }
  }
};

test("Part D: rejects an invocation without the correct shared secret — fails closed, never processes an unauthenticated job", async () => {
  await withSecret(async () => {
    const client = createFakeSupabaseClient([]);
    const handler = createMarketingPremiumCreativeBackgroundHandler({ getClient: () => client });
    const res = await handler(baseEvent({ jobId: "job-1" }, { "x-premium-job-secret": "wrong" }));
    assert.equal(res.statusCode, 401);
    assert.deepEqual(client.calls, [], "must never touch the database for an unauthenticated request");
  });
});

test("Part D idempotency: a job that's already claimed (planned->running found zero rows) is skipped quietly — never a second provider call", async () => {
  await withSecret(async () => {
    const client = createFakeSupabaseClient([{ data: [], error: null }]); // claim finds 0 rows
    let executeCalled = false;
    const handler = createMarketingPremiumCreativeBackgroundHandler({
      getClient: () => client,
      executeReservedPremiumCreativeGeneration: async () => {
        executeCalled = true;
        return { ok: true };
      }
    });
    const res = await handler(baseEvent({ jobId: "job-1" }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.skipped, true);
    assert.equal(executeCalled, false, "the provider must never be called for a job this invocation didn't win the claim on");
  });
});

test("Part D/E success path: claims the job, marks durable pre/post markers, persists the real asset, and settles the job completed", async () => {
  await withSecret(async () => {
    const markerCalls = [];
    // Exact real call order the handler drives: claim -> [markStarting:
    // read+update] -> [markFinished: read+update] -> content item lookup
    // -> shop row -> variants -> variant update -> final item update ->
    // [settleCompleted: read+update]. The marker read responses MUST
    // carry a non-empty `plan` (matching plannedJob's own real shape) or
    // markPremiumAttemptProviderStarting/Finished short-circuit before
    // ever writing — see marketing-premium-creative-job.js's own guard.
    const client = createFakeSupabaseClient([
      { data: [{ ...plannedJob, status: "running" }], error: null }, // claim
      { data: { plan: plannedJob.plan }, error: null }, // markStarting read
      { data: { id: "job-1" }, error: null }, // markStarting update
      { data: { plan: plannedJob.plan }, error: null }, // markFinished read
      { data: { id: "job-1" }, error: null }, // markFinished update
      { data: { id: "item-1", title: "Everyday" }, error: null }, // content item lookup
      { data: { name: "Test Florals", phone: "555-0100", primary_color: "#fff", accent_color: "#000", city: "Springfield", state: "IL" }, error: null }, // shop row
      { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
      { data: null, error: null }, // variant update
      { data: [{ id: "item-1", status: "draft" }], error: null }, // final content item update
      { data: { plan: plannedJob.plan, result: plannedJob.result }, error: null }, // settleCompleted read
      { data: { id: "job-1", status: "completed" }, error: null } // settleCompleted update
    ]);
    const handler = createMarketingPremiumCreativeBackgroundHandler({
      getClient: () => client,
      executeReservedPremiumCreativeGeneration: async (params) => {
        markerCalls.push("execute-called");
        await params.onBeforeProviderCall({ provider: { name: "openai", model: "gpt-image-2" }, execution: {} });
        await params.onAfterProviderCall({ execution: { provider_http_status: 200, provider_result_ok: true } });
        return {
          ok: true,
          state: "success",
          diagnostic: { environment: {}, provider: {}, usage: {}, execution: { provider_result_ok: true }, orchestrator: {} },
          result: {
            provider: "openai",
            model: "gpt-image-2",
            backgroundImageUrl: "https://fake.storage/openai/bg.png",
            creativeDirection: plannedJob.result.creative_direction,
            overlays: { styleText: [], deterministicText: [], factsAllowed: [] }
          }
        };
      },
      persistGeneratedAsset: async () => ({ ok: true, asset: { id: "asset-1" } })
    });
    const res = await handler(baseEvent({ jobId: "job-1" }));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.assetId, "asset-1");
    assert.equal(markerCalls.length, 1, "the provider must be called exactly once");

    const jobUpdates = client.calls.filter((c) => c.table === "ai_execution_jobs" && c.ops.some((op) => op[0] === "update"));
    const settleUpdate = jobUpdates[jobUpdates.length - 1].ops.find((op) => op[0] === "update")[1][0];
    assert.equal(settleUpdate.status, "completed");

    const itemUpdate = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
    assert.equal(itemUpdate.ops.find((op) => op[0] === "update")[1][0].status, "draft");
  });
});

test("Part D/F failure path: a known provider failure settles the job AND usage as failed, never as completed, and marks the content item honestly 'failed'", async () => {
  await withSecret(async () => {
    const client = createFakeSupabaseClient([
      { data: [{ ...plannedJob, status: "running" }], error: null }, // claim
      { data: { plan: plannedJob.plan }, error: null }, // settlePremiumJobFailed read
      { data: { id: "job-1", status: "failed" }, error: null }, // settlePremiumJobFailed update
      { data: [{ id: "item-1", status: "failed" }], error: null } // content item update
    ]);
    const handler = createMarketingPremiumCreativeBackgroundHandler({
      getClient: () => client,
      executeReservedPremiumCreativeGeneration: async () => ({ ok: false, state: "provider_call_failed", reason: "provider_request_failed" })
    });
    const res = await handler(baseEvent({ jobId: "job-1" }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
    const jobUpdates = client.calls.filter((c) => c.table === "ai_execution_jobs" && c.ops.some((op) => op[0] === "update"));
    const jobPayload = jobUpdates[jobUpdates.length - 1].ops.find((op) => op[0] === "update")[1][0];
    assert.equal(jobPayload.status, "failed", "a provider failure must never settle the job as completed");
    const itemUpdate = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
    assert.equal(itemUpdate.ops.find((op) => op[0] === "update")[1][0].status, "failed");
  });
});

test("Part D: an unhandled exception mid-execution still settles the job failed rather than leaving it stuck at 'running' forever", async () => {
  await withSecret(async () => {
    const client = createFakeSupabaseClient([
      { data: [{ ...plannedJob, status: "running" }], error: null }, // claim
      { data: { plan: plannedJob.plan }, error: null }, // settlePremiumJobFailed read
      { data: { id: "job-1", status: "failed" }, error: null }, // settlePremiumJobFailed update
      { data: [{ id: "item-1", status: "failed" }], error: null } // content item update
    ]);
    const handler = createMarketingPremiumCreativeBackgroundHandler({
      getClient: () => client,
      executeReservedPremiumCreativeGeneration: async () => {
        throw new Error("boom");
      }
    });
    const res = await handler(baseEvent({ jobId: "job-1" }));
    assert.equal(res.statusCode, 500);
    const jobUpdates = client.calls.filter((c) => c.table === "ai_execution_jobs" && c.ops.some((op) => op[0] === "update"));
    assert.equal(jobUpdates[jobUpdates.length - 1].ops.find((op) => op[0] === "update")[1][0].status, "failed", "a hard crash must never leave the job stuck at 'running' forever — the exact historical stuck-generating bug");
  });
});
