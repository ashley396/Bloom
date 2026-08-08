import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const posJs = fs.readFileSync(path.join(root, "public/florisyn-luxury-pos.js"), "utf8");
const hubJs = fs.readFileSync(path.join(root, "public/payment-hub-ui.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "public/admin.js"), "utf8");

test("POS RETURNS rail routes into Payment Center refund hub", () => {
  assert.match(html, /data-pos-tool="returns"/);
  assert.match(posJs, /tool === "returns"/);
  assert.match(posJs, /florisyn_open_refund_center/);
  assert.match(posJs, /showPage\("paymentsPage"\)/);
  assert.match(appJs, /florisyn_open_refund_center/);
  assert.match(appJs, /phRefundPaymentId/);
});

test("Payment Hub Void last button calls refund_void with confirm", () => {
  assert.match(hubJs, /phRefundVoid/);
  assert.match(hubJs, /voidLastRefund/);
  assert.match(hubJs, /action:\s*"refund_void"/);
  assert.match(hubJs, /window\.confirm/);
});

test("notification bells open Orders with a shop alert summary", () => {
  assert.match(html, /id="atelierMobileNotify"/);
  assert.match(appJs, /openShopNotifications/);
  assert.match(appJs, /atelierMobileNotify/);
  assert.match(appJs, /showPage\("ordersPage"\)/);
});

test("maps mileage degrade does not crash order save path", () => {
  assert.match(appJs, /Automatic mileage is unavailable right now/);
  assert.match(appJs, /async function calculateRoute/);
});

test("Admin remains separate from florist showPage routing", () => {
  assert.match(adminJs, /function setView/);
  assert.match(adminJs, /function lockAdminShell/);
  assert.doesNotMatch(adminJs, /function showPage/);
  assert.doesNotMatch(html, /id="adminApp"/);
});
