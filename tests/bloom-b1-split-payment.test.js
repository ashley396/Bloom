import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  validateSplitPaymentParts,
  derivePaymentTotalsFromOrder,
  buildSplitPartMetadata
} from "../netlify/functions/_shared/manual-order-payment.js";
import {
  executePostOrderPayment,
  isPostOrderPaymentRpcMissing,
  postOrderPaymentFallback
} from "../netlify/functions/_shared/post-order-payment-execute.js";
import { syncOrderPaymentFields } from "../netlify/functions/_shared/order-payment-display.js";

const ORDER = {
  id: "11111111-1111-4111-8111-111111111111",
  total: 100,
  amount_paid: 0,
  balance_due: 100,
  payment_status: "UNPAID"
};

function receiptTenderLines(payments) {
  return (payments || []).map((p) => ({
    label: p.metadata?.tender_label || p.method,
    amount: p.amount,
    note: p.metadata?.note || ""
  }));
}

test("Cash + Card pays full balance (manual part only until card checkout)", () => {
  const plan = validateSplitPaymentParts(ORDER, [
    { method: "Cash", amount: 40 },
    { method: "Card", amount: 60 }
  ]);
  assert.equal(plan.valid, true);
  assert.equal(plan.splitTotal, 100);
  assert.equal(plan.splitTotalManual, 40);
  assert.equal(plan.remainingAfter, 60);
});

test("Cash + Check leaves partial balance", () => {
  const plan = validateSplitPaymentParts(ORDER, [
    { method: "Cash", amount: 30 },
    { method: "Check", amount: 20, note: "Check #4412" }
  ]);
  assert.equal(plan.valid, true);
  assert.equal(plan.splitTotalManual, 50);
  assert.equal(plan.remainingAfter, 50);
  const meta = buildSplitPartMetadata({ index: 1, method: "Check", amount: 20, note: "Check #4412" }, "batch-1");
  assert.equal(meta.note, "Check #4412");
});

test("Two card payments validate total against balance", () => {
  const plan = validateSplitPaymentParts(ORDER, [
    { method: "Card", amount: 55 },
    { method: "Card", amount: 45 }
  ]);
  assert.equal(plan.valid, true);
  assert.equal(plan.splitTotal, 100);
  assert.equal(plan.splitTotalManual, 0);
  assert.equal(plan.cardParts.length, 2);
});

test("split total greater than balance is rejected", () => {
  const plan = validateSplitPaymentParts(ORDER, [
    { method: "Cash", amount: 70 },
    { method: "Card", amount: 40 }
  ]);
  assert.equal(plan.valid, false);
  assert.match(plan.errors[0], /cannot exceed/i);
});

test("isPostOrderPaymentRpcMissing detects PGRST202", () => {
  assert.equal(isPostOrderPaymentRpcMissing({ code: "PGRST202", message: "whatever" }), true);
  assert.equal(
    isPostOrderPaymentRpcMissing({ message: "Could not find the function public.post_order_payment" }),
    true
  );
});

test("executePostOrderPayment uses fallback when RPC missing", async () => {
  const order = { ...ORDER, customer_id: null, paid_at: null };
  let rpcCalled = false;
  const service = {
    rpc: async () => {
      rpcCalled = true;
      return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    },
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === "payments") return { data: null, error: null };
          if (table === "orders") return { data: order, error: null };
          return { data: null, error: null };
        },
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: "pay-1", method: "Cash", amount: 25, metadata: {} },
              error: null
            })
          })
        }),
        update: () => {
          const upd = {
            eq: () => upd,
            select: () => ({
              single: async () => ({
                data: {
                  ...order,
                  amount_paid: 25,
                  balance_due: 75,
                  payment_status: "PARTIAL"
                },
                error: null
              })
            })
          };
          return upd;
        }
      };
      return chain;
    }
  };
  const result = await executePostOrderPayment(service, {
    p_shop_id: "22222222-2222-4222-8222-222222222222",
    p_order_id: order.id,
    p_amount: 25,
    p_method: "Cash",
    p_idempotency_key: "idem-fallback-1",
    p_actor_user_id: "33333333-3333-4333-8333-333333333333",
    p_processor: "manual",
    p_processor_session_id: null,
    p_processor_payment_intent_id: null,
    p_metadata: { source: "test" }
  });
  assert.equal(rpcCalled, true);
  assert.equal(result.via, "fallback");
  assert.equal(result.order.balance_due, 75);
});

test("duplicate submission returns duplicate via fallback idempotency row", async () => {
  const existingPayment = { id: "pay-dup", amount: 10, method: "Cash" };
  const order = { ...ORDER, amount_paid: 10, balance_due: 90, payment_status: "PARTIAL" };
  const service = {
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === "payments") return { data: existingPayment, error: null };
          if (table === "orders") return { data: order, error: null };
          return { data: null, error: null };
        }
      };
      return chain;
    }
  };
  const result = await postOrderPaymentFallback(service, {
    p_shop_id: "22222222-2222-4222-8222-222222222222",
    p_order_id: order.id,
    p_amount: 10,
    p_method: "Cash",
    p_idempotency_key: "idem-dup",
    p_actor_user_id: null,
    p_processor: "manual",
    p_metadata: {}
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.payment.id, "pay-dup");
});

test("receipt lists separate tenders", () => {
  const lines = receiptTenderLines([
    { method: "Cash", amount: 40, metadata: {} },
    { method: "Check", amount: 35, metadata: { note: "4412" } },
    { method: "Other", amount: 25, metadata: { tender_label: "House Account" } }
  ]);
  assert.deepEqual(lines, [
    { label: "Cash", amount: 40, note: "" },
    { label: "Check", amount: 35, note: "4412" },
    { label: "House Account", amount: 25, note: "" }
  ]);
});

test("order status and balance sync after split-style partial pay", () => {
  const after = syncOrderPaymentFields({
    total: 100,
    amount_paid: 50,
    balance_due: 50,
    payment_status: "PARTIAL"
  });
  assert.equal(after.status, "PARTIAL");
  assert.equal(after.balance, 50);
  const totals = derivePaymentTotalsFromOrder({ total: 100, amount_paid: 50, balance_due: 50, payment_status: "PARTIAL" });
  assert.equal(totals.balance, 50);
});

test("payments handler exposes split action and executePostOrderPayment", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/payments.js", import.meta.url), "utf8");
  assert.match(src, /action === "split"/);
  assert.match(src, /executePostOrderPayment/);
  assert.match(src, /failed_part/);
});

test("split failure response includes failed part index (handler contract)", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/payments.js", import.meta.url), "utf8");
  assert.match(src, /Split payment stopped/);
  assert.match(src, /failed_part/);
  assert.match(src, /completed_parts/);
});

test("split UI wired inline in Payment Center", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /data-payment-mode="split"/);
  assert.match(html, /id="paymentFlowSplit"/);
  assert.match(js, /submitSplitPayment/);
  assert.match(js, /openReceiptWithPayments/);
});
