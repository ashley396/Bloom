import test from "node:test";
import assert from "node:assert/strict";
import { handleOrders, ORDER_PAYMENT_LEDGER_FIELDS, sanitizeOrderMetadata } from "../netlify/functions/orders.js";

const SHOP_ID = "shop-a";
const USER = { id: "user-a" };

function event(httpMethod, body) {
  return { httpMethod, body: JSON.stringify(body) };
}

function bodyOfResponse(response) {
  return JSON.parse(response.body);
}

function rejectedWriteDependencies() {
  let databaseCalls = 0;
  return {
    dependencies: {
      currentUser: async () => ({
        client: { from() { databaseCalls += 1; throw new Error("Rejected write reached the database."); } },
        shopId: SHOP_ID,
        user: USER,
      }),
      writeShopAudit: async () => {},
      recordOrderStatusChange: async () => {},
    },
    databaseCalls: () => databaseCalls,
  };
}

for (const field of ORDER_PAYMENT_LEDGER_FIELDS) {
  test(`POST rejects client-controlled ${field}`, async () => {
    const harness = rejectedWriteDependencies();
    const response = await handleOrders(event("POST", { [field]: field === "amount_paid" ? 100 : "forged" }), harness.dependencies);
    assert.equal(response.statusCode, 400);
    assert.match(bodyOfResponse(response).error, /payment ledger/i);
    assert.equal(harness.databaseCalls(), 0);
  });

  test(`PATCH rejects client-controlled ${field}`, async () => {
    const harness = rejectedWriteDependencies();
    const response = await handleOrders(event("PATCH", { id: "order-a", [field]: field === "amount_paid" ? 100 : "forged" }), harness.dependencies);
    assert.equal(response.statusCode, 400);
    assert.match(bodyOfResponse(response).error, /payment ledger/i);
    assert.equal(harness.databaseCalls(), 0);
  });
}

test("POST initializes payment state from the server, not the client", async () => {
  let rpcName;
  let rpcArgs;
  const client = {
    async rpc(name, args) {
      rpcName = name;
      rpcArgs = args;
      return {
        data: {
          item: {
            id: "order-a",
            ...args.p_order,
            amount_paid: 0,
            balance_due: 106,
            payment_status: "UNPAID",
            payment_method: null,
          },
          delivery: null,
          inventoryAdjustments: [],
          inventoryWarnings: [],
        },
        error: null,
      };
    },
  };
  const response = await handleOrders(event("POST", {
    customer_name: "Sam",
    arrangement_description: "Garden bouquet",
    fulfillment: "PICKUP",
    delivery_date: "2026-08-05",
    subtotal: 100,
    tax_rate: 6,
  }), {
    currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }),
    writeShopAudit: async () => {},
    recordOrderStatusChange: async () => {},
  });

  assert.equal(response.statusCode, 201);
  assert.equal(rpcName, "create_order_atomic");
  assert.equal(rpcArgs.p_shop_id, SHOP_ID);
  for (const field of ORDER_PAYMENT_LEDGER_FIELDS) {
    assert.equal(Object.hasOwn(rpcArgs.p_order, field), false, `${field} reached the RPC input`);
  }
  assert.equal(rpcArgs.p_order.shop_id, undefined);
  assert.equal(rpcArgs.p_order.user_id, undefined);
  const item = bodyOfResponse(response).item;
  assert.equal(item.amount_paid, 0);
  assert.equal(item.balance_due, 106);
  assert.equal(item.payment_status, "UNPAID");
  assert.equal(item.payment_method, null);
});

