import test from "node:test";
import assert from "node:assert/strict";
import {
  interleaveByQuota,
  spreadAcrossMonth,
  buildMonthlyContentPlan,
  CONTENT_TYPE_FOR_ALLOWANCE_KEY,
  EVERGREEN_CONTENT_ANGLES,
  CONTENT_ITEM_APPROVABLE_STATUSES,
  resolveApprovalDecision
} from "../netlify/functions/_shared/marketing-content-planner.js";
import { DEFAULT_MONTHLY_ALLOWANCE } from "../netlify/functions/_shared/marketing-cost-config.js";

test("interleaveByQuota: equal quotas produce a perfect round-robin, never clustering one type", () => {
  const order = interleaveByQuota({ a: 3, b: 3, c: 3 });
  assert.equal(order.length, 9);
  // No type should ever run 3-in-a-row when quotas are equal.
  for (let i = 0; i < order.length - 2; i += 1) {
    assert.ok(!(order[i] === order[i + 1] && order[i + 1] === order[i + 2]), `unexpected triple-run at index ${i}: ${order.slice(i, i + 3)}`);
  }
  assert.equal(order.filter((t) => t === "a").length, 3);
  assert.equal(order.filter((t) => t === "b").length, 3);
  assert.equal(order.filter((t) => t === "c").length, 3);
});

test("interleaveByQuota: a type with quota 0 never appears in the output", () => {
  const order = interleaveByQuota({ a: 5, b: 0 });
  assert.ok(!order.includes("b"));
  assert.equal(order.length, 5);
});

test("interleaveByQuota: unequal quotas still preserve exact totals per type", () => {
  const order = interleaveByQuota({ a: 10, b: 2 });
  assert.equal(order.filter((t) => t === "a").length, 10);
  assert.equal(order.filter((t) => t === "b").length, 2);
});

test("spreadAcrossMonth: 90 items across a 30-day month lands ~3/day (the Section 9 target cadence)", () => {
  const dates = spreadAcrossMonth(2026, 9, 90); // September has 30 days
  const counts = {};
  for (const d of dates) counts[d] = (counts[d] || 0) + 1;
  assert.equal(Object.keys(counts).length, 30, "every day of the month should get at least one item");
  for (const count of Object.values(counts)) assert.equal(count, 3, "each day should get exactly 3 items with a 90/30 split");
});

test("spreadAcrossMonth: dates are always real, in-month, and non-decreasing", () => {
  const dates = spreadAcrossMonth(2026, 2, 40); // February 2026 (not a leap year) has 28 days
  for (const d of dates) {
    assert.match(d, /^2026-02-\d{2}$/);
    const day = Number(d.slice(8, 10));
    assert.ok(day >= 1 && day <= 28, `day ${day} must be a real February 2026 date`);
  }
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted);
});

test("buildMonthlyContentPlan: the Section 9 default allowance produces exactly 90 items", () => {
  const { items } = buildMonthlyContentPlan({ year: 2026, month: 9, allowance: DEFAULT_MONTHLY_ALLOWANCE, platforms: ["facebook", "instagram"] });
  assert.equal(items.length, 90);
});

test("buildMonthlyContentPlan: every item maps to a real content_type from the allowance key mapping", () => {
  const { items } = buildMonthlyContentPlan({ year: 2026, month: 9, allowance: DEFAULT_MONTHLY_ALLOWANCE, platforms: [] });
  const validTypes = new Set(Object.values(CONTENT_TYPE_FOR_ALLOWANCE_KEY));
  for (const item of items) assert.ok(validTypes.has(item.content_type));
});

test("buildMonthlyContentPlan: items are sorted chronologically by suggested_date", () => {
  const { items } = buildMonthlyContentPlan({ year: 2026, month: 9, allowance: DEFAULT_MONTHLY_ALLOWANCE, platforms: [] });
  const dates = items.map((i) => i.suggested_date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted);
});

