import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  defaultCashPaymentAmount,
  computeCashChange,
  PAYMENT_CENTER_PANEL_IDS,
  PAYMENT_CENTER_PRIMARY_METHODS
} from "../netlify/functions/_shared/payment-center-ux.js";
import { PAYMENT_CENTER_FROM_ORDER_ATTR } from "../netlify/functions/_shared/order-payment-display.js";

test("default cash payment amount uses remaining balance", () => {
  assert.equal(defaultCashPaymentAmount(84.5), 84.5);
  assert.equal(defaultCashPaymentAmount(0), 0);
});

test("partial cash payment and change-due calculation", () => {
  assert.equal(computeCashChange(100, 84.5), 15.5);
  assert.equal(computeCashChange(50, 84.5), 0);
  assert.equal(computeCashChange(84.5, 84.5), 0);
});

test("Manage Payment opens Payment Center for selected order", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /function openPaymentCenterForOrder/);
  assert.match(app, new RegExp(PAYMENT_CENTER_FROM_ORDER_ATTR.replace(/-/g, "\\-")));
  assert.match(app, /paymentReturnOrderId=order\.id/);
  assert.match(app, /setPaymentCenterMode\("methods"\)/);
});

test("Back to Order navigation from Payment Center", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /function returnFromPaymentCenter/);
  assert.match(app, /paymentCenterBackOrder/);
  assert.match(app, /showPage\("ordersPage"\)/);
});

test("Split Payment visible on primary method picker without hub tabs", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /data-payment-mode="split"/);
  assert.match(html, /Split Payment/);
  assert.match(html, /payment-center-page/);
  assert.doesNotMatch(html, /payment-hub-tabs/);
  assert.doesNotMatch(app, /openSplitPaymentDialog/);
  assert.match(app, /paymentFlowSplit/);
});

test("payment history separated from active payment form", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /id="paymentHistorySection"/);
  assert.match(html, /id="paymentHistoryBody"/);
  assert.match(app, /function refreshPaymentHistory/);
  assert.match(app, /paymentFlowCash/);
  for (const id of Object.values(PAYMENT_CENTER_PANEL_IDS)) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("duplicate-submit prevention disables primary payment actions", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /paymentCenterProcessing/);
  assert.match(app, /function setPaymentProcessing/);
  assert.match(app, /completeCashPayment/);
});

test("primary payment methods include Cash, Card, and Split", () => {
  assert.ok(PAYMENT_CENTER_PRIMARY_METHODS.includes("Cash"));
  assert.ok(PAYMENT_CENTER_PRIMARY_METHODS.includes("Card"));
  assert.ok(PAYMENT_CENTER_PRIMARY_METHODS.includes("Split"));
});

test("cash flow exposes quick amount buttons and complete action", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /data-cash-quick="exact"/);
  assert.match(html, /id="completeCashPayment"/);
  assert.match(html, /id="cashChangeDue"/);
});

test("success panel offers print receipt and return to order", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /id="paymentSuccessPrint"/);
  assert.match(html, /id="paymentSuccessReturn"/);
  assert.match(app, /openReceiptWithPayments/);
});
