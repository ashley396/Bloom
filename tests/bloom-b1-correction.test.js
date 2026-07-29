import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  computeOrderBalance,
  syncOrderPaymentFields,
  paymentStatusLabel,
  PAYMENT_CENTER_FROM_ORDER_ATTR
} from "../netlify/functions/_shared/order-payment-display.js";

test("payment status synchronization derives PAID / PARTIAL / UNPAID from totals", () => {
  assert.deepEqual(syncOrderPaymentFields({ total: 100, amount_paid: 100, payment_status: "PARTIAL" }), {
    total: 100,
    paid: 100,
    balance: 0,
    status: "PAID"
  });
  assert.deepEqual(syncOrderPaymentFields({ total: 100, amount_paid: 40, balance_due: 60 }), {
    total: 100,
    paid: 40,
    balance: 60,
    status: "PARTIAL"
  });
  assert.equal(paymentStatusLabel("OPEN"), "UNPAID");
  assert.equal(computeOrderBalance({ total: 50, amount_paid: 10 }), 40);
});

test("orders expose Manage Payment → Payment Center wiring in app.js", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, new RegExp(PAYMENT_CENTER_FROM_ORDER_ATTR.replace(/-/g, "\\-")));
  assert.match(app, /function openPaymentCenterForOrder/);
  assert.doesNotMatch(app, /ordersCache\.find/);
  assert.match(app, /openPaymentCenterForOrder\(order\)/);
});

test("receipt print markup and print CSS target receipt region only", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /receipt-print\.css/);
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /receiptPrintRoot/);
  assert.match(app, /print-receipt-mode/);
  assert.match(app, /function printReceiptOnly/);
  const css = fs.readFileSync(new URL("../public/receipt-print.css", import.meta.url), "utf8");
  assert.match(css, /print-receipt-mode/);
  assert.match(css, /80mm/);
  assert.match(css, /dialog-tools/);
});
