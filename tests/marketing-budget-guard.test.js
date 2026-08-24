import test from "node:test";
import assert from "node:assert/strict";
import {
  monthlyCommittedSpendCents,
  checkMonthlyBudget,
  getShopBudgetCapCents,
  resolveEffectiveBudgetCapCents,
  checkMonthlyBudgetForRequest
} from "../netlify/functions/_shared/marketing-budget-guard.js";
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

// ── Priority 2 (persisted per-shop default budget) ──────────────────────

test("getShopBudgetCapCents: a real persisted cap comes back scoped to the requesting shop", async () => {
  const client = createFakeSupabaseClient([{ data: { marketing_monthly_budget_cents: 5000 }, error: null }]);
  const result = await getShopBudgetCapCents(client, "shop-1");
  assert.equal(result.ok, true);
  assert.equal(result.capCents, 5000);
  assert.equal(result.columnExists, true);
  const shopEq = client.calls[0].ops.find((op) => op[0] === "eq" && op[1][0] === "id");
  assert.equal(shopEq[1][1], "shop-1");
});

test("getShopBudgetCapCents: a shop with no default configured returns null, not zero or an error", async () => {
  const client = createFakeSupabaseClient([{ data: { marketing_monthly_budget_cents: null }, error: null }]);
  const result = await getShopBudgetCapCents(client, "shop-1");
  assert.equal(result.ok, true);
  assert.equal(result.capCents, null);
});

test("getShopBudgetCapCents: before the migration is applied (missing column) degrades to 'no persisted cap', not a crash — existing behavior for every shop is unchanged", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { code: "42703", message: 'column "marketing_monthly_budget_cents" does not exist' } }]);
  const result = await getShopBudgetCapCents(client, "shop-1");
  assert.equal(result.ok, true);
  assert.equal(result.capCents, null);
  assert.equal(result.columnExists, false);
});

test("getShopBudgetCapCents: a genuine unrelated DB error still fails closed as an error, not silently treated as 'unlimited'", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "connection reset" } }]);
  const result = await getShopBudgetCapCents(client, "shop-1");
  assert.equal(result.ok, false);
});

test("resolveEffectiveBudgetCapCents: no shop default -> the per-request cap (or none) governs, exactly today's behavior", () => {
  assert.equal(resolveEffectiveBudgetCapCents({ shopCapCents: null, requestedCapCents: 300 }), 300);
  assert.equal(resolveEffectiveBudgetCapCents({ shopCapCents: null, requestedCapCents: null }), null);
});

test("resolveEffectiveBudgetCapCents: a shop default with no per-request cap still applies as a real hard ceiling", () => {
  assert.equal(resolveEffectiveBudgetCapCents({ shopCapCents: 5000, requestedCapCents: null }), 5000);
});

test("resolveEffectiveBudgetCapCents: a stricter per-request cap is honored", () => {
  assert.equal(resolveEffectiveBudgetCapCents({ shopCapCents: 5000, requestedCapCents: 200 }), 200);
});

test("resolveEffectiveBudgetCapCents: a looser per-request cap can NEVER be used to exceed the shop's configured hard cap", () => {
  assert.equal(resolveEffectiveBudgetCapCents({ shopCapCents: 5000, requestedCapCents: 999999 }), 5000);
});

test("checkMonthlyBudgetForRequest: no shop default and no per-request cap -> allowed, zero usage queries (today's exact behavior for an unconfigured shop)", async () => {
  const client = createFakeSupabaseClient([{ data: { marketing_monthly_budget_cents: null }, error: null }]);
  const result = await checkMonthlyBudgetForRequest(client, { shopId: "shop-1", additionalCostCents: 500 });
  assert.equal(result.allowed, true);
  assert.equal(result.capSource, "none");
  const usageCall = client.calls.find((c) => c.table === "marketing_generation_usage");
  assert.equal(usageCall, undefined);
});

test("checkMonthlyBudgetForRequest: a shop default alone (no per-request cap) is enforced as a real ceiling and reports remaining budget", async () => {
  const client = createFakeSupabaseClient([
    { data: { marketing_monthly_budget_cents: 1000 }, error: null }, // shop default
    { data: [{ estimated_cost_cents: 400 }], error: null } // this month's spend
  ]);
  const result = await checkMonthlyBudgetForRequest(client, { shopId: "shop-1", additionalCostCents: 100 });
  assert.equal(result.allowed, true);
  assert.equal(result.capSource, "shop_default");
  assert.equal(result.remainingCents, 600);
});

test("checkMonthlyBudgetForRequest: a per-request cap stricter than the shop default is honored and reported as the source", async () => {
  const client = createFakeSupabaseClient([
    { data: { marketing_monthly_budget_cents: 1000 }, error: null },
    { data: [{ estimated_cost_cents: 50 }], error: null }
  ]);
  const result = await checkMonthlyBudgetForRequest(client, { shopId: "shop-1", additionalCostCents: 10, requestedCapCents: 100 });
  assert.equal(result.capCents, 100);
  assert.equal(result.capSource, "request_override");
});

test("checkMonthlyBudgetForRequest: a per-request cap higher than the shop default can never win — the shop's hard cap still governs and blocks", async () => {
  const client = createFakeSupabaseClient([
    { data: { marketing_monthly_budget_cents: 200 }, error: null },
    { data: [{ estimated_cost_cents: 190 }], error: null }
  ]);
  const result = await checkMonthlyBudgetForRequest(client, { shopId: "shop-1", additionalCostCents: 50, requestedCapCents: 999999 });
  assert.equal(result.allowed, false, "190 + 50 = 240 > the shop's real 200-cent cap, regardless of the huge per-request cap requested");
  assert.equal(result.capCents, 200);
  assert.equal(result.capSource, "shop_default");
});

test("checkMonthlyBudgetForRequest: an unverifiable shop-cap lookup fails the whole request closed", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "connection reset" } }]);
  const result = await checkMonthlyBudgetForRequest(client, { shopId: "shop-1", additionalCostCents: 10 });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "shop_budget_lookup_failed");
});
