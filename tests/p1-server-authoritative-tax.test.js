import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { handleOrders, parseOrderMoneyFields, resolveShopTaxRate } from "../netlify/functions/orders.js";

// Launch-readiness P1 #7 (2026-09-28): ordinary order creation must not
// trust a client-supplied tax_rate. The server reads the authenticated
// shop's own configured rate and create_order_atomic computes tax/total
// from it. Every money field must be a finite amount >= 0.

const SHOP_ID = "shop-a";
const USER = { id: "user-a" };

function event(httpMethod, body) {
  return { httpMethod, body: JSON.stringify(body) };
}

function makeClient({ shopTaxRate = 8.25, shopRow = "row", shopError = null } = {}) {
  const state = { shopsOps: [], rpc: null, fromCalls: 0 };
  const client = {
    from(table) {
      state.fromCalls += 1;
      if (table !== "shops") throw new Error(`Unexpected table: ${table}`);
      const chain = {
        select(...args) { state.shopsOps.push(["select", args]); return chain; },
        eq(...args) { state.shopsOps.push(["eq", args]); return chain; },
        async maybeSingle() {
          if (shopError) return { data: null, error: shopError };
          return { data: shopRow === "row" ? { tax_rate: shopTaxRate } : null, error: null };
        }
      };
      return chain;
    },
    async rpc(name, args) {
      state.rpc = { name, args };
      return { data: { item: { id: "order-1", ...args.p_order } }, error: null };
    }
  };
  return { client, state };
}

function deps(client, role = "cashier") {
  return {
    currentUser: async () => ({ client, shopId: SHOP_ID, user: USER, role }),
    writeShopAudit: async () => {},
    recordOrderStatusChange: async () => {}
  };
}

const BASE_ORDER = {
  customer_name: "Sam",
  arrangement_description: "Garden bouquet",
  fulfillment: "PICKUP",
  delivery_date: "2026-10-01",
  subtotal: 100
};

test("normal shop rate: the order is created with the shop's configured tax rate, read server-side", async () => {
  const { client, state } = makeClient({ shopTaxRate: 8.25 });
  const res = await handleOrders(event("POST", { ...BASE_ORDER }), deps(client));
  assert.equal(res.statusCode, 201);
  assert.equal(state.rpc.name, "create_order_atomic");
  assert.equal(state.rpc.args.p_order.tax_rate, 8.25);
});

test("a malicious/different client tax_rate is ignored — the shop's rate wins (0%, 200%, text, negative)", async () => {
  for (const forged of [0, 200, "abc", -5, null, "0.00001"]) {
    const { client, state } = makeClient({ shopTaxRate: 8.25 });
    const res = await handleOrders(event("POST", { ...BASE_ORDER, tax_rate: forged, tax: 0, total_preview: 100 }), deps(client));
    assert.equal(res.statusCode, 201, `forged tax_rate ${String(forged)}`);
    assert.equal(state.rpc.args.p_order.tax_rate, 8.25, `forged tax_rate ${String(forged)} reached the RPC`);
    // The client never gets to hand the database a tax or total either —
    // create_order_atomic computes both from tax_rate.
    assert.equal(Object.hasOwn(state.rpc.args.p_order, "tax"), false);
    assert.equal(Object.hasOwn(state.rpc.args.p_order, "total"), false);
  }
});

test("the shop's rate is applied for every role — an owner's POS can't accidentally send a stale 6% either", async () => {
  for (const role of ["owner", "manager", "cashier", "driver", "staff"]) {
    const { client, state } = makeClient({ shopTaxRate: 7.5 });
    const res = await handleOrders(event("POST", { ...BASE_ORDER, tax_rate: 6 }), deps(client, role));
    assert.equal(res.statusCode, 201, role);
    assert.equal(state.rpc.args.p_order.tax_rate, 7.5, role);
  }
});

test("zero-tax shop: a shop configured at 0% (or with no rate at all) creates 0% orders whatever the client sends", async () => {
  const zero = makeClient({ shopTaxRate: 0 });
  const r1 = await handleOrders(event("POST", { ...BASE_ORDER, tax_rate: 9 }), deps(zero.client));
  assert.equal(r1.statusCode, 201);
  assert.equal(zero.state.rpc.args.p_order.tax_rate, 0);

  const unset = makeClient({ shopTaxRate: null });
  const r2 = await handleOrders(event("POST", { ...BASE_ORDER, tax_rate: 9 }), deps(unset.client));
  assert.equal(r2.statusCode, 201);
  assert.equal(unset.state.rpc.args.p_order.tax_rate, 0);
});

