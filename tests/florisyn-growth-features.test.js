import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseFloristExport } from "../lib/migration/florist-import.js";
import { generateReferralCode, normalizeReferralCode } from "../lib/growth/referral-program.js";
import { scoreReadiness, MOTHERS_DAY_CHECKLIST } from "../lib/ops/mothers-day-ready.js";
import { validateWirePayload, canTransitionWire, generateWireNumber, computeWireSettlement, FLORISYN_WIRE_PLATFORM_FEE_PERCENT } from "../lib/florist-network/wire-orders.js";

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

test("growth Netlify handlers surface friendly migration errors", () => {
  const network = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-network.js"), "utf8");
  assert.match(network, /florist_network_not_migrated/);
  assert.match(network, /could not find the table/);
  const lily = fs.readFileSync(path.join(process.cwd(), "public/lily-platform.js"), "utf8");
  assert.match(lily, /marketingDraftFallback/);
});

test("Florisyn takes zero platform fee on Florist Network wires", () => {
  assert.equal(FLORISYN_WIRE_PLATFORM_FEE_PERCENT, 0);
  const settlement = computeWireSettlement(100);
  assert.equal(settlement.florisyn_platform_fee, 0);
  assert.equal(settlement.fulfilling_shop_payout, 100);
  assert.equal(settlement.partner_relay_fee, 0);
});