test("buildMonthlyContentPlan: every item defaults to requiring human approval and never uses AI Clone by default", () => {
  const { items } = buildMonthlyContentPlan({ year: 2026, month: 9, allowance: DEFAULT_MONTHLY_ALLOWANCE, platforms: [] });
  for (const item of items) {
    assert.equal(item.requires_human_approval, true);
    assert.equal(item.uses_ai_clone, false);
  }
});

test("buildMonthlyContentPlan: an item scheduled near Mother's Day is tagged with that occasion, not a generic evergreen angle", () => {
  const { items } = buildMonthlyContentPlan({ year: 2026, month: 5, allowance: { image_posts: 30, reels_or_shorts: 0, long_form_videos: 0 }, platforms: [] });
  // Mother's Day 2026 is 2026-05-10 — with 30 items spread across 31 days, at least one should land within the 4-day window.
  const tagged = items.filter((i) => i.occasion_key === "mothers_day");
  assert.ok(tagged.length > 0, "at least one item should be tagged to Mother's Day");
  for (const item of tagged) {
    assert.match(item.title, /Mother's Day/);
  }
});

test("buildMonthlyContentPlan: an item with no nearby occasion gets a real evergreen angle, never a blank/fabricated title", () => {
  const { items } = buildMonthlyContentPlan({ year: 2026, month: 1, allowance: { image_posts: 5, reels_or_shorts: 0, long_form_videos: 0 }, platforms: [] });
  // January 2026 has no occasion near most days except New Year's Day itself.
  const untagged = items.filter((i) => !i.occasion_key);
  assert.ok(untagged.length > 0);
  for (const item of untagged) {
    assert.ok(EVERGREEN_CONTENT_ANGLES.some((angle) => item.title.includes(angle)));
    assert.ok(item.title.trim().length > 0);
  }
});

test("buildMonthlyContentPlan: platforms passed in are applied to every item, and arrays are independent (no shared-reference mutation bug)", () => {
  const { items } = buildMonthlyContentPlan({ year: 2026, month: 9, allowance: { image_posts: 3, reels_or_shorts: 0, long_form_videos: 0 }, platforms: ["facebook", "pinterest"] });
  for (const item of items) assert.deepEqual(item.platforms, ["facebook", "pinterest"]);
  items[0].platforms.push("tiktok");
  assert.deepEqual(items[1].platforms, ["facebook", "pinterest"], "mutating one item's platforms array must never affect another item's");
});

test("buildMonthlyContentPlan: a zero allowance produces zero items rather than throwing", () => {
  const { items } = buildMonthlyContentPlan({ year: 2026, month: 9, allowance: { image_posts: 0, reels_or_shorts: 0, long_form_videos: 0 }, platforms: [] });
  assert.deepEqual(items, []);
});

test("buildMonthlyContentPlan: occasions_in_month reflects the real occasion calendar for that month", () => {
  const { occasions_in_month } = buildMonthlyContentPlan({ year: 2026, month: 9, allowance: DEFAULT_MONTHLY_ALLOWANCE, platforms: [] });
  const keys = occasions_in_month.map((o) => o.key);
  assert.ok(keys.includes("wedding_season"));
  assert.ok(keys.includes("homecoming_season"));
});

test("resolveApprovalDecision: every pre-publish status can be approved or rejected", () => {
  for (const status of CONTENT_ITEM_APPROVABLE_STATUSES) {
    assert.equal(resolveApprovalDecision(status, "approved"), "approved");
    assert.equal(resolveApprovalDecision(status, "rejected"), "archived");
  }
});

test("resolveApprovalDecision: a published/scheduled/failed item cannot be 'approved' or 'rejected' as a review verdict", () => {
  for (const status of ["scheduled", "published", "failed", "archived", "approved"]) {
    assert.equal(resolveApprovalDecision(status, "approved"), null);
    assert.equal(resolveApprovalDecision(status, "rejected"), null);
  }
});

test("resolveApprovalDecision: an unrecognized decision string returns null rather than silently picking a status", () => {
  assert.equal(resolveApprovalDecision("draft", "maybe"), null);
  assert.equal(resolveApprovalDecision("draft", ""), null);
  assert.equal(resolveApprovalDecision("draft", undefined), null);
});
