/**
 * Behavior tests for postStripePayment — this used to only be covered by a
 * regex assertion against the file's source text ("does the string
 * p_idempotency_key appear somewhere"). That passes even if the value
 * passed were wrong, or the function stopped calling the RPC at all in a
 * refactor. These tests actually invoke the function against a fake
 * Supabase client and assert on the real call it makes.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { postStripePayment } from "../netlify/functions/_shared/post-stripe-payment.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

test("postStripePayment: an unpaid session is a no-op, not a database write", async () => {
  const client = createFakeSupabaseClient();
  const result = await postStripePayment(client, { payment_status: "unpaid", metadata: {} });
  assert.deepEqual(result, { paid: false });
  assert.equal(client.calls.length, 0);
});

test("postStripePayment: a paid session missing Florisyn order metadata throws instead of posting a mystery payment", async () => {
  const client = createFakeSupabaseClient();
  await assert.rejects(
    () => postStripePayment(client, { payment_status: "paid", amount_total: 1000, metadata: {} }),
    /order metadata/i,
  );
});

test("postStripePayment: posts to the ledger RPC with a session-derived idempotency key and dollar amount", async () => {
  const client = createFakeSupabaseClient([{ data: { ok: true, order_status: "PAID" }, error: null }]);
  const session = {
    id: "cs_test_123",
    payment_status: "paid",
    amount_total: 4599,
    payment_intent: "pi_abc",
    metadata: { bloom_order_id: "order_1", bloom_shop_id: "shop_1" },
  };

  const result = await postStripePayment(client, session);

  assert.equal(result.paid, true);
  assert.equal(result.amount, 45.99);
  assert.equal(result.ok, true);

  const rpcCall = client.calls.find((c) => c.rpc === "post_order_payment");
  assert.ok(rpcCall, "expected a post_order_payment RPC call");
  assert.equal(rpcCall.args.p_shop_id, "shop_1");
  assert.equal(rpcCall.args.p_order_id, "order_1");
  assert.equal(rpcCall.args.p_amount, 45.99);
  assert.equal(rpcCall.args.p_method, "Stripe");
  assert.equal(rpcCall.args.p_idempotency_key, "stripe-session:cs_test_123");
  assert.equal(rpcCall.args.p_processor, "stripe");
  assert.equal(rpcCall.args.p_processor_session_id, "cs_test_123");
  assert.equal(rpcCall.args.p_processor_payment_intent_id, "pi_abc");
});

test("postStripePayment: a caller-supplied idempotency key overrides the session-derived default", async () => {
  const client = createFakeSupabaseClient([{ data: {}, error: null }]);
  const session = {
    id: "cs_test_456",
    payment_status: "paid",
    amount_total: 1000,
    metadata: {
      bloom_order_id: "order_2",
      bloom_shop_id: "shop_2",
      bloom_idempotency_key: "custom-key-1",
    },
  };
  await postStripePayment(client, session);
  const rpcCall = client.calls.find((c) => c.rpc === "post_order_payment");
  assert.equal(rpcCall.args.p_idempotency_key, "custom-key-1");
});

test("postStripePayment: an RPC error propagates instead of being swallowed as a silent success", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: new Error("ledger locked") }]);
  const session = {
    id: "cs_test_789",
    payment_status: "paid",
    amount_total: 1000,
    metadata: { bloom_order_id: "order_3", bloom_shop_id: "shop_3" },
  };
  await assert.rejects(() => postStripePayment(client, session), /ledger locked/);
});
