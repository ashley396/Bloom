import test from "node:test";
import assert from "node:assert/strict";
import { parseFloristExport } from "../lib/migration/florist-import.js";
import { generateReferralCode, normalizeReferralCode } from "../lib/growth/referral-program.js";
import { scoreReadiness, MOTHERS_DAY_CHECKLIST } from "../lib/ops/mothers-day-ready.js";
import { validateWirePayload, canTransitionWire, generateWireNumber } from "../lib/florist-network/wire-orders.js";

test("csv import parses product rows", () => {
  const p = parseFloristExport("name,price,category\nRose Bowl,59,Everyday\n", { entity: "products" });
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].price, 59);
});

test("referral codes normalize safely", () => {
  assert.equal(normalizeReferralCode(" bloom-abc "), "BLOOM-ABC");
  assert.ok(generateReferralCode("Petals").startsWith("PETALS"));
});

test("mothers day readiness scores checklist", () => {
  const s = scoreReadiness(MOTHERS_DAY_CHECKLIST.slice(0, 5).map((i) => i.id));
  assert.equal(s.complete, 5);
  assert.ok(s.score >= 40);
});

test("wire orders validate and transition", () => {
  const bad = validateWirePayload({});
  assert.equal(bad.ok, false);
  const good = validateWirePayload({
    recipient_name: "Jane",
    delivery_address: "1 Main",
    delivery_date: "2026-05-10",
    product_description: "Pastel garden",
    wire_amount: 85
  });
  assert.equal(good.ok, true);
  assert.ok(generateWireNumber().startsWith("FN-"));
  assert.equal(canTransitionWire("sent", "accepted"), true);
  assert.equal(canTransitionWire("sent", "delivered"), false);
});
