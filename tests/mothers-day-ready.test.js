import test from "node:test";
import assert from "node:assert/strict";
import { MOTHERS_DAY_CHECKLIST, scoreReadiness, autoDetectReadiness } from "../lib/ops/mothers-day-ready.js";

// lib/ops/mothers-day-ready.js had zero test coverage despite being the
// pure scoring logic behind the peak-readiness dashboard florists see
// ahead of the shop's biggest holiday.

test("scoreReadiness: zero completed items scores 0 and lands in the getting_started band", () => {
  const result = scoreReadiness([]);
  assert.equal(result.score, 0);
  assert.equal(result.complete, 0);
  assert.equal(result.total, MOTHERS_DAY_CHECKLIST.length);
  assert.equal(result.band, "getting_started");
});

test("scoreReadiness: completing everything scores 100 and lands in the ready band", () => {
  const allIds = MOTHERS_DAY_CHECKLIST.map((i) => i.id);
  const result = scoreReadiness(allIds);
  assert.equal(result.score, 100);
  assert.equal(result.complete, MOTHERS_DAY_CHECKLIST.length);
  assert.equal(result.band, "ready");
});

test("scoreReadiness: an unrecognized id in the completed list is ignored, not double-counted or crashing", () => {
  const result = scoreReadiness(["delivery_fees", "not_a_real_checklist_item"]);
  assert.equal(result.complete, 1);
});

test("scoreReadiness: band thresholds land exactly where the readiness bands are documented", () => {
  const idsForScore = (n) => MOTHERS_DAY_CHECKLIST.slice(0, n).map((i) => i.id);
  // 10 items total: 4/10=40% in_progress, 7/10=70% almost_there, 9/10=90% ready
  assert.equal(scoreReadiness(idsForScore(3)).band, "getting_started"); // 30%
  assert.equal(scoreReadiness(idsForScore(4)).band, "in_progress"); // 40%
  assert.equal(scoreReadiness(idsForScore(7)).band, "almost_there"); // 70%
  assert.equal(scoreReadiness(idsForScore(9)).band, "ready"); // 90%
});

test("scoreReadiness: no completed argument at all defaults to the empty/0% state, not a crash", () => {
  const result = scoreReadiness();
  assert.equal(result.score, 0);
});

test("autoDetectReadiness: only flags items where the real signal actually crosses its threshold", () => {
  const completed = autoDetectReadiness({
    delivery_fee_set: true,
    mothers_day_products: 5, // below the 6 threshold
    inventory_items: 12,
    staff_count: 0,
  });
  assert.ok(completed.includes("delivery_fees"));
  assert.ok(completed.includes("inventory_par"));
  assert.ok(!completed.includes("products_published"), "5 products is below the real threshold of 6");
  assert.ok(!completed.includes("staff_scheduled"), "0 staff must not count as scheduled");
});

test("autoDetectReadiness: with no signals at all, nothing is auto-detected as complete", () => {
  assert.deepEqual(autoDetectReadiness(), []);
  assert.deepEqual(autoDetectReadiness({}), []);
});

test("autoDetectReadiness: every checklist item has a real, working signal path — none silently unreachable", () => {
  const allSignalsOn = {
    delivery_fee_set: true,
    website_has_holiday: true,
    mothers_day_products: 6,
    inventory_items: 10,
    staff_count: 1,
    website_cutoff_text: true,
    payments_enabled: true,
    email_draft: true,
    holiday_peak: true,
    network_partner: true,
  };
  const completed = autoDetectReadiness(allSignalsOn);
  const allIds = MOTHERS_DAY_CHECKLIST.map((i) => i.id);
  assert.deepEqual([...completed].sort(), [...allIds].sort());
});

test("autoDetectReadiness feeds directly into scoreReadiness for a real end-to-end readiness read", () => {
  const completed = autoDetectReadiness({ delivery_fee_set: true, staff_count: 2 });
  const result = scoreReadiness(completed);
  assert.equal(result.complete, 2);
});
