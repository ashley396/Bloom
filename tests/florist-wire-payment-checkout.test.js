/**
 * markFloristWirePaidFromCheckout behavior tests. Kept separate from
 * tests/florist-wire-payment.test.js, which covers the pure
 * lib/florist-network/wire-payment.js helpers — this file covers the
 * database-facing webhook-completion function in
 * netlify/functions/_shared/florist-wire-payment.js.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { markFloristWirePaidFromCheckout } from "../netlify/functions/_shared/florist-wire-payment.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

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
