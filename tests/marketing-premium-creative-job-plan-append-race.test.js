import test from "node:test";
import assert from "node:assert/strict";
import { createRacyFakeSupabaseClient } from "./helpers/racy-fake-supabase-client.mjs";
import { addPremiumJobAttempt, buildPlannedAttemptStep, buildPremiumIdempotencyKey, PREMIUM_JOB_TYPE } from "../netlify/functions/_shared/marketing-premium-creative-job.js";

// Hybrid Marketing Studio Batch 4.2 ("make Premium retry plan append
// atomic") — dedicated tests for addPremiumJobAttempt's own
// compare-and-swap mechanism, isolated from the reservation-level
// dedup (already covered in marketing-premium-creative-job-idempotency-
// race.test.js) so this specific fix is proven on its own terms: TWO
// genuinely concurrent calls appending the SAME attempt_index to the
// SAME job must leave exactly one plan[] entry, never two, and the
// loser must recognize and return the winner's real entry rather than
// erroring or silently overwriting it.

function seedJob(client, { plan = [], status = "planned" } = {}) {
  const now = new Date().toISOString();
  client._tables.ai_execution_jobs.set("job-1", {
    id: "job-1",
    shop_id: "shop-1",
    job_type: PREMIUM_JOB_TYPE,
    status,
    idempotency_key: buildPremiumIdempotencyKey("item-1", 0),
    plan,
    result: { content_item_id: "item-1" },
    created_at: now,
    updated_at: now
  });
}

test("Part 4: two simultaneous appends of the SAME attempt_index (the exact scenario a duplicate Retry click's own reservation resolves to) leave exactly one plan entry, and both callers agree on it", async () => {
  const client = createRacyFakeSupabaseClient();
  seedJob(client, { plan: [] });
  // Both "callers" already resolved to the SAME real reservation (as
  // reserveProviderCall's own onConflictReturnExisting guarantees) —
  // this is what actually happens after two racing Retry clicks: the
  // step objects are identical.
  const step = buildPlannedAttemptStep({ attemptIndex: 0, reservationId: "usage-shared" });

  const [a, b] = await Promise.all([addPremiumJobAttempt(client, "job-1", { ...step }, {}), addPremiumJobAttempt(client, "job-1", { ...step }, {})]);

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  // Exactly one of the two must have actually performed the write;
  // the other must recognize the already-reconciled attempt.
  const winners = [a, b].filter((r) => r.alreadyAppended === false);
  const losers = [a, b].filter((r) => r.alreadyAppended === true);
  assert.equal(winners.length, 1, "exactly one caller must be the real writer");
  assert.equal(losers.length, 1, "the other caller must recognize the attempt was already reconciled, never write a duplicate");

  const finalJob = client._tables.ai_execution_jobs.get("job-1");
  assert.equal(finalJob.plan.length, 1, "exactly one attempt entry must exist — never two, even though two callers raced to append it");
  assert.equal(finalJob.plan[0].usage_id, "usage-shared");

  // Part 4: prove the compare-and-swap actually fired (the loser really
  // lost a real race and recovered), not that the race merely never
  // manifested — the loser's own update call must have matched zero
  // rows before its retry re-read found the winner's row.
  const jobCalls = client.calls.filter((c) => c.table === "ai_execution_jobs");
  const selectCalls = jobCalls.filter((c) => c.op !== "update" && c.op !== "insert");
  const updateCalls = jobCalls.filter((c) => c.op === "update");
  assert.equal(selectCalls.length, 3, "the loser must have re-read the job exactly once after losing its first compare-and-swap (2 initial reads + 1 retry read)");
  assert.equal(updateCalls.length, 2, "the loser's own first UPDATE attempt must have actually been sent and matched zero rows, not skipped");
});

test("Part 5: a lost compare-and-swap never overwrites the winner's write, never errors, and never leaves the job un-appended", async () => {
  const client = createRacyFakeSupabaseClient();
  seedJob(client, { plan: [{ id: "attempt-0", attempt_index: 0, tool: "premium_creative_image", status: "planned", usage_id: "usage-real", marker: null, result: null, error: null, started_at: null, finished_at: null }] });
  // A caller with a STALE view of the job (as if it read the row before
  // the real attempt-0 above was ever written) tries to append a
  // DIFFERENT step object for the SAME attempt_index — simulating a
  // worst-case where two callers somehow built slightly different step
  // payloads for the same attempt (e.g. a stale reservationId from a
  // retried request). The real invariant that matters: the ALREADY
  // durably-recorded attempt must never be silently replaced.
  const staleStep = buildPlannedAttemptStep({ attemptIndex: 0, reservationId: "usage-stale-would-be-wrong" });
  const result = await addPremiumJobAttempt(client, "job-1", staleStep, {});
  assert.equal(result.ok, true);
  assert.equal(result.alreadyAppended, true);
  const finalJob = client._tables.ai_execution_jobs.get("job-1");
  assert.equal(finalJob.plan.length, 1);
  assert.equal(finalJob.plan[0].usage_id, "usage-real", "the already-durable attempt must never be overwritten by a stale/losing caller's own step");
});

test("Part 5: three-way simultaneous append race still converges to exactly one plan entry", async () => {
  const client = createRacyFakeSupabaseClient();
  seedJob(client, { plan: [] });
  const step = buildPlannedAttemptStep({ attemptIndex: 0, reservationId: "usage-shared" });
  const results = await Promise.all([
    addPremiumJobAttempt(client, "job-1", { ...step }, {}),
    addPremiumJobAttempt(client, "job-1", { ...step }, {}),
    addPremiumJobAttempt(client, "job-1", { ...step }, {})
  ]);
  assert.ok(results.every((r) => r.ok));
  const finalJob = client._tables.ai_execution_jobs.get("job-1");
  assert.equal(finalJob.plan.length, 1, "even three racing callers must converge to exactly one plan entry");
});

test("addPremiumJobAttempt bounded retry: exhausting maxRetries under CONTINUOUS contention fails honestly rather than looping forever", async () => {
  const client = createRacyFakeSupabaseClient();
  seedJob(client, { plan: [] });
  // Adversarial client wrapper: after every read this test's own code
  // performs, a hostile "always-changing" writer touches the row first,
  // guaranteeing every one of addPremiumJobAttempt's own compare-and-
  // swap attempts loses. Proves the bounded retry actually terminates
  // instead of hanging, and reports a real, honest error.
  const realFrom = client.from.bind(client);
  let reads = 0;
  client.from = (table) => {
    const builder = realFrom(table);
    if (table !== "ai_execution_jobs") return builder;
    const originalMaybeSingle = builder.maybeSingle.bind(builder);
    builder.maybeSingle = async () => {
      const res = await originalMaybeSingle();
      reads += 1;
      // Simulate a concurrent writer changing the row's updated_at
      // between every read this test observes and the caller's own
      // next write, guaranteeing the CAS always loses.
      const row = client._tables.ai_execution_jobs.get("job-1");
      if (row) row.updated_at = new Date(Date.now() + reads).toISOString();
      return res;
    };
    return builder;
  };

  const result = await addPremiumJobAttempt(client, "job-1", buildPlannedAttemptStep({ attemptIndex: 0, reservationId: "usage-1" }), { maxRetries: 2 });
  assert.equal(result.ok, false);
  assert.match(result.error, /repeated concurrent writes/);
});
