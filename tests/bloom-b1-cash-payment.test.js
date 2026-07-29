import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  validateManualPaymentBody,
  normalizeMethodForPaymentsTable,
  buildPostOrderPaymentRpcArgs,
  mapManualPaymentError,
  applyOrderPaymentFromRpcResult,
  derivePaymentTotalsFromOrder
} from "../netlify/functions/_shared/manual-order-payment.js";
import { syncOrderPaymentFields } from "../netlify/functions/_shared/order-payment-display.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

test("full cash payment payload validates and maps Cash for RPC", () => {
  const v = validateManualPaymentBody({
    order_id: ORDER_ID,
    amount: 85,
    method: "Cash",
    idempotency_key: "idem-full-1"
  });
  assert.equal(v.valid, true);
  assert.equal(v.methodForRpc, "Cash");
  const args = buildPostOrderPaymentRpcArgs({
    shopId: "22222222-2222-4222-8222-222222222222",
    orderId: v.orderId,
    amount: v.amount,
    methodForRpc: v.methodForRpc,
    idempotencyKey: v.idempotencyKey,
    actorUserId: "33333333-3333-4333-8333-333333333333",
    metadata: v.metadata
  });
  assert.equal(args.p_method, "Cash");
  assert.equal(args.p_amount, 85);
  assert.equal(args.p_processor, "manual");
  assert.ok(args.p_idempotency_key);
});

test("partial cash payment accepts amount below total", () => {
  const v = validateManualPaymentBody({ order_id: ORDER_ID, amount: 20, method: "Cash" });
  assert.equal(v.valid, true);
  assert.equal(v.amount, 20);
});

test("walk-in order payment uses same validation as named customer", () => {
  const v = validateManualPaymentBody({
    order_id: ORDER_ID,
    amount: 12.5,
    method: "Cash"
  });
  assert.equal(v.valid, true);
});

test("missing order id is rejected before RPC", () => {
  const v = validateManualPaymentBody({ amount: 10, method: "Cash" });
  assert.equal(v.valid, false);
  assert.match(v.errors[0], /order/i);
});

test("invalid amount is rejected", () => {
  const v = validateManualPaymentBody({ order_id: ORDER_ID, amount: 0, method: "Cash" });
  assert.equal(v.valid, false);
});

test("payment status and balance sync after partial and full pay", () => {
  const partial = syncOrderPaymentFields({ total: 100, amount_paid: 40, balance_due: 60, payment_status: "PARTIAL" });
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.balance, 60);
  const full = syncOrderPaymentFields({ total: 100, amount_paid: 100, balance_due: 0, payment_status: "PARTIAL" });
  assert.equal(full.status, "PAID");
  assert.equal(full.balance, 0);
});

test("RPC result exposes order for frontend pending payment update", () => {
  const order = { id: ORDER_ID, total: 50, amount_paid: 50, balance_due: 0, payment_status: "PAID", customer_name: "Walk-in Customer" };
  const parsed = applyOrderPaymentFromRpcResult({ order, payment: { id: "pay-1" }, duplicate: false });
  assert.equal(parsed.order.customer_name, "Walk-in Customer");
  assert.equal(derivePaymentTotalsFromOrder(parsed.order).status, "PAID");
});

test("permission denied on post_order_payment maps to safe message", () => {
  const mapped = mapManualPaymentError({ message: "permission denied for function post_order_payment" });
  assert.equal(mapped.statusCode, 503);
  assert.match(mapped.message, /secure server connection/i);
});

test("payments function uses service role and executePostOrderPayment after shop check", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/payments.js", import.meta.url), "utf8");
  assert.match(src, /resolveServiceClient/);
  assert.match(src, /executePostOrderPayment/);
  assert.match(src, /\.eq\("shop_id", shopId\)/);
});

test("PGRST202 maps to payment posting unavailable when RPC path fails without fallback", () => {
  const mapped = mapManualPaymentError({ code: "PGRST202", message: "Could not find the function" });
  assert.equal(mapped.statusCode, 503);
  assert.match(mapped.message, /Payment posting is not available/i);
});

test("House Account tender maps to Other for payments table constraint", () => {
  assert.equal(normalizeMethodForPaymentsTable("House Account"), "Other");
  const v = validateManualPaymentBody({ order_id: ORDER_ID, amount: 5, method: "House Account" });
  assert.equal(v.methodForRpc, "Other");
  assert.equal(v.metadata.tender_label, "House Account");
});