test("resolveShopTaxRate: clamps to 0..100, treats a missing row/rate as zero, and surfaces a database error", async () => {
  const { client: high } = makeClient({ shopTaxRate: 250 });
  assert.equal(await resolveShopTaxRate(high, SHOP_ID), 100);
  const { client: negative } = makeClient({ shopTaxRate: -3 });
  assert.equal(await resolveShopTaxRate(negative, SHOP_ID), 0);
  const { client: noRow } = makeClient({ shopRow: null });
  assert.equal(await resolveShopTaxRate(noRow, SHOP_ID), 0);
  const { client: broken } = makeClient({ shopError: { message: "connection reset", code: "08006" } });
  await assert.rejects(() => resolveShopTaxRate(broken, SHOP_ID), (e) => e.message === "connection reset");
});

test("a failed shop-rate read fails the order (500) instead of silently creating an untaxed order", async () => {
  const { client, state } = makeClient({ shopError: { message: "permission denied for table shops", code: "42501" } });
  const res = await handleOrders(event("POST", { ...BASE_ORDER }), deps(client));
  assert.equal(res.statusCode, 500);
  assert.equal(state.rpc, null, "create_order_atomic must not run without an authoritative tax rate");
});

test("cross-shop isolation: the rate is read for the SESSION shop only and the RPC is scoped to it", async () => {
  const { client, state } = makeClient({ shopTaxRate: 8.25 });
  const res = await handleOrders(event("POST", { ...BASE_ORDER, shop_id: "shop-b", tax_rate: 0 }), deps(client));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(state.shopsOps, [["select", ["tax_rate"]], ["eq", ["id", SHOP_ID]]]);
  assert.equal(state.rpc.args.p_shop_id, SHOP_ID);
  assert.equal(state.rpc.args.p_order.shop_id, undefined);
});

test("malformed money values are rejected with 400 before any database call", async () => {
  const cases = [
    { labor_charge: "abc" },
    { labor_charge: -1 },
    { addon_total: "Infinity" },
    { discount: -0.01 },
    { delivery_fee: "NaN" },
    { subtotal: -50 }
  ];
  for (const bad of cases) {
    const { client, state } = makeClient();
    const res = await handleOrders(event("POST", { ...BASE_ORDER, ...bad }), deps(client));
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
    assert.equal(state.rpc, null, JSON.stringify(bad));
    assert.equal(state.fromCalls, 0, `${JSON.stringify(bad)} reached the database`);
  }
});

test("parseOrderMoneyFields: blanks are zero, valid amounts pass through unchanged", () => {
  assert.deepEqual(parseOrderMoneyFields({ subtotal: "42.50", labor_charge: "", discount: null }), {
    flowers: 42.5,
    labor: 0,
    addons: 0,
    discount: 0,
    deliveryFee: 0
  });
  assert.match(parseOrderMoneyFields({ subtotal: "12abc" }).error, /Flowers \/ product amount/);
});

test("subtotal/tax calculation: the database computes tax and total from the server-chosen rate (source guard on create_order_atomic)", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260821000000_order_atomic_cross_shop_fk_guard.sql"),
    "utf8"
  );
  assert.match(sql, /v_tax_rate := greatest\(0, coalesce\(nullif\(p_order->>'tax_rate', ''\)::numeric, 0\)\);/);
  assert.match(sql, /v_tax := greatest\(0, round\(v_subtotal \* \(v_tax_rate \/ 100\), 2\)\);/);
  assert.match(sql, /v_total := greatest\(0, round\(v_subtotal \+ v_tax \+ v_delivery_fee, 2\)\);/);
  // Worked example of that formula for the rate the server now supplies.
  const subtotal = Math.round((100 + 0 + 0 - 0) * 100) / 100;
  const tax = Math.round(subtotal * (8.25 / 100) * 100) / 100;
  assert.equal(tax, 8.25);
  assert.equal(Math.round((subtotal + tax + 0) * 100) / 100, 108.25);
});

