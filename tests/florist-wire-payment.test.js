import test from "node:test";
import assert from "node:assert/strict";
import {
  canInitiateWirePayment,
  stripeApplicationFeeCents,
  partnerCanReceiveWirePayments,
  buildWireCheckoutMetadata,
} from "../lib/florist-network/wire-payment.js";
import { FLORISYN_WIRE_PLATFORM_FEE_PERCENT } from "../lib/florist-network/wire-orders.js";

test("wire Stripe checkout uses zero Florisyn application fee", () => {
  assert.equal(FLORISYN_WIRE_PLATFORM_FEE_PERCENT, 0);
  assert.equal(stripeApplicationFeeCents(125), 0);
  assert.equal(stripeApplicationFeeCents(999.99), 0);
});

test("sending shop can pay unpaid sent wires", () => {
  const ok = canInitiateWirePayment(
    { id: "w1", sending_shop_id: "shop-a", status: "sent", wire_amount: 80, payment_status: "unpaid" },
    "shop-a"
  );
  assert.equal(ok.ok, true);
  assert.equal(canInitiateWirePayment({ payment_status: "paid", sending_shop_id: "shop-a", wire_amount: 80 }, "shop-a").ok, false);
  assert.equal(canInitiateWirePayment({ sending_shop_id: "shop-b", wire_amount: 80 }, "shop-a").ok, false);
});

test("partner Stripe Connect required to receive online wire pay", () => {
  assert.equal(partnerCanReceiveWirePayments({ stripe_connect_account_id: "acct_123" }), true);
  assert.equal(partnerCanReceiveWirePayments({ stripe_connect_account_id: "" }), false);
});

test("wire checkout metadata tags florist network settlement", () => {
  const meta = buildWireCheckoutMetadata(
    { id: "wire-1", wire_number: "FN-ABC" },
    { sendingShopId: "s1", fulfillingShopId: "s2" }
  );
  assert.equal(meta.florist_network, "wire");
  assert.equal(meta.florist_wire_id, "wire-1");
  assert.equal(meta.florisyn_platform_fee_percent, "0");
});
