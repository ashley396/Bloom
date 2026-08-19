import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { handleStripeOrderWebhook } from "../netlify/functions/stripe-order-webhook.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

const root = process.cwd();
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

function postEvent() {
  return { httpMethod: "POST", headers: { "stripe-signature": "sig_test" }, body: JSON.stringify({}) };
}

function fakeStripe(parsedEvent) {
  return () => ({ webhooks: { constructEvent: () => parsedEvent } });
}

function chargeEvent(type, object) {
  return { id: "evt_1", type, livemode: false, data: { object } };
}

test("stripe order webhook: a full refund on a wholesale charge marks the order refunded and records the amount", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = chargeEvent("charge.refunded", { payment_intent: "pi_1", amount: 5000, amount_refunded: 5000 });
    const client = createFakeSupabaseClient([{ data: null, error: null }]);
    const response = await handleStripeOrderWebhook(postEvent(), { createStripe: fakeStripe(event), admin: () => client });
    assert.equal(response.statusCode, 200);
    const call = client.calls.find((c) => c.table === "marketplace_wholesale_orders");
    assert.ok(call, "expected an update against marketplace_wholesale_orders");
    assert.equal(call.payload.status, "refunded");
    assert.equal(call.payload.refunded_amount, 50);
    const eqOp = call.ops.find(([name]) => name === "eq");
    assert.deepEqual(eqOp[1], ["metadata->>stripe_payment_intent", "pi_1"]);
  }));

test("stripe order webhook: a partial refund records the amount without moving the order out of its real status", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = chargeEvent("charge.refunded", { payment_intent: "pi_1", amount: 5000, amount_refunded: 1000 });
    const client = createFakeSupabaseClient([{ data: null, error: null }]);
    await handleStripeOrderWebhook(postEvent(), { createStripe: fakeStripe(event), admin: () => client });
    const call = client.calls.find((c) => c.table === "marketplace_wholesale_orders");
    assert.equal(call.payload.refunded_amount, 10);
    assert.equal("status" in call.payload, false, "a partial refund must not overwrite status");
  }));

test("stripe order webhook: a new dispute marks the order disputed", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = chargeEvent("charge.dispute.created", { payment_intent: "pi_1" });
    const client = createFakeSupabaseClient([{ data: null, error: null }]);
    await handleStripeOrderWebhook(postEvent(), { createStripe: fakeStripe(event), admin: () => client });
    const call = client.calls.find((c) => c.table === "marketplace_wholesale_orders");
    assert.equal(call.payload.status, "disputed");
    assert.ok(call.payload.disputed_at);
  }));

test("stripe order webhook: a dispute won only reverts an order this webhook itself put into 'disputed'", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = chargeEvent("charge.dispute.closed", { payment_intent: "pi_1", status: "won" });
    const client = createFakeSupabaseClient([{ data: null, error: null }]);
    await handleStripeOrderWebhook(postEvent(), { createStripe: fakeStripe(event), admin: () => client });
    const call = client.calls.find((c) => c.table === "marketplace_wholesale_orders");
    assert.equal(call.payload.status, "paid");
    const eqOps = call.ops.filter(([name]) => name === "eq");
    assert.ok(eqOps.some(([, args]) => args[0] === "status" && args[1] === "disputed"), "must guard on current status = disputed");
  }));

test("stripe order webhook: a dispute lost does not touch the order (the seller's Stripe balance already reflects it)", () =>
  withEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_ORDER_WEBHOOK_SECRET: ORDER_WEBHOOK_SECRET }, async () => {
    const event = chargeEvent("charge.dispute.closed", { payment_intent: "pi_1", status: "lost" });
    const client = createFakeSupabaseClient([{ data: null, error: null }]);
    await handleStripeOrderWebhook(postEvent(), { createStripe: fakeStripe(event), admin: () => client });
    assert.equal(client.calls.find((c) => c.table === "marketplace_wholesale_orders"), undefined);
  }));

test("migration expands order status vocabulary and adds refund/dispute tracking columns, plus a matching notification type", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260819220000_marketplace_order_refunds_disputes.sql"), "utf8");
  assert.match(sql, /'refunded', 'disputed'/);
  assert.match(sql, /refund_requested_at timestamptz/);
  assert.match(sql, /refund_requested_reason text/);
  assert.match(sql, /refunded_amount numeric/);
  assert.match(sql, /disputed_at timestamptz/);
  assert.match(sql, /'refund_requested'/);
});

test("submitRefundRequest is ownership/status-guarded and never lets the same order be requested twice", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  const fn = src.slice(src.indexOf("async function submitRefundRequest"), src.indexOf("export async function handler"));
  assert.match(fn, /order\.buyer_user_id !== user\.id/);
  assert.match(fn, /RECEIVABLE_ORDER_STATUSES\.includes\(order\.status\)/);
  assert.match(fn, /order\.refund_requested_at/);
  assert.match(fn, /notifyMarketplaceUser\(/);
});

test("seller's refund action reuses the existing Stripe Connect dashboard link — no new refund-executing API call was added", () => {
  const js = fs.readFileSync(path.join(root, "public/wholesale-seller-dashboard.js"), "utf8");
  assert.match(js, /data-wholesale-stripe-dashboard/);
  assert.match(js, /hooks\.api\('stripe-connect', \{ method: 'POST', body: JSON\.stringify\(\{ action: 'dashboard' \}\) \}\)/);
  assert.doesNotMatch(js, /stripe\.refunds\.create/);

  const backendSrc = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.doesNotMatch(backendSrc, /stripe\.refunds\.create|\.refunds\.create/);
});

test("checkout lists every unavailable cart item by name in one response instead of aborting on the first one", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-checkout.js"), "utf8");
  assert.match(src, /const unavailable = cart/);
  assert.match(src, /no longer exists/);
  assert.match(src, /is no longer available/);
  assert.match(src, /seller hasn't completed Stripe Connect onboarding/);
  assert.match(src, /items: unavailable/);
});

test("buyer UI clears only the stale cart lines a 409 actually named, and keeps everything else", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /Array\.isArray\(error\.items\) && error\.items\.length/);
  assert.match(js, /staleIds\.has\(row\.id\)/);
  assert.match(js, /data-market-refund-order/);
  assert.match(js, /action:\s*'request_refund'/);
});
