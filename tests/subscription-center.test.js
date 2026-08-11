import test from "node:test";
import assert from "node:assert/strict";
import { computeAdminSubscriptionMetrics, buildCancellationSummary } from "../netlify/functions/_shared/subscription-center.js";

test("admin metrics compute MRR from active paid plans", () => {
  const m = computeAdminSubscriptionMetrics(
    [
      { plan_code: "professional", status: "active" },
      { plan_code: "starter", status: "active" },
      { plan_code: "trial", status: "trialing" }
    ],
    [{ event_type: "reactivate" }]
  );
  assert.equal(m.mrr, 158);
  assert.equal(m.counts.active, 2);
  assert.equal(m.counts.trial, 1);
  assert.equal(m.counts.reactivated, 1);
});

test("cancellation summary includes access and export reminder", () => {
  const s = buildCancellationSummary({
    cancel_at_period_end: true,
    current_period_ends_at: "2026-08-28T00:00:00Z"
  });
  assert.equal(s.data_export_reminder, true);
  assert.ok(s.access_expiration_date);
});
