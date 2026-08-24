import test from "node:test";
import assert from "node:assert/strict";
import { monthlyCommittedSpendCents, checkMonthlyBudget } from "../netlify/functions/_shared/marketing-budget-guard.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Priority 8 ("as far as technically possible" pass): real, enforced cost
// safety for the classic (non-compound) generation path.

test("monthlyCommittedSpendCents: sums only 'estimated' rows for the requesting shop this month", async () => {
  const client = createFakeSupabaseClient([{ data: [{ estimated_cost_cents: 4 }, { estimated_cost_cents: 1 }], error: null }]);
  const result = await monthlyCommittedSpendCents(client, { shopId: "shop-1", now: new Date("2026-08-24T00:00:00.000Z") });
  assert.equal(result.ok, true);
  assert.equal(result.cents, 5);

  const call = client.calls[0];
  assert.ok(call.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-1"));
  assert.ok(call.ops.some((op) => op[0] === "eq" && op[1][0] === "status" && op[1][1] === "estimated"), "must only ever count 'estimated' rows — never double-count an 'actual' row for the same spend");
});

test("monthlyCommittedSpendCents: scopes to the current UTC calendar month only", async () => {
  const client = createFakeSupabaseClient([{ data: [], error: null }]);
  await monthlyCommittedSpendCents(client, { shopId: "shop-1", now: new Date("2026-08-24T15:00:00.000Z") });
  const call = client.calls[0];
  const gteOp = call.ops.find((op) => op[0] === "gte" && op[1][0] === "created_at");
  assert.ok(gteOp);
  assert.equal(gteOp[1][1], "2026-08-01T00:00:00.000Z");
});

test("monthlyCommittedSpendCents: a real DB error degrades to ok:false, never a fabricated zero", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "connection lost" } }]);
  const result = await monthlyCommittedSpendCents(client, { shopId: "shop-1" });
  assert.equal(result.ok, false);
  assert.match(result.error, /connection lost/);
});

test("checkMonthlyBudget: no cap supplied -> always allowed (today's honest default — no persisted per-shop cap exists yet)", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await checkMonthlyBudget(client, { shopId: "shop-1", additionalCostCents: 1000000, capCents: null });
  assert.equal(result.allowed, true);
  assert.equal(client.calls.length, 0, "must not even query usage when there's no cap to check against");
});

test("checkMonthlyBudget: within the cap -> allowed, with real current/would-be figures reported", async () => {
  const client = createFakeSupabaseClient([{ data: [{ estimated_cost_cents: 100 }], error: null }]);
  const result = await checkMonthlyBudget(client, { shopId: "shop-1", additionalCostCents: 50, capCents: 200 });
  assert.equal(result.allowed, true);
  assert.equal(result.currentSpendCents, 100);
  assert.equal(result.wouldBeCents, 150);
});

test("checkMonthlyBudget: exceeding the cap -> blocked, before any spend", async () => {
  const client = createFakeSupabaseClient([{ data: [{ estimated_cost_cents: 180 }], error: null }]);
  const result = await checkMonthlyBudget(client, { shopId: "shop-1", additionalCostCents: 50, capCents: 200 });
  assert.equal(result.allowed, false);
  assert.equal(result.wouldBeCents, 230);
});

test("checkMonthlyBudget: landing exactly ON the cap is allowed (an inclusive boundary, not an off-by-one refusal)", async () => {
  const client = createFakeSupabaseClient([{ data: [{ estimated_cost_cents: 150 }], error: null }]);
  const result = await checkMonthlyBudget(client, { shopId: "shop-1", additionalCostCents: 50, capCents: 200 });
  assert.equal(result.allowed, true);
});

test("checkMonthlyBudget: a real DB error fails CLOSED (blocked), never open — a budget check that can't verify safety must never let an expensive operation through", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "db down" } }]);
  const result = await checkMonthlyBudget(client, { shopId: "shop-1", additionalCostCents: 1, capCents: 100 });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "budget_check_failed");
});