test("PATCH keeps the order's original rate: a client tax_rate in a pricing edit is ignored", async () => {
  const priorOrder = {
    id: "order-a", status: "CONFIRMED", subtotal: 100, tax: 8, delivery_fee: 0, total: 108, tax_rate: 8,
    labor_charge: 0, addon_total: 0, discount: 0, amount_paid: 0, balance_due: 108, payment_status: "UNPAID"
  };
  let updatedPayload;
  const selectChain = (data) => ({ eq() { return this; }, async maybeSingle() { return { data, error: null }; } });
  const client = {
    from(table) {
      if (table === "orders") {
        return {
          select() { return selectChain(priorOrder); },
          update(payload) {
            updatedPayload = payload;
            return { eq() { return this; }, select() { return this; }, async single() { return { data: { ...priorOrder, ...payload }, error: null }; } };
          }
        };
      }
      if (table === "deliveries") return { select() { return selectChain(null); } };
      throw new Error(`Unexpected table: ${table}`);
    }
  };
  const res = await handleOrders(event("PATCH", { id: "order-a", subtotal: 200, tax_rate: 0 }), deps(client, "owner"));
  assert.equal(res.statusCode, 200);
  assert.equal(updatedPayload.tax_rate, 8);
  assert.equal(updatedPayload.tax, 16);
  assert.equal(updatedPayload.total, 216);
});

test("PATCH pricing edits reject negative or malformed money fields before any write", async () => {
  const priorOrder = {
    id: "order-a", status: "CONFIRMED", subtotal: 100, tax: 8, delivery_fee: 0, total: 108, tax_rate: 8,
    labor_charge: 0, addon_total: 0, discount: 0, amount_paid: 0, balance_due: 108, payment_status: "UNPAID"
  };
  for (const bad of [{ labor_charge: -5 }, { discount: -1 }, { delivery_fee: "abc" }, { addon_total: "-0.5" }]) {
    let updated = false;
    const selectChain = (data) => ({ eq() { return this; }, async maybeSingle() { return { data, error: null }; } });
    const client = {
      from(table) {
        if (table === "orders") return { select() { return selectChain(priorOrder); }, update() { updated = true; return { eq() { return this; }, select() { return this; }, async single() { return { data: priorOrder, error: null }; } }; } };
        if (table === "deliveries") return { select() { return selectChain(null); } };
        throw new Error(`Unexpected table: ${table}`);
      }
    };
    const res = await handleOrders(event("PATCH", { id: "order-a", ...bad }), deps(client, "owner"));
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
    assert.equal(updated, false, `${JSON.stringify(bad)} was written`);
  }
});

test("public storefront checkout: a web buyer's options.tax_rate is ignored — the shop's rate is the only rate", async () => {
  const { buildWebOrderTotals } = await import("../netlify/functions/_shared/bloom-storefront-commerce.js");
  const lines = [{ name: "Bouquet", qty: 2, price: 50 }];
  const shop = { tax_rate: 8.25, default_delivery_fee: 0 };
  const forged = buildWebOrderTotals(lines, shop, { fulfillment: "PICKUP", tax_rate: 0 }, {});
  const honest = buildWebOrderTotals(lines, shop, { fulfillment: "PICKUP" }, {});
  assert.equal(forged.tax, honest.tax);
  assert.ok(forged.tax > 0, "tax must be computed from the shop's 8.25%");
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/storefront-public.js"), "utf8");
  assert.match(src, /tax_rate: shop\.tax_rate/);
  assert.doesNotMatch(src, /body\.options\?\.tax_rate/);
  const commerce = fs.readFileSync(path.join(process.cwd(), "netlify/functions/_shared/bloom-storefront-commerce.js"), "utf8");
  assert.match(commerce, /storefrontCartTotals\(lines, shop\.tax_rate, deliveryFee, 0\)/);
  assert.doesNotMatch(commerce, /storefrontCartTotals\([^)]*options\.(tax_rate|discount)/);
  // A body-supplied discount is ignored too (no storefront client ever sends
  // one; it bypassed the minimum-order check).
  const discounted = buildWebOrderTotals(lines, shop, { fulfillment: "PICKUP", discount: 100 }, {});
  assert.equal(discounted.subtotal, honest.subtotal);
  assert.equal(discounted.tax, honest.tax);
  assert.equal(discounted.total, honest.total);
});

test("Lily's guided order stepper previews the shop rate read-only and never assumes 6%", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "public/guided-order-stepper.js"), "utf8");
  assert.match(src, /name="tax_rate" value="\$\{esc\(state\.tax_rate \?\? window\.shopSettings\?\.tax_rate \?\? 0\)\}" readonly/);
  assert.doesNotMatch(src, /tax_rate \?\? 6/);
});

test("the Settings page becomes view-only when the server answers with member scope", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  assert.match(app, /if\(settingsRes\.scope==="member"\)\{for\(const el of f\.elements\)el\.disabled=true;/);
});

test("the manual order form no longer offers the tax rate as an editable input (it is display-only, from Settings)", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /<input name="tax_rate" class="order-money"[^>]*readonly/);
});
