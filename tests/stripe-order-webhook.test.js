import test from "node:test";
import assert from "node:assert/strict";

import { handleStripeOrderWebhook } from "../netlify/functions/stripe-order-webhook.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

const LIVE_KEY = "sk_live_abc123";
const TEST_KEY = "sk_test_abc123";
const ORDER_WEBHOOK_SECRET = "whsec_test";

function withEnv(vars, fn) {
  const prior = {};
  for (const [key, value] of Object.entries(vars)) {
    prior[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function postEvent(body = {}, headers = {}) {
  return {
    httpMethod: "POST",
    headers: { "stripe-signature": "sig_test", ...headers },
    body: JSON.stringify(body),
  };
}

function fakeStripe(parsedEvent, { throwOnConstruct = false } = {}) {
  return () => ({
    webhooks: {
      constructEvent() {
        if (throwOnConstruct) throw new Error("signature mismatch");
        return parsedEvent;
      },
    },
  });
}

function checkoutSessionEvent(metadata, overrides = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_1",
        payment_status: "paid",
        amount_total: 5000,
        payment_intent: "pi_1",
        metadata,
        ...overrides,
      },
    },
  };
}

test("stripe order webhook: non-POST is rejected before any config check", async () => {
  const response = await handleStripeOrderWebhook({ httpMethod: "GET", headers: {} });
  assert.equal(response.statusCode, 405);
});

test("stripe order webhook: missing config returns a 503, not a crash", () =>
  withEnv({ STRIPE_SECRET_KEY: undefined, STRIPE_ORDER_WEBHOOK_SECRET: undefined }, async () => {
    const response = await handleStripeOrderWebhook(postEvent());
    assert.equal(response.statusCode, 503);
    assert.match(JSON.parse(response.body).error, /not configured/i);
  }));

test("stripe order webhook: bad signature returns 400 without touching the database", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    let clientRequested = false;
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(null, { throwOnConstruct: true }),
      admin: () => {
        clientRequested = true;
        return createFakeSupabaseClient();
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(clientRequested, false, "should never reach the database on a bad signature");
  }));

test("stripe order webhook: livemode/key mode mismatch is rejected", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = checkoutSessionEvent({ bloom_order_id: "o1", bloom_shop_id: "s1" });
    event.livemode = true; // event claims live, but the configured key is a test key
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(event),
      admin: () => createFakeSupabaseClient(),
    });
    assert.equal(response.statusCode, 400);
    assert.match(JSON.parse(response.body).error, /livemode/i);
  }));

test("stripe order webhook: florist-network wire metadata routes to markFloristWirePaidFromCheckout", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = checkoutSessionEvent({ florist_network: "wire", florist_wire_id: "wire_1" });
    let received;
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(event),
      admin: () => createFakeSupabaseClient(),
      markFloristWirePaidFromCheckout: async (client, session) => {
        received = { client, session };
        return { ok: true };
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(received.session.id, "cs_test_1");
  }));

test("stripe order webhook: a wire-payment failure is logged and swallowed, not surfaced as a 500", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = checkoutSessionEvent({ florist_network: "wire", florist_wire_id: "wire_1" });
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(event),
      admin: () => createFakeSupabaseClient(),
      markFloristWirePaidFromCheckout: async () => {
        throw new Error("wire table missing");
      },
    });
    assert.equal(response.statusCode, 200, "Stripe must still get a 200 or it will retry forever");
  }));

test("stripe order webhook: wholesale marketplace metadata marks the wholesale order paid by session id", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = checkoutSessionEvent({ marketplace: "wholesale" });
    const client = createFakeSupabaseClient([{ data: null, error: null }]);
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(event),
      admin: () => client,
    });
    assert.equal(response.statusCode, 200);
    const call = client.calls.find((c) => c.table === "marketplace_wholesale_orders");
    assert.ok(call, "expected an update against marketplace_wholesale_orders");
    assert.equal(call.payload.status, "paid");
    const eqOp = call.ops.find(([name]) => name === "eq");
    assert.deepEqual(eqOp[1], ["metadata->>stripe_checkout_session_id", "cs_test_1"]);
  }));

test("stripe order webhook: payment-link metadata routes to postStripePaymentLink with the Stripe event id", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = checkoutSessionEvent({ bloom_payment_link_id: "link_1", bloom_shop_id: "s1" });
    let received;
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(event),
      admin: () => createFakeSupabaseClient(),
      postStripePaymentLink: async (client, session, providerEventId) => {
        received = { session, providerEventId };
        return { paid: true };
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(received.providerEventId, "evt_1");
    assert.equal(received.session.id, "cs_test_1");
  }));

test("stripe order webhook: bloom order metadata routes to postStripePayment", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = checkoutSessionEvent({ bloom_order_id: "order_1", bloom_shop_id: "shop_1" });
    let received;
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(event),
      admin: () => createFakeSupabaseClient(),
      postStripePayment: async (client, session) => {
        received = session;
        return { paid: true, amount: 50 };
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(received.id, "cs_test_1");
  }));

test("stripe order webhook: unlike wire/marketplace, a postStripePayment failure is NOT swallowed", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = checkoutSessionEvent({ bloom_order_id: "order_1", bloom_shop_id: "shop_1" });
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(event),
      admin: () => createFakeSupabaseClient(),
      postStripePayment: async () => {
        throw new Error("ledger RPC failed");
      },
    });
    // Documents real behavior: this path has no try/catch around it, so a
    // failure here surfaces as a 500 instead of a swallowed 200. Stripe
    // will retry the webhook — which is the point (money must not go
    // unrecorded silently).
    assert.equal(response.statusCode, 500);
  }));

test("stripe order webhook: session metadata that matches nothing is a clean 200 no-op", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = checkoutSessionEvent({ unrelated: "true" });
    const client = createFakeSupabaseClient();
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(event),
      admin: () => client,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(client.calls.length, 0, "no metadata matched, so no table should have been touched");
  }));

test("stripe order webhook: unrelated Stripe event types are acknowledged without dispatch", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = {
      id: "evt_2",
      type: "payment_intent.created",
      livemode: false,
      data: { object: { id: "pi_1" } },
    };
    const client = createFakeSupabaseClient();
    const response = await handleStripeOrderWebhook(postEvent(), {
      createStripe: fakeStripe(event),
      admin: () => client,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(client.calls.length, 0);
  }));
