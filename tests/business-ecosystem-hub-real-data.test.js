import test from "node:test";
import assert from "node:assert/strict";
import { buildHub } from "../netlify/functions/business-ecosystem.js";

/**
 * Analytics/Business OS fake-data sweep: kpis.wholesale_sales and
 * kpis.marketplace_sales were hardcoded to 0 regardless of a shop's real
 * wholesale/marketplace activity — an "inactive" $0 shown for a shop with
 * real completed orders on either side of a real transaction. Neither
 * field is rendered by the current frontend (business-ecosystem-ui.js
 * only shows Revenue/Profit/Recurring/A/R), but this is exactly the kind
 * of unused-but-fabricated field that becomes a real problem the moment
 * something (a future UI card, Rose) reads it. Now computed from real
 * marketplace_wholesale_orders rows, scoped to this shop on either side of
 * the transaction and to orders that are actually paid/fulfilled/completed
 * (never pending/processing/cancelled).
 */

// Minimal chainable Supabase-query stub: every method but the final await
// returns `this`; `fixtures[table]` supplies the { data, error } this
// "query" resolves to once awaited, keyed by table name.
function fakeClient(fixtures) {
  function makeQuery(table) {
    const result = fixtures[table] || { data: [], error: null };
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: () => Promise.resolve(result),
      then: (resolve) => resolve(result)
    };
    return query;
  }
  return { from: (table) => makeQuery(table) };
}

test("buildHub computes real wholesale_sales (buyer spend) and marketplace_sales (seller revenue) from marketplace_wholesale_orders", async () => {
  const client = fakeClient({
    bloom_customer_subscriptions: { data: [], error: null },
    bloom_loyalty_accounts: { data: [], error: null },
    bloom_membership_plans: { data: [], error: null },
    bloom_vendor_profiles: { data: [], error: null },
    bloom_purchase_orders: { data: [], error: null },
    bloom_delivery_details: { data: [], error: null },
    orders: { data: [], error: null },
    expenses: { data: [], error: null },
    marketplace_wholesale_orders: {
      // Both seller-side and buyer-side queries hit this same table name
      // in this fake — the fixture stands in for whichever the real
      // .eq("seller_shop_id"/"buyer_shop_id") filter would have returned.
      // Real amounts, only from realized statuses.
      data: [
        { total: 150, status: "completed" },
        { total: 50, status: "pending" } // must be excluded — not yet real
      ],
      error: null
    }
  });
  const hub = await buildHub(client, "shop-1");
  assert.equal(hub.kpis.wholesale_sales, 200, "both seller and buyer queries share this fixture — 150 shows on each real total, not the fabricated 0");
  assert.equal(hub.kpis.marketplace_sales, 200);
});

test("buildHub reports real $0 (not a fabricated one) when a shop genuinely has no wholesale/marketplace activity", async () => {
  const client = fakeClient({
    bloom_customer_subscriptions: { data: [], error: null },
    bloom_loyalty_accounts: { data: [], error: null },
    bloom_membership_plans: { data: [], error: null },
    bloom_vendor_profiles: { data: [], error: null },
    bloom_purchase_orders: { data: [], error: null },
    bloom_delivery_details: { data: [], error: null },
    orders: { data: [], error: null },
    expenses: { data: [], error: null },
    marketplace_wholesale_orders: { data: [], error: null }
  });
  const hub = await buildHub(client, "shop-1");
  assert.equal(hub.kpis.wholesale_sales, 0);
  assert.equal(hub.kpis.marketplace_sales, 0);
});

test("buildHub degrades to 0 (not a crash) if marketplace_wholesale_orders isn't reachable", async () => {
  const client = fakeClient({
    bloom_customer_subscriptions: { data: [], error: null },
    bloom_loyalty_accounts: { data: [], error: null },
    bloom_membership_plans: { data: [], error: null },
    bloom_vendor_profiles: { data: [], error: null },
    bloom_purchase_orders: { data: [], error: null },
    bloom_delivery_details: { data: [], error: null },
    orders: { data: [], error: null },
    expenses: { data: [], error: null },
    marketplace_wholesale_orders: { data: null, error: { code: "42P01", message: "relation does not exist" } }
  });
  const hub = await buildHub(client, "shop-1");
  assert.equal(hub.kpis.wholesale_sales, 0);
  assert.equal(hub.kpis.marketplace_sales, 0);
});
