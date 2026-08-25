/**
 * markFloristWirePaidFromCheckout behavior tests. Kept separate from
 * tests/florist-wire-payment.test.js, which covers the pure
 * lib/florist-network/wire-payment.js helpers — this file covers the
 * database-facing webhook-completion function in
 * netlify/functions/_shared/florist-wire-payment.js.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { markFloristWirePaidFromCheckout, createFloristWireCheckoutSession } from "../netlify/functions/_shared/florist-wire-payment.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

function fakeStripe(sessionOverrides = {}) {
  const calls = [];
  return {
    calls,
    checkout: {
      sessions: {
        create(params) {
          calls.push(params);
          return Promise.resolve({ id: "cs_test_123", payment_intent: "pi_test_123", ...sessionOverrides });
        },
      },
    },
  };
}

test("markFloristWirePaidFromCheckout: a session with no wire metadata is a no-op", async () => {
  const client = createFakeSupabaseClient();
  const result = await markFloristWirePaidFromCheckout(client, { id: "cs_1", metadata: {} });
  assert.deepEqual(result, { ok: false, reason: "not_wire" });
  assert.equal(client.calls.length, 0);
});

test("markFloristWirePaidFromCheckout: an unknown wire id is reported, not thrown", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await markFloristWirePaidFromCheckout(client, {
    id: "cs_1",
    metadata: { florist_network: "wire", florist_wire_id: "missing_wire" },
  });
  assert.deepEqual(result, { ok: false, reason: "wire_not_found" });
});

test("markFloristWirePaidFromCheckout: a wire already marked paid is idempotent and skips the write", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "wire_1", metadata: {}, payment_status: "paid" }, error: null },
  ]);
  const result = await markFloristWirePaidFromCheckout(client, {
    id: "cs_1",
    metadata: { florist_network: "wire", florist_wire_id: "wire_1" },
  });
  assert.deepEqual(result, { ok: true, already: true });
  // Only the lookup happened — no update call was queued/consumed.
  assert.equal(client.calls.length, 1);
});

test("markFloristWirePaidFromCheckout: marks the wire paid and preserves prior metadata", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "wire_1", metadata: { wire_number: "W-100" }, payment_status: "pending" }, error: null },
    { data: null, error: null },
  ]);
  const result = await markFloristWirePaidFromCheckout(client, {
    id: "cs_test_1",
    payment_intent: "pi_1",
    metadata: { florist_network: "wire", florist_wire_id: "wire_1" },
  });
  assert.deepEqual(result, { ok: true, wire_id: "wire_1" });

  const updateCall = client.calls.find((c) => c.table === "florist_wire_orders" && c.payload?.payment_status);
  assert.ok(updateCall, "expected an update against florist_wire_orders");
  assert.equal(updateCall.payload.payment_status, "paid");
  assert.equal(updateCall.payload.stripe_checkout_session_id, "cs_test_1");
  assert.equal(updateCall.payload.metadata.wire_number, "W-100", "prior metadata must be preserved, not overwritten");
  assert.equal(updateCall.payload.metadata.stripe_payment_intent, "pi_1");
  assert.equal(updateCall.payload.metadata.florisyn_platform_fee, 0);
});

// createFloristWireCheckoutSession had zero direct coverage — everything
// below it (the wire split math, zero platform fee) was tested, but never
// what it actually hands to Stripe.

test("createFloristWireCheckoutSession: charges only the fulfilling shop's share, in cents, never the full wire amount", async () => {
  const stripe = fakeStripe();
  const { settlement } = await createFloristWireCheckoutSession(stripe, {
    wire: { id: "wire-1", wire_number: "FN-100", wire_amount: 100, sending_shop_percent: 20 },
    sendingShopId: "shop-a",
    fulfillingShopId: "shop-b",
    fulfillingConnectAccountId: "acct_partner",
    customerEmail: "florist@example.com",
    siteUrl: "https://florisyn-staging.netlify.app",
  });
  const params = stripe.calls[0];
  assert.equal(params.line_items[0].price_data.unit_amount, 8000, "80% of $100 in cents");
  assert.equal(settlement.fulfilling_shop_amount, 80);
  assert.equal(settlement.sending_shop_amount, 20);
});

test("createFloristWireCheckoutSession: routes the Connect transfer to the fulfilling shop's real account with zero Florisyn application fee", async () => {
  const stripe = fakeStripe();
  await createFloristWireCheckoutSession(stripe, {
    wire: { id: "wire-2", wire_number: "FN-200", wire_amount: 50, sending_shop_percent: 0 },
    sendingShopId: "shop-a",
    fulfillingShopId: "shop-b",
    fulfillingConnectAccountId: "acct_partner_2",
    customerEmail: "florist@example.com",
    siteUrl: "https://florisyn-staging.netlify.app",
  });
  const params = stripe.calls[0];
  assert.equal(params.payment_intent_data.transfer_data.destination, "acct_partner_2");
  assert.equal(params.payment_intent_data.application_fee_amount, 0);
});

test("createFloristWireCheckoutSession: tags both top-level and payment-intent metadata with the real wire settlement", async () => {
  const stripe = fakeStripe();
  await createFloristWireCheckoutSession(stripe, {
    wire: { id: "wire-3", wire_number: "FN-300", wire_amount: 75, sending_shop_percent: 10 },
    sendingShopId: "shop-a",
    fulfillingShopId: "shop-b",
    fulfillingConnectAccountId: "acct_partner_3",
    customerEmail: "florist@example.com",
    siteUrl: "https://florisyn-staging.netlify.app",
  });
  const params = stripe.calls[0];
  assert.equal(params.metadata.florist_wire_id, "wire-3");
  assert.equal(params.metadata.florist_network, "wire");
  assert.deepEqual(params.payment_intent_data.metadata, params.metadata, "top-level and payment-intent metadata must match, so the webhook can key off either");
});

test("createFloristWireCheckoutSession: success/cancel URLs are built from the real siteUrl and wire id", async () => {
  const stripe = fakeStripe();
  await createFloristWireCheckoutSession(stripe, {
    wire: { id: "wire with spaces", wire_number: "FN-400", wire_amount: 20, sending_shop_percent: 0 },
    sendingShopId: "shop-a",
    fulfillingShopId: "shop-b",
    fulfillingConnectAccountId: "acct_partner_4",
    customerEmail: "florist@example.com",
    siteUrl: "https://florisyn.com",
  });
  const params = stripe.calls[0];
  assert.match(params.success_url, /^https:\/\/florisyn\.com\/\?florist_wire=success&wire=wire%20with%20spaces$/);
  assert.match(params.cancel_url, /^https:\/\/florisyn\.com\/\?florist_wire=cancelled&wire=wire%20with%20spaces$/);
});
