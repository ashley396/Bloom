import test from "node:test";
import assert from "node:assert/strict";
import { getFeatureFlags } from "../netlify/functions/_shared/feature-flags.js";
import {
  shouldDeductOnStatus,
  FULFILL_DEDUCT_STATUSES,
} from "../lib/inventory/recipe-deduction.js";
import { buildWirePayloadFromOrder } from "../lib/florist-network/wire-from-order.js";
import { buildProductionReport } from "../lib/ops/production-report.js";
import { optimizeRouteStops } from "../lib/delivery/route-board.js";
import { parseFloristExport } from "../lib/migration/florist-import.js";

test("production-ready feature flags default ON", () => {
  const flags = getFeatureFlags({});
  assert.equal(flags.HOLIDAY_COMMAND_CENTER, true);
  assert.equal(flags.EMAIL_CAMPAIGNS, true);
  assert.equal(flags.WEDDING_WORKFLOWS, true);
  assert.equal(flags.MARKETPLACE_PUBLIC, true);
  assert.equal(flags.INVENTORY_RECIPE_DEDUCTIONS, true);
  assert.equal(flags.FLORIST_NETWORK, true);
});

test("recipe deduction triggers on production statuses", () => {
  assert.equal(shouldDeductOnStatus("READY"), true);
  assert.equal(shouldDeductOnStatus("DELIVERED"), true);
  assert.equal(shouldDeductOnStatus("PENDING"), false);
  assert.ok(FULFILL_DEDUCT_STATUSES.has("COMPLETED"));
});

test("wire payload builds from POS order", () => {
  const payload = buildWirePayloadFromOrder({
    id: "ord-1",
    customer_name: "Sam",
    recipient_name: "Alex",
    delivery_address: "1 Main St",
    delivery_date: "2026-05-11",
    arrangement_description: "Pastel garden",
    total: 120,
  });
  assert.equal(payload.source_order_id, "ord-1");
  assert.equal(payload.recipient_name, "Alex");
  assert.equal(payload.wire_amount, 120);
});

test("production report groups designers", () => {
  const report = buildProductionReport(
    [
      { designer: "Lee", status: "DELIVERED", updated_at: new Date().toISOString() },
      { designer: "Lee", status: "READY", updated_at: new Date().toISOString() },
      { designer: "Kim", status: "PENDING", updated_at: new Date().toISOString() },
    ],
    { days: 7 }
  );
  assert.equal(report.order_count, 3);
  assert.equal(report.designers[0].name, "Lee");
  assert.equal(report.designers[0].count, 2);
});

test("route optimizer assigns route_order", () => {
  const optimized = optimizeRouteStops([
    { id: "b", delivery_date: "2026-05-12", status: "PENDING", address: "B" },
    { id: "a", delivery_date: "2026-05-10", status: "PENDING", address: "A" },
  ]);
  assert.equal(optimized[0].id, "a");
  assert.equal(optimized[0].route_order, 1);
});

test("migration parses inventory and orders CSV", () => {
  const inv = parseFloristExport("name,quantity,cost\nRose,50,1.25\n", { entity: "inventory" });
  assert.equal(inv.rows[0].quantity, 50);
  const ord = parseFloristExport("name,delivery date,total\nJane,2026-05-01,85\n", { entity: "orders" });
  assert.equal(ord.rows[0].customer_name, "Jane");
  assert.equal(ord.rows[0].total, 85);
});
