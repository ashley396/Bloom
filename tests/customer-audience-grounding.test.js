import test from "node:test";
import assert from "node:assert/strict";
import { loadCustomerAudienceSummary } from "../netlify/functions/_shared/customer-audience-grounding.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Phase 7 ("Customer/CRM intelligence") of the Lily Connected Intelligence
// pass. This composes the existing, already-tested buildAudienceSegments()
// (lib/marketing/audience-segments.js) — these tests prove the loader's own
// contract (feature gating, PII-safe shape, graceful degradation), not the
// segmentation math itself.

const oneSubscriber = { id: "c1", vip: true, created_at: "2020-01-01T00:00:00Z", contact_preferences: { marketing_opt_in: true } };

test("loadCustomerAudienceSummary: real subscriber/segment counts, scoped to the shop", async () => {
  const client = createFakeSupabaseClient([
    { data: [oneSubscriber], error: null }, // customers
    { data: [], error: null } // orders
  ]);
  const result = await loadCustomerAudienceSummary(client, "shop-1");
  assert.equal(result.enabled, true);
  assert.equal(result.subscriberCount, 1);
  const vip = result.segments.find((s) => s.key === "vip");
  assert.equal(vip.count, 1);

  const customersCall = client.calls.find((c) => c.table === "customers");
  assert.ok(customersCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-1"));
});

test("loadCustomerAudienceSummary: never returns a customer id, name, birthday, or contact detail — counts only", async () => {
  const client = createFakeSupabaseClient([
    { data: [oneSubscriber], error: null },
    { data: [], error: null }
  ]);
  const result = await loadCustomerAudienceSummary(client, "shop-1");
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /"c1"/);
  assert.doesNotMatch(json, /marketing_opt_in/);
  for (const segment of result.segments) {
    assert.deepEqual(Object.keys(segment).sort(), ["count", "key", "label"]);
  }
});

test("loadCustomerAudienceSummary: an empty shop (no customers) returns an honestly empty summary, never fabricated segments", async () => {
  const client = createFakeSupabaseClient([
    { data: [], error: null },
    { data: [], error: null }
  ]);
  const result = await loadCustomerAudienceSummary(client, "shop-1");
  assert.equal(result.enabled, true);
  assert.equal(result.subscriberCount, 0);
  assert.ok(result.segments.every((s) => s.count === 0));
});

test("loadCustomerAudienceSummary: a real DB error degrades to an honest empty result instead of throwing and breaking the rest of Lily's context", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: new Error("connection reset") },
    { data: [], error: null }
  ]);
  const result = await loadCustomerAudienceSummary(client, "shop-1");
  assert.deepEqual(result, { enabled: false, subscriberCount: 0, segments: [] });
});

test("loadCustomerAudienceSummary: a shop with Marketing Campaigns disabled pays zero query cost — never touches customers/orders", async () => {
  const prior = process.env.FLORISYN_FLAG_MARKETING_CAMPAIGNS;
  process.env.FLORISYN_FLAG_MARKETING_CAMPAIGNS = "false";
  try {
    const client = createFakeSupabaseClient([]);
    const result = await loadCustomerAudienceSummary(client, "shop-1");
    assert.deepEqual(result, { enabled: false, subscriberCount: 0, segments: [] });
    assert.equal(client.calls.length, 0, "must not issue any query when the feature is off");
  } finally {
    if (prior === undefined) delete process.env.FLORISYN_FLAG_MARKETING_CAMPAIGNS;
    else process.env.FLORISYN_FLAG_MARKETING_CAMPAIGNS = prior;
  }
});
