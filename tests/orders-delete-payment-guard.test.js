import test from "node:test";
import assert from "node:assert/strict";
import { handleOrders } from "../netlify/functions/orders.js";

/**
 * Reproduces a real support report: "the delete button doesn't remove the
 * order in Orders." It's not a bug in the delete flow itself — orders.js
 * intentionally blocks deleting an order once it has payment history, to
 * protect financial records (see the DELETE handler's payments count
 * check). The problem is the guard's message never reaches the florist in
 * an unmissable way — the client only shows it as an auto-dismissing
 * toast. This test locks in the guard's actual behavior so the UI fix
 * (public/app.js) has something real to react to.
 */
const SHOP_ID = "shop-a";
const USER = { id: "user-a" };

function event(httpMethod, body) {
  return { httpMethod, body: JSON.stringify(body) };
}
function bodyOfResponse(response) {
  return JSON.parse(response.body);
}

function fakeClient({ order, paymentCount }) {
  return {
    from(table) {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: order, error: null }),
              }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        };
      }
      if (table === "payments") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ count: paymentCount, error: null }),
            }),
          }),
        };
      }
      if (table === "deliveries") {
        return {
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("DELETE is blocked with a clear, actionable error once an order has payment history", async () => {
  const client = fakeClient({ order: { id: "order-a", order_number: "F-1001" }, paymentCount: 1 });
  const response = await handleOrders(event("DELETE", { id: "order-a" }), {
    currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }),
    writeShopAudit: async () => {},
  });
  assert.equal(response.statusCode, 400);
  assert.match(bodyOfResponse(response).error, /payment history/i);
});

test("DELETE succeeds for an order with no payment history", async () => {
  const client = fakeClient({ order: { id: "order-b", order_number: "F-1002" }, paymentCount: 0 });
  const response = await handleOrders(event("DELETE", { id: "order-b" }), {
    currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }),
    writeShopAudit: async () => {},
  });
  assert.equal(response.statusCode, 200);
});
