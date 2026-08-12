import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "../netlify/functions/orders.js";

test("status-only order PATCH preserves existing financial fields", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";

  const shopId = "22222222-2222-4222-8222-222222222222";
  const orderId = "11111111-1111-4111-8111-111111111111";
  const existing = {
    id: orderId,
    shop_id: shopId,
    status: "PENDING",
    subtotal: 125,
    tax: 10,
    delivery_fee: 15,
    amount_paid: 40,
    balance_due: 110,
    total: 150,
    payment_status: "PARTIAL",
    labor_charge: 0,
    addon_total: 0,
    discount: 0,
    fulfillment: "PICKUP",
    delivery_address: null,
  };
  let orderPatch;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

    if (url.pathname === "/auth/v1/user") return json({ id: "user-1", email: "owner@example.com" });
    if (url.pathname === "/rest/v1/profiles") return json([{ default_shop_id: shopId }]);
    if (url.pathname === "/rest/v1/shop_members") return json([{ shop_id: shopId, role: "owner", status: "active" }]);
    if (url.pathname === "/rest/v1/orders" && method === "GET") return json([existing]);
    if (url.pathname === "/rest/v1/orders" && method === "PATCH") {
      orderPatch = JSON.parse(init.body);
      return json([{ ...existing, ...orderPatch }]);
    }
    if (url.pathname === "/rest/v1/deliveries") return json([]);
    if (url.pathname === "/rest/v1/order_status_history" || url.pathname === "/rest/v1/audit_events") return json([]);
    throw new Error(`Unexpected Supabase request: ${method} ${url.pathname}`);
  };

  try {
    const response = await handler({
      httpMethod: "PATCH",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ id: orderId, status: "CONFIRMED" }),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(orderPatch, { status: "CONFIRMED" });
    assert.equal("total" in orderPatch, false);
    assert.equal("balance_due" in orderPatch, false);
    assert.equal("payment_status" in orderPatch, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
