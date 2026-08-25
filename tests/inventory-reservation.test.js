import test from "node:test";
import assert from "node:assert/strict";
import { planInventoryReservation, reserveInventoryForOrder } from "../netlify/functions/_shared/inventory-reservation.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// inventory-reservation.js had only 30.4% coverage despite its own header
// comment promising "no negative qty" — exactly the kind of guarantee that
// needs a real test, not just a read-through.

test("planInventoryReservation: reserves against real available stock (quantity minus already-reserved)", () => {
  const items = [{ id: "inv-1", name: "Red Rose", quantity: 20, reserved_qty: 5 }];
  const plan = planInventoryReservation(items, [{ inventory_id: "inv-1", name: "Red Rose", qty: 10 }]);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.shortages, []);
  assert.deepEqual(plan.reservations, [{ inventory_id: "inv-1", name: "Red Rose", qty: 10, new_reserved: 10 }]);
});

test("planInventoryReservation: reads reserved_qty from metadata when it isn't a top-level field", () => {
  const items = [{ id: "inv-2", name: "Tulip", quantity: 10, metadata: { reserved_qty: 8 } }];
  const plan = planInventoryReservation(items, [{ inventory_id: "inv-2", name: "Tulip", qty: 3 }]);
  assert.equal(plan.ok, false, "only 2 available (10-8), needing 3 must be a shortage");
  assert.equal(plan.shortages[0].available, 2);
});

test("planInventoryReservation: falls back to matching by name when inventory_id isn't in the item map", () => {
  const items = [{ id: "inv-3", name: "Baby's Breath", quantity: 5 }];
  const plan = planInventoryReservation(items, [{ name: "Baby's Breath", qty: 2 }]);
  assert.equal(plan.ok, true);
  assert.equal(plan.reservations[0].inventory_id, "inv-3");
});

test("planInventoryReservation: a requirement with no matching inventory row is a not_found shortage", () => {
  const plan = planInventoryReservation([], [{ inventory_id: "missing", name: "Peony", qty: 1 }]);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.shortages, [{ name: "Peony", needed: 1, reason: "not_found" }]);
});

test("planInventoryReservation: never proposes a reservation that would push availability negative", () => {
  const items = [{ id: "inv-4", name: "Lily", quantity: 3, reserved_qty: 3 }];
  const plan = planInventoryReservation(items, [{ inventory_id: "inv-4", name: "Lily", qty: 1 }]);
  assert.equal(plan.ok, false);
  assert.equal(plan.shortages[0].available, 0, "available must floor at what's real, never negative math hidden as a reservation");
});

test("planInventoryReservation: a missing qty on the requirement defaults to needing 1", () => {
  const items = [{ id: "inv-5", name: "Filler", quantity: 5 }];
  const plan = planInventoryReservation(items, [{ inventory_id: "inv-5", name: "Filler" }]);
  assert.equal(plan.ok, true);
  assert.equal(plan.reservations[0].qty, 1);
});

test("planInventoryReservation: multiple requirements are each evaluated independently — one reserved, one short", () => {
  const items = [
    { id: "inv-6", name: "Rose", quantity: 10 },
    { id: "inv-7", name: "Peony", quantity: 1 },
  ];
  const plan = planInventoryReservation(items, [
    { inventory_id: "inv-6", name: "Rose", qty: 4 },
    { inventory_id: "inv-7", name: "Peony", qty: 5 },
  ]);
  assert.equal(plan.ok, false, "the plan as a whole is not ok if any line is short");
  assert.equal(plan.reservations.length, 1);
  assert.equal(plan.shortages.length, 1);
});

test("reserveInventoryForOrder: gracefully skips (ok:true) when the inventory table can't be read at all", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: new Error("connection refused") }]);
  const result = await reserveInventoryForOrder(client, { shopId: "shop-1", orderId: "order-1", subscription: {} });
  assert.deepEqual(result, { ok: true, skipped: true, note: "inventory_unavailable" });
});

test("reserveInventoryForOrder: defaults to a generic 'Design stems' requirement when the subscription has no recipe", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "inv-1", name: "Design stems", quantity: 50 }], error: null },
    { data: null, error: null }, // inventory update (fire-and-forget .catch())
  ]);
  const result = await reserveInventoryForOrder(client, { shopId: "shop-1", orderId: "order-2", subscription: {} });
  assert.equal(result.ok, true);
  assert.equal(result.reservations[0].name, "Design stems");
});

test("reserveInventoryForOrder: uses the subscription's real recipe when one is provided", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "inv-red", name: "Red Rose", quantity: 30 }], error: null },
    { data: null, error: null },
  ]);
  const result = await reserveInventoryForOrder(client, {
    shopId: "shop-1",
    orderId: "order-3",
    subscription: { metadata: { inventory_recipe: [{ inventory_id: "inv-red", name: "Red Rose", qty: 6 }] } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.reservations[0].qty, 6);
  const updateCall = client.calls.find((c) => c.table === "inventory" && c.payload);
  assert.equal(updateCall.payload.metadata.reserved_qty, 6);
  assert.equal(updateCall.payload.metadata.reserved_for_order, "order-3");
});

test("reserveInventoryForOrder: a real shortage flags the order for attention and reports ok:false with no update writes", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "inv-low", name: "Peony", quantity: 1 }], error: null },
    { data: null, error: null }, // orders update flag
  ]);
  const result = await reserveInventoryForOrder(client, {
    shopId: "shop-1",
    orderId: "order-4",
    subscription: { metadata: { recipe: [{ inventory_id: "inv-low", name: "Peony", qty: 5 }] } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.shortages[0].name, "Peony");
  const flagCall = client.calls.find((c) => c.table === "orders");
  assert.equal(flagCall.payload.metadata.inventory_attention_required, true);
  const inventoryUpdateCall = client.calls.find((c) => c.table === "inventory" && c.payload);
  assert.equal(inventoryUpdateCall, undefined, "must not write any reservation when the plan overall failed");
});

test("reserveInventoryForOrder: adds to any pre-existing reserved_qty rather than overwriting it", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "inv-x", name: "Rose", quantity: 20, metadata: { reserved_qty: 4, other_flag: true } }], error: null },
    { data: null, error: null },
  ]);
  await reserveInventoryForOrder(client, {
    shopId: "shop-1",
    orderId: "order-5",
    subscription: { metadata: { recipe: [{ inventory_id: "inv-x", name: "Rose", qty: 3 }] } },
  });
  const updateCall = client.calls.find((c) => c.table === "inventory" && c.payload);
  assert.equal(updateCall.payload.metadata.reserved_qty, 7, "must add to the existing reservation, not replace it");
  assert.equal(updateCall.payload.metadata.other_flag, true, "must preserve unrelated existing metadata");
});
