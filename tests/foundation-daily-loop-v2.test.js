import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  normalizePhoneDigits,
  normalizeEmail,
} from "../netlify/functions/_shared/customer-dedup.js";

test("normalizePhoneDigits strips US country code", () => {
  assert.equal(normalizePhoneDigits("(555) 123-4567"), "5551234567");
  assert.equal(normalizePhoneDigits("1-555-123-4567"), "5551234567");
});

test("normalizeEmail lowercases and trims", () => {
  assert.equal(normalizeEmail("  Test@Example.COM "), "test@example.com");
});

test("orders GET supports history view query contract", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/orders.js"), "utf8");
  assert.match(src, /qs\.view === "history"/);
  assert.match(src, /order_status_history/);
});

test("customers POST checks duplicates before insert", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/customers.js"), "utf8");
  assert.match(src, /findDuplicateCustomer/);
  assert.match(src, /409/);
});

test("production app wires session refresh", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  assert.match(src, /auth-refresh/);
  assert.match(src, /refreshSessionIfNeeded/);
});

test("order board maps legacy NEW to Pending column", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  assert.match(src, /legacy:\["NEW","PENDING"\]/);
  assert.match(src, /boardColumnForStatus/);
  assert.match(src, /loadOrderStatusHistory/);
});

test("login stores session expiry metadata", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "public/login.js"), "utf8");
  assert.match(src, /expiresAt/);
});

test("customer form includes house account field", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /name="is_house_account"/);
});

test("order dialog includes status history section", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /id="orderStatusHistory"/);
  assert.match(html, /id="orderStatusSelect"/);
});
