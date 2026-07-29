import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  validateOrderCreateBody,
  resolveCustomerName,
  WALK_IN_CUSTOMER_NAME
} from "../netlify/functions/_shared/validation.js";

const baseDate = { delivery_date: "2026-07-30" };

test("minimal walk-in pickup order saves with defaults", () => {
  const v = validateOrderCreateBody({
    ...baseDate,
    fulfillment: "PICKUP",
    subtotal: 35,
    payment_required: "NO"
  });
  assert.equal(v.valid, true);
  assert.equal(v.sanitized.customer_name, WALK_IN_CUSTOMER_NAME);
});

test("minimal pickup order with explicit walk-in name", () => {
  const v = validateOrderCreateBody({
    customer_name: WALK_IN_CUSTOMER_NAME,
    ...baseDate,
    fulfillment: "PICKUP",
    arrangement_description: "Designer wrap",
    payment_required: "YES"
  });
  assert.equal(v.valid, true);
});

test("delivery order requires address only when delivery selected", () => {
  const bad = validateOrderCreateBody({
    customer_name: "Sam",
    ...baseDate,
    fulfillment: "DELIVERY",
    subtotal: 50
  });
  assert.equal(bad.valid, false);
  assert.match(bad.errors.join(" "), /Delivery address/i);

  const good = validateOrderCreateBody({
    customer_name: "Sam",
    ...baseDate,
    fulfillment: "DELIVERY",
    delivery_address: "12 Main St, Springfield IL 62701",
    product_id: "prod-1",
    payment_required: "YES"
  });
  assert.equal(good.valid, true);
});

test("business account order can skip payment choice NO", () => {
  const v = validateOrderCreateBody({
    customer_name: "Acme Events",
    customer_type: "BUSINESS",
    ...baseDate,
    fulfillment: "PICKUP",
    subtotal: 120,
    payment_required: "NO"
  });
  assert.equal(v.valid, true);
});

test("order requires at least one line item", () => {
  const v = validateOrderCreateBody({
    customer_name: "Sam",
    ...baseDate,
    fulfillment: "PICKUP",
    payment_required: "NO"
  });
  assert.equal(v.valid, false);
  assert.match(v.errors.join(" "), /at least one item/i);
});

test("resolveCustomerName falls back to walk-in", () => {
  assert.equal(resolveCustomerName(""), WALK_IN_CUSTOMER_NAME);
  assert.equal(resolveCustomerName("  "), WALK_IN_CUSTOMER_NAME);
  assert.equal(resolveCustomerName("Maria"), "Maria");
});

test("order form UI exposes walk-in shortcut and optional labels", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="orderWalkInCustomer"/);
  assert.match(html, /Use Walk-in Customer/);
  assert.match(html, /label-optional/);
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /applyWalkInCustomerDefaults/);
  assert.match(app, /validateOrderFormPayload/);
});
