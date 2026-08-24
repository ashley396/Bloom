import test from "node:test";
import assert from "node:assert/strict";
import { createScheduledPublisherHandler } from "../netlify/functions/marketing-scheduled-publisher.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Launch-blocker fix, Blocker 3: the actual cron trigger. These tests
// exercise the handler in isolation (injected client) — they say nothing
// about whether Netlify's scheduler is actually configured on a deployed
// site, which this pass explicitly does not do (see the module's own doc
// comment and netlify.toml's schedule entry).

test("scheduled publisher: runs the worker globally (no shop_id) and reports a summary", async () => {
  const client = createFakeSupabaseClient([
    { data: [], error: null }, // reclaimStaleRunningJobs: no stale jobs
    { data: [{ id: "job-1" }], error: null }, // candidates (global)
    { data: [{ id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null },
    { data: { id: "variant-1", platform: "facebook", ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const handler = createScheduledPublisherHandler({ getClient: () => client });
  const res = await handler({ headers: { "x-netlify-event": "schedule" } });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.processed, 1);
  assert.equal(body.summary.failed, 1);
  // Confirms the global (no shop_id) claim path was actually exercised.
  const candidateCall = client.calls[0];
  assert.ok(!candidateCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id"));
});

test("scheduled publisher: zero due jobs across the whole system is a normal, quiet 200 — not an error", async () => {
  const client = createFakeSupabaseClient([
    { data: [], error: null }, // reclaimStaleRunningJobs: no stale jobs
    { data: [], error: null } // claimDueJobs: nothing due
  ]);
  const handler = createScheduledPublisherHandler({ getClient: () => client });
  const res = await handler({ headers: { "x-netlify-event": "schedule" } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).processed, 0);
});

test("scheduled publisher: a thrown claim/process error is caught and reported as a clean 500, never an unhandled crash", async () => {
  const client = {
    from() {
      throw new Error("db unavailable");
    }
  };
  const handler = createScheduledPublisherHandler({ getClient: () => client });
  const res = await handler({ headers: { "x-netlify-event": "schedule" } });
  assert.equal(res.statusCode, 500);
});

test("scheduled publisher: an ordinary public GET/PUT request without the scheduled-invocation marker is rejected (defense-in-depth on top of Netlify's own platform-level gate)", async () => {
  const client = createFakeSupabaseClient([]);
  const handler = createScheduledPublisherHandler({ getClient: () => client });
  const res = await handler({ httpMethod: "GET", headers: {} });
  assert.equal(res.statusCode, 405);
});
