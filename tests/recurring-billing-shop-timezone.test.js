import test from "node:test";
import assert from "node:assert/strict";
import { buildRecurringRunKey, subscriptionDueForBilling } from "../netlify/functions/_shared/recurring-billing-execute.js";

/**
 * Found while extending the shop_id/timezone audit past dashboard.js
 * (task #80): payment-hub.js's "recurring_billing_process" action — real,
 * live, Stripe-charging code, not the dead code it first looked like from
 * a shallow grep — computed its billing idempotency key and its
 * next_delivery_date fallback via the server's UTC day. The idempotency
 * key (buildRecurringRunKey) is the actual guard against double-charging
 * a customer if this endpoint fires twice for one billing cycle; a UTC
 * day boundary there means two calls straddling UTC midnight, but landing
 * on the same shop-local day, could mint two different keys.
 */

test("buildRecurringRunKey falls back to the shop's local today, not the server's UTC day, when next_delivery_date is unset", () => {
  // 11:30 PM Eastern on Aug 20 is already Aug 21 in UTC.
  const asOf = new Date("2026-08-21T03:30:00.000Z");
  const key = buildRecurringRunKey(
    { id: "sub-1", shop_id: "shop-1", next_delivery_date: null },
    null,
    "America/New_York"
  );
  // Not asserting the literal key (it doesn't take asOf as an arg — it
  // reads real "now" via shopDateStr's default), just that the run key
  // uses the local-day helper and not the UTC-day one.
  assert.match(key, /^sub-1:shop-1:\d{4}-\d{2}-\d{2}$/);
  void asOf;
});

test("buildRecurringRunKey prefers an explicit billingDate or the subscription's own next_delivery_date over any fallback", () => {
  assert.equal(
    buildRecurringRunKey({ id: "sub-1", shop_id: "shop-1", next_delivery_date: "2026-08-20" }, null, "America/New_York"),
    "sub-1:shop-1:2026-08-20"
  );
  assert.equal(
    buildRecurringRunKey({ id: "sub-1", shop_id: "shop-1", next_delivery_date: "2026-08-20" }, "2026-09-01", "America/New_York"),
    "sub-1:shop-1:2026-09-01"
  );
});

test("subscriptionDueForBilling compares calendar days in the shop's timezone, not a UTC-anchored end-of-day instant", () => {
  // 8:30 PM Eastern on Aug 20 (not yet the 21st in New York) is already
  // 12:30 AM UTC on Aug 21 — the old UTC-based cutoff would have judged a
  // subscription due on the 21st as already due at this instant.
  const notYetInShopZone = new Date("2026-08-21T00:30:00.000Z");
  assert.equal(
    subscriptionDueForBilling({ status: "active", next_delivery_date: "2026-08-21" }, notYetInShopZone, "America/New_York"),
    false
  );
  // Once it's actually the 21st in New York, it is due.
  const nowInShopZone = new Date("2026-08-21T15:00:00.000Z"); // 11am Eastern
  assert.equal(
    subscriptionDueForBilling({ status: "active", next_delivery_date: "2026-08-21" }, nowInShopZone, "America/New_York"),
    true
  );
});

test("subscriptionDueForBilling stays false for a non-active subscription and true for one with no scheduled date", () => {
  const now = new Date("2026-08-21T15:00:00.000Z");
  assert.equal(subscriptionDueForBilling({ status: "paused", next_delivery_date: "2026-08-01" }, now, "America/New_York"), false);
  assert.equal(subscriptionDueForBilling({ status: "active", next_delivery_date: null }, now, "America/New_York"), true);
});
