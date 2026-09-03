import test from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";
import {
  countPremiumDesignsUsedThisMonth,
  checkPremiumDesignEntitlement,
  PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN,
  OPENAI_PREMIUM_CREATIVE_OPERATION
} from "../netlify/functions/_shared/marketing-premium-design-entitlement.js";

// Hybrid Marketing Studio Batch 2, Part 12: server-side entitlement
// calculation SHAPE only — no migration, no new table (this counts real
// rows already written by marketing-premium-creative-orchestrator.js's
// reserveProviderCall() into the EXISTING marketing_generation_usage
// ledger). Not wired into a live gate yet (no real per-shop plan lookup
// exists) — these tests exercise the pure calculation shape.

test("PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN matches Part 12's exact numbers, and leaves Founding Florist uncapped rather than guessing", () => {
  assert.equal(PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN.starter, 30);
  assert.equal(PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN.professional, 100);
  assert.equal(PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN.enterprise, 300);
  assert.equal(PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN.founding_florist, null, "Founding Florist entitlement is TBD — never remove existing rights by inventing a cap");
});

test("countPremiumDesignsUsedThisMonth queries the EXISTING marketing_generation_usage ledger, scoped to openai + the premium operation + attempt_index 0", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null, count: 4 }]);
  const result = await countPremiumDesignsUsedThisMonth(client, "shop-1");
  assert.equal(result.ok, true);
  assert.equal(result.used, 4);
  const call = client.calls.find((c) => c.table === "marketing_generation_usage");
  assert.ok(call, "must query the existing ledger table — never a second usage table");
  const eqCalls = call.ops.filter((op) => op[0] === "eq").map((op) => op[1]);
  assert.ok(eqCalls.some(([field, value]) => field === "provider" && value === "openai"));
  assert.ok(eqCalls.some(([field, value]) => field === "operation" && value === OPENAI_PREMIUM_CREATIVE_OPERATION));
  assert.ok(eqCalls.some(([field, value]) => field === "attempt_index" && value === 0));
});

test("countPremiumDesignsUsedThisMonth fails closed (ok:false, used:null) on a query error — never silently reads an error as zero usage", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "connection reset" } }]);
  const result = await countPremiumDesignsUsedThisMonth(client, "shop-1");
  assert.equal(result.ok, false);
  assert.equal(result.used, null);
});

test("countPremiumDesignsUsedThisMonth requires shopId", async () => {
  const result = await countPremiumDesignsUsedThisMonth(createFakeSupabaseClient([]), null);
  assert.equal(result.ok, false);
});

test("checkPremiumDesignEntitlement: a starter shop under its allowance is allowed, with an accurate remaining count", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null, count: 5 }]);
  const result = await checkPremiumDesignEntitlement(client, "shop-1", "starter");
  assert.deepEqual(result, { ok: true, allowed: true, used: 5, allowance: 30, remaining: 25 });
});

test("checkPremiumDesignEntitlement: a shop at its allowance is not allowed", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null, count: 30 }]);
  const result = await checkPremiumDesignEntitlement(client, "shop-1", "starter");
  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
});

test("checkPremiumDesignEntitlement: Founding Florist is never capped by this shape (existing rights preserved)", async () => {
  const client = createFakeSupabaseClient([]); // no usage query at all — never even checked for an uncapped plan
  const result = await checkPremiumDesignEntitlement(client, "shop-1", "founding_florist");
  assert.deepEqual(result, { ok: true, allowed: true, used: null, allowance: null, remaining: null });
  assert.deepEqual(client.calls, []);
});

test("checkPremiumDesignEntitlement: an unrecognized plan tier fails closed, never defaults to unlimited", async () => {
  const result = await checkPremiumDesignEntitlement(createFakeSupabaseClient([]), "shop-1", "mystery_plan");
  assert.equal(result.ok, false);
  assert.equal(result.allowed, false);
});
