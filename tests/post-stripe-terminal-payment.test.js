/**
 * Behavior tests for postStripeTerminalPayment — the Terminal (card-
 * present) counterpart to post-stripe-payment.js's Checkout Session path.
 * Same pattern as tests/post-stripe-payment.test.js: assert on the real
 * RPC call a fake Supabase client actually recorded, not on source text.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { postStripeTerminalPayment } from "../netlify/functions/_shared/post-stripe-terminal-payment.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

test("postStripeTerminalPayment: a PaymentIntent that isn't succeeded yet is a no-op, not a database write", async () => {
  const client = createFakeSupabaseClient();
  const result = await postStripeTerminalPayment(client, { status: "requires_payment_method", metadata: {} });
  assert.deepEqual(result, { paid: false });
  assert.equal(client.calls.length, 0);
});

test("postStripeTerminalPayment: a succeeded intent missing Florisyn order metadata throws instead of posting a mystery payment", async () => {
  const client = createFakeSupabaseClient();
  await assert.rejects(
    () => postStripeTerminalPayment(client, { status: "succeeded", amount: 1000, metadata: {} }),
    /order metadata/i
  );
});

test("postStripeTerminalPayment: posts to the same ledger RPC every other payment method uses, tagged as a terminal Stripe payment", async () => {
  const client = createFakeSupabaseClient([{ data: { ok: true, order_status: "PAID" }, error: null }]);
  const intent = {
    id: "pi_terminal_123",
    status: "succeeded",
    amount: 4550,
    metadata: { bloom_order_id: "order_1", bloom_shop_id: "shop_1", bloom_actor_user_id: "user_1", channel: "terminal" }
  };

  const result = await postStripeTerminalPayment(client, intent);

  assert.equal(result.paid, true);
  assert.equal(result.amount, 45.5);
  assert.equal(result.ok, true);

  const rpcCall = client.calls.find((c) => c.rpc === "post_order_payment");
  assert.ok(rpcCall, "expected a post_order_payment RPC call");
  assert.equal(rpcCall.args.p_shop_id, "shop_1");
  assert.equal(rpcCall.args.p_order_id, "order_1");
  assert.equal(rpcCall.args.p_amount, 45.5);
  // Never a new payments.method value — the DB check constraint only
  // allows 'Stripe' among card-processor methods, and this genuinely is
  // one; channel:"terminal" in metadata is what distinguishes it.
  assert.equal(rpcCall.args.p_method, "Stripe");
  assert.equal(rpcCall.args.p_idempotency_key, "stripe-terminal:pi_terminal_123");
  assert.equal(rpcCall.args.p_processor, "stripe");
  assert.equal(rpcCall.args.p_processor_session_id, null);
  assert.equal(rpcCall.args.p_processor_payment_intent_id, "pi_terminal_123");
  assert.equal(rpcCall.args.p_metadata.channel, "terminal");
});

test("postStripeTerminalPayment: a caller-supplied idempotency key overrides the intent-id default", async () => {
  const client = createFakeSupabaseClient([{ data: {}, error: null }]);
  const intent = {
    id: "pi_456",
    status: "succeeded",
    amount: 1000,
    metadata: { bloom_order_id: "order_2", bloom_shop_id: "shop_2", bloom_idempotency_key: "custom-key-1" }
  };
  await postStripeTerminalPayment(client, intent);
  const rpcCall = client.calls.find((c) => c.rpc === "post_order_payment");
  assert.equal(rpcCall.args.p_idempotency_key, "custom-key-1");
});

test("postStripeTerminalPayment: an RPC error propagates instead of being swallowed as a silent success", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: new Error("ledger locked") }]);
  const intent = {
    id: "pi_789",
    status: "succeeded",
    amount: 1000,
    metadata: { bloom_order_id: "order_3", bloom_shop_id: "shop_3" }
  };
  await assert.rejects(() => postStripeTerminalPayment(client, intent), /ledger locked/);
});
