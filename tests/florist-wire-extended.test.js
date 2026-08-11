import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_RELAY_FEE_PERCENT,
  validateRelaySplitPercent,
  canTransitionWire,
  computeWireSettlement,
} from "../lib/florist-network/wire-orders.js";

test("default relay split is 80/20", () => {
  assert.equal(DEFAULT_RELAY_FEE_PERCENT, 20);
  const s = computeWireSettlement(100);
  assert.equal(s.partner_relay_fee, 20);
  assert.equal(s.fulfilling_shop_payout, 80);
});

test("validateRelaySplitPercent rejects invalid totals", () => {
  assert.equal(validateRelaySplitPercent(-1).ok, false);
  assert.equal(validateRelaySplitPercent(101).ok, false);
  const ok = validateRelaySplitPercent(25);
  assert.equal(ok.ok, true);
  assert.equal(ok.fulfillingPercent, 75);
});

test("counter and viewed wire statuses are supported", () => {
  assert.equal(canTransitionWire("sent", "countered"), true);
  assert.equal(canTransitionWire("sent", "viewed"), true);
  assert.equal(canTransitionWire("countered", "confirmed"), true);
  assert.equal(canTransitionWire("delivered", "completed"), true);
  assert.equal(canTransitionWire("completed", "sent"), false);
});

test("florist network API enforces tenant counter action", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-network.js"), "utf8");
  assert.match(src, /counter-wire/);
  assert.match(src, /validateRelaySplitPercent/);
  assert.match(src, /Not authorized for this wire/);
});

test("wire photo bucket migration exists", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260811140000_florist_wire_photos_bucket.sql"),
    "utf8"
  );
  assert.match(sql, /florist-wire-photos/);
});

test("stripe wire return handled in app shell", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  assert.match(src, /finishFloristWireReturn/);
  assert.match(src, /florist_wire/);
});
