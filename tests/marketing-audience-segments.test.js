import test from "node:test";
import assert from "node:assert/strict";
import { buildAudienceSegments } from "../lib/marketing/audience-segments.js";

const NOW = new Date("2027-05-01T12:00:00Z");

function customer(overrides = {}) {
  return {
    id: overrides.id || "c1",
    contact_preferences: { marketing_opt_in: true },
    vip: false,
    created_at: "2020-01-01T00:00:00Z",
    ...overrides,
  };
}

test("a customer who never opted in never appears in any segment, no matter what else is true", () => {
  const customers = [
    customer({ id: "no-opt-in", contact_preferences: { marketing_opt_in: false }, vip: true }),
    customer({ id: "no-prefs-at-all", contact_preferences: null, vip: true }),
  ];
  const orders = [
    { customer_id: "no-opt-in", total: 5000, occasion: "Mother's Day", created_at: NOW.toISOString() },
    { customer_id: "no-prefs-at-all", total: 5000, occasion: "Mother's Day", created_at: NOW.toISOString() },
  ];
  const { segments, subscriberCount } = buildAudienceSegments({ customers, orders, now: NOW });
  assert.equal(subscriberCount, 0);
  for (const seg of segments) {
    assert.deepEqual(seg.customerIds, [], `${seg.key} should be empty`);
  }
});

test("VIP segment only includes opted-in VIPs", () => {
  const customers = [
    customer({ id: "vip-optin", vip: true }),
    customer({ id: "vip-no-optin", vip: true, contact_preferences: { marketing_opt_in: false } }),
    customer({ id: "regular-optin", vip: false }),
  ];
  const { segments } = buildAudienceSegments({ customers, orders: [], now: NOW });
  const vip = segments.find((s) => s.key === "vip");
  assert.deepEqual(vip.customerIds, ["vip-optin"]);
});

test("repeat and high-spend segments aggregate real order history", () => {
  const customers = [customer({ id: "a" }), customer({ id: "b" })];
  const orders = [
    { customer_id: "a", total: 100, created_at: "2026-01-01T00:00:00Z" },
    { customer_id: "a", total: 250, created_at: "2026-02-01T00:00:00Z" },
    { customer_id: "b", total: 50, created_at: "2026-01-01T00:00:00Z" },
  ];
  const { segments } = buildAudienceSegments({ customers, orders, now: NOW });
  assert.deepEqual(segments.find((s) => s.key === "repeat").customerIds, ["a"]);
  assert.deepEqual(segments.find((s) => s.key === "high_spend").customerIds, ["a"]);
});

test("new customers are based on creation date, lapsed on most recent order", () => {
  const customers = [
    customer({ id: "brand-new", created_at: new Date(NOW.getTime() - 5 * 86400000).toISOString() }),
    customer({ id: "old-customer", created_at: "2020-01-01T00:00:00Z" }),
    customer({ id: "lapsed-buyer", created_at: "2020-01-01T00:00:00Z" }),
  ];
  const orders = [
    { customer_id: "lapsed-buyer", total: 10, created_at: "2024-01-01T00:00:00Z" },
  ];
  const { segments } = buildAudienceSegments({ customers, orders, now: NOW });
  assert.deepEqual(segments.find((s) => s.key === "new").customerIds, ["brand-new"]);
  assert.deepEqual(segments.find((s) => s.key === "lapsed").customerIds, ["lapsed-buyer"]);
});

test("birthday/anniversary segments match by month regardless of year, occasion segments match order history", () => {
  const customers = [
    customer({ id: "may-birthday", birthday: "1990-05-15" }),
    customer({ id: "june-birthday", birthday: "1990-06-15" }),
    customer({ id: "wedding-buyer" }),
  ];
  const orders = [{ customer_id: "wedding-buyer", occasion: "Wedding bouquet", created_at: NOW.toISOString() }];
  const { segments } = buildAudienceSegments({ customers, orders, now: NOW });
  assert.deepEqual(segments.find((s) => s.key === "birthday_this_month").customerIds, ["may-birthday"]);
  assert.deepEqual(segments.find((s) => s.key === "wedding_customers").customerIds, ["wedding-buyer"]);
});
