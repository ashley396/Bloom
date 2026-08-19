import test from "node:test";
import assert from "node:assert/strict";

import { handleStripeSubscriptionWebhook } from "../netlify/functions/stripe-subscription-webhook.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

function postEvent(headers = {}) {
  return { headers: { "stripe-signature": "sig_test", ...headers }, body: "{}" };
}

function fakeEnv(secret) {
  return (name) => {
    if (name === "STRIPE_WEBHOOK_SECRET") return secret;
    throw new Error(`unexpected env lookup: ${name}`);
  };
}

test("stripe subscription webhook: missing signature header is rejected before touching Stripe", async () => {
  const response = await handleStripeSubscriptionWebhook({ headers: {}, body: "{}" });
  assert.equal(response.statusCode, 400);
});

test("stripe subscription webhook: signature verification failure returns 400, not a crash", async () => {
  const response = await handleStripeSubscriptionWebhook(postEvent(), {
    createStripe: () => ({
      webhooks: {
        constructEvent() {
          throw new Error("bad signature");
        },
      },
    }),
    env: fakeEnv("whsec_test"),
  });
  assert.equal(response.statusCode, 400);
});

test("stripe subscription webhook: checkout.session.completed upserts shop_subscriptions from the retrieved subscription", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const stripeEvent = {
    type: "checkout.session.completed",
    data: {
      object: {
        metadata: { shop_id: "shop_1", plan_code: "premium" },
        subscription: "sub_1",
        customer: "cus_1",
      },
    },
  };
  const response = await handleStripeSubscriptionWebhook(postEvent(), {
    createStripe: () => ({
      webhooks: { constructEvent: () => stripeEvent },
      subscriptions: {
        retrieve: async (id) => ({
          id,
          status: "active",
          metadata: {},
          items: { data: [{ price: { id: "price_1" } }] },
          trial_end: null,
          current_period_end: 1_700_000_000,
          cancel_at_period_end: false,
        }),
      },
    }),
    admin: () => client,
    env: fakeEnv("whsec_test"),
  });

  assert.equal(response.statusCode, 200);
  const call = client.calls.find((c) => c.table === "shop_subscriptions");
  assert.ok(call, "expected an upsert against shop_subscriptions");
  assert.equal(call.ops[0][0], "upsert");
  assert.equal(call.payload.shop_id, "shop_1");
  assert.equal(call.payload.plan_code, "premium");
  assert.equal(call.payload.status, "active");
  assert.equal(call.payload.stripe_subscription_id, "sub_1");
  assert.equal(call.payload.stripe_price_id, "price_1");
});

test("stripe subscription webhook: checkout.session.completed without a shop_id metadata is a no-op", async () => {
  const client = createFakeSupabaseClient();
  const stripeEvent = {
    type: "checkout.session.completed",
    data: { object: { metadata: {}, subscription: "sub_1", customer: "cus_1" } },
  };
  const response = await handleStripeSubscriptionWebhook(postEvent(), {
    createStripe: () => ({ webhooks: { constructEvent: () => stripeEvent } }),
    admin: () => client,
    env: fakeEnv("whsec_test"),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(client.calls.length, 0);
});

test("stripe subscription webhook: customer.subscription.updated updates status by shop_id", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const stripeEvent = {
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1",
        status: "past_due",
        customer: "cus_1",
        metadata: { shop_id: "shop_1" },
        items: { data: [{ price: { id: "price_1" } }] },
        current_period_end: 1_700_000_000,
        cancel_at_period_end: true,
      },
    },
  };
  const response = await handleStripeSubscriptionWebhook(postEvent(), {
    createStripe: () => ({ webhooks: { constructEvent: () => stripeEvent } }),
    admin: () => client,
    env: fakeEnv("whsec_test"),
  });
  assert.equal(response.statusCode, 200);
  const call = client.calls.find((c) => c.table === "shop_subscriptions");
  assert.equal(call.payload.status, "past_due");
  const eqOp = call.ops.find(([name]) => name === "eq");
  assert.deepEqual(eqOp[1], ["shop_id", "shop_1"]);
});

test("stripe subscription webhook: customer.subscription.deleted without shop_id metadata does not touch the database", async () => {
  const client = createFakeSupabaseClient();
  const stripeEvent = {
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_1", status: "canceled", customer: "cus_1", metadata: {} } },
  };
  const response = await handleStripeSubscriptionWebhook(postEvent(), {
    createStripe: () => ({ webhooks: { constructEvent: () => stripeEvent } }),
    admin: () => client,
    env: fakeEnv("whsec_test"),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(client.calls.length, 0);
});
