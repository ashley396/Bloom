import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlatformEconomics,
  economicsScenario,
  estimateMonthlyInvocations
} from "../lib/platform/platform-economics.js";

test("platform economics returns burn and MRR for active shops", () => {
  const e = buildPlatformEconomics({
    shops: 12,
    activeSubscriptions: 12,
    trials: 2,
    starter: 5,
    professional: 4,
    premium: 1,
    estimatedMrr: 5 * 59 + 4 * 99 + 1 * 149
  });
  assert.ok(e.estimated_burn_usd > 0);
  assert.ok(e.mrr_usd > e.estimated_burn_usd);
  assert.ok(e.line_items.length >= 6);
});

test("500 subscriber scenario stays a small fraction of MRR", () => {
  const e = economicsScenario(500);
  assert.equal(e.paying_subscribers, 500);
  assert.ok(e.mrr_usd >= 44000);
  assert.ok(e.estimated_burn_usd >= 300);
  assert.ok(e.estimated_burn_usd <= 1200);
  assert.ok(e.infra_percent_of_mrr < 3);
  assert.ok(estimateMonthlyInvocations(500) > 1_000_000);
});

test("launch stage has lower burn than scale stage", () => {
  const launch = economicsScenario(10);
  const scale = economicsScenario(500);
  assert.ok(scale.estimated_burn_usd > launch.estimated_burn_usd);
  assert.ok(scale.mrr_usd > scale.estimated_burn_usd * 20);
});