test("status-only PATCH preserves every financial value and remains tenant-scoped", async () => {
  const priorOrder = {
    id: "order-a",
    status: "CONFIRMED",
    fulfillment: "PICKUP",
    subtotal: 100,
    tax: 8,
    delivery_fee: 10,
    total: 118,
    tax_rate: 8,
    labor_charge: 0,
    addon_total: 0,
    discount: 0,
    amount_paid: 40,
    balance_due: 78,
    payment_status: "PARTIAL",
  };
  let updatedPayload;
  let updateFilters = [];

  const selectChain = (data) => ({
    eq() { return this; },
    async maybeSingle() { return { data, error: null }; },
  });
  const client = {
    from(table) {
      if (table === "orders") {
        return {
          select() { return selectChain(priorOrder); },
          update(payload) {
            updatedPayload = payload;
            return {
              eq(field, value) { updateFilters.push([field, value]); return this; },
              select() { return this; },
              async single() { return { data: { ...priorOrder, ...payload }, error: null }; },
            };
          },
        };
      }
      if (table === "deliveries") {
        return { select() { return selectChain(null); } };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const response = await handleOrders(event("PATCH", { id: priorOrder.id, status: "READY" }), {
    currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }),
    writeShopAudit: async () => {},
    recordOrderStatusChange: async () => {},
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(updatedPayload, { status: "READY" });
  assert.deepEqual(updateFilters, [["id", priorOrder.id], ["shop_id", SHOP_ID]]);
  const item = bodyOfResponse(response).item;
  for (const field of ["subtotal", "tax", "delivery_fee", "total", "amount_paid", "balance_due", "payment_status"]) {
    assert.equal(item[field], priorOrder[field], `${field} changed during status-only PATCH`);
  }
});

// Switching Barrier Register, Wave 7: wire order manual intake. create_order_atomic
// already stores whatever JSON is passed as p_order.metadata verbatim on the order
// row (see supabase/migrations/20260810140000_competitive_parity_v2.sql) — these
// guard that the POST handler actually forwards it, so a wire order's service name,
// their reference number, and the commission owed don't silently vanish.
test("sanitizeOrderMetadata keeps a real plain object and rejects arrays, non-objects, and oversized payloads", () => {
  assert.deepEqual(sanitizeOrderMetadata({ wire_service: "FTD", wire_cost: 9.6 }), { wire_service: "FTD", wire_cost: 9.6 });
  assert.deepEqual(sanitizeOrderMetadata(null), {});
  assert.deepEqual(sanitizeOrderMetadata(undefined), {});
  assert.deepEqual(sanitizeOrderMetadata("not an object"), {});
  assert.deepEqual(sanitizeOrderMetadata(["array", "not", "object"]), {});
  assert.deepEqual(sanitizeOrderMetadata({ blob: "x".repeat(5000) }), {});
});

test("POST forwards a wire order's metadata (service, their reference number, commission) to create_order_atomic", async () => {
  let rpcArgs;
  const client = {
    async rpc(name, args) {
      rpcArgs = args;
      return {
        data: { item: { id: "order-wire-1", ...args.p_order }, delivery: null, inventoryAdjustments: [], inventoryWarnings: [] },
        error: null,
      };
    },
  };
  const response = await handleOrders(event("POST", {
    customer_name: "FTD wire order",
    arrangement_description: "Dozen red roses in a clear glass vase",
    fulfillment: "DELIVERY",
    delivery_address: "123 Main St",
    delivery_date: "2026-08-21",
    subtotal: 65,
    order_source: "Wire — FTD",
    metadata: { wire_service: "FTD", wire_reference_number: "123456789", wire_cost: 9.6 },
  }), {
    currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }),
    writeShopAudit: async () => {},
    recordOrderStatusChange: async () => {},
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(rpcArgs.p_order.metadata, { wire_service: "FTD", wire_reference_number: "123456789", wire_cost: 9.6 });
  assert.equal(rpcArgs.p_order.order_source, "Wire — FTD");
});

test("POST never lets an oversized or malformed metadata blob reach create_order_atomic", async () => {
  let rpcArgs;
  const client = {
    async rpc(name, args) {
      rpcArgs = args;
      return { data: { item: { id: "order-wire-2", ...args.p_order } }, error: null };
    },
  };
  const response = await handleOrders(event("POST", {
    customer_name: "FTD wire order",
    arrangement_description: "Dozen red roses",
    fulfillment: "PICKUP",
    delivery_date: "2026-08-21",
    subtotal: 65,
    metadata: "a raw string, not an object",
  }), {
    currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }),
    writeShopAudit: async () => {},
    recordOrderStatusChange: async () => {},
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(rpcArgs.p_order.metadata, {});
});
