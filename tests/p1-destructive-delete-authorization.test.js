import test from "node:test";
import assert from "node:assert/strict";
import { handleOrders } from "../netlify/functions/orders.js";
import { handleCustomers } from "../netlify/functions/customers.js";
import { handleInventory } from "../netlify/functions/inventory.js";
import { handleProducts } from "../netlify/functions/products.js";
import { handleDeliveries } from "../netlify/functions/deliveries.js";
import { handleExpenses } from "../netlify/functions/expenses.js";
import { currentUser, DESTRUCTIVE_ROLES, requireDestructiveRole } from "../netlify/functions/_shared/supabase.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Launch-readiness P1 #6 (2026-09-28): destructive DELETE on orders,
// customers, inventory, products, deliveries and expenses is limited to
// owner/manager AT THE FUNCTION LAYER — hiding a button is not
// authorization. These tests drive the real handlers; only the session
// helper is stubbed, and the "inactive" / "unauthenticated" cases go
// through the real currentUser() with a fake Supabase client underneath.

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";
const USER = { id: "user-a" };
const ROW = "33333333-3333-4333-8333-333333333333";

function event(httpMethod, body) {
  return { httpMethod, headers: {}, body: JSON.stringify(body) };
}
function session(client, role) {
  return async () => ({ client, shopId: SHOP_A, user: USER, role });
}
function bodyOf(res) {
  return JSON.parse(res.body);
}
/** A client whose every data access explodes: proves denial happened first. */
function untouchableClient() {
  return {
    from() { throw new Error("A denied DELETE reached the database."); },
    rpc() { throw new Error("A denied DELETE reached the database."); },
    storage: { from() { throw new Error("A denied DELETE reached storage."); } }
  };
}
function storage() {
  return createFakeSupabaseStorage({ removeResponses: [{ data: null, error: null }] });
}

// For each handler: how to build a fake client that lets an ALLOWED delete
// of a row in the session shop succeed, and one where the row belongs to
// another shop.
const HANDLERS = [
  {
    name: "orders",
    handle: handleOrders,
    deps: { writeShopAudit: async () => {}, recordOrderStatusChange: async () => {} },
    allowed: () => createFakeSupabaseClient([
      { data: { id: ROW, order_number: "F-1" }, error: null }, // orders select
      { count: 0, error: null }, // payments count
      { error: null }, // deliveries delete
      { error: null } // orders delete
    ]),
    crossShop: () => createFakeSupabaseClient([{ data: null, error: null }]), // RLS + eq(shop_id) → no row
    crossShopStatus: 404,
    mutationTables: ["orders", "deliveries"]
  },
  {
    name: "customers",
    handle: handleCustomers,
    deps: {},
    allowed: () => createFakeSupabaseClient([{ data: { id: ROW, shop_id: SHOP_A }, error: null }, { error: null }, { error: null }]),
    crossShop: () => createFakeSupabaseClient([{ data: { id: ROW, shop_id: SHOP_B }, error: null }]),
    crossShopStatus: 403,
    mutationTables: ["customers"]
  },
  {
    name: "inventory",
    handle: handleInventory,
    deps: {},
    allowed: () => createFakeSupabaseClient([{ data: { id: ROW, shop_id: SHOP_A }, error: null }, { error: null }]),
    crossShop: () => createFakeSupabaseClient([{ data: { id: ROW, shop_id: SHOP_B }, error: null }]),
    crossShopStatus: 403,
    mutationTables: ["inventory"]
  },
  {
    name: "products",
    handle: handleProducts,
    deps: {},
    allowed: () => createFakeSupabaseClient([{ error: null }]),
    crossShop: null, // no pre-read: isolation is the eq("shop_id") filter, asserted below
    mutationTables: ["products"]
  },
  {
    name: "deliveries",
    handle: handleDeliveries,
    deps: {},
    allowed: () => createFakeSupabaseClient([{ data: { id: ROW, shop_id: SHOP_A, proof_photo_url: null }, error: null }, { error: null }], { storage: storage() }),
    crossShop: () => createFakeSupabaseClient([{ data: { id: ROW, shop_id: SHOP_B, proof_photo_url: null }, error: null }], { storage: storage() }),
    crossShopStatus: 403,
    mutationTables: ["deliveries"]
  },
  {
    name: "expenses",
    handle: handleExpenses,
    deps: {},
    allowed: () => createFakeSupabaseClient([{ data: { receipt_path: null }, error: null }, { error: null }], { storage: storage() }),
    crossShop: null,
    mutationTables: ["expenses"]
  }
];

function mutationCalls(client, tables) {
  return client.calls.filter((c) => tables.includes(c.table) && c.ops.some(([op]) => op === "delete" || op === "update"));
}

test("DESTRUCTIVE_ROLES is exactly owner + manager and requireDestructiveRole enforces it", () => {
  assert.deepEqual([...DESTRUCTIVE_ROLES], ["owner", "manager"]);
  for (const role of ["owner", "manager"]) assert.doesNotThrow(() => requireDestructiveRole({ role }));
  for (const role of ["cashier", "driver", "designer", "marketer", "accountant", "staff", "", undefined]) {
    assert.throws(() => requireDestructiveRole({ role }), (e) => e.statusCode === 403, String(role));
  }
});

for (const h of HANDLERS) {
  test(`${h.name}: owner and manager can DELETE a row of their own shop`, async () => {
    for (const role of ["owner", "manager"]) {
      const client = h.allowed();
      const res = await h.handle(event("DELETE", { id: ROW }), { currentUser: session(client, role), ...h.deps });
      assert.equal(res.statusCode, 200, `${h.name} ${role}: ${res.body}`);
      const mutations = mutationCalls(client, h.mutationTables);
      assert.ok(mutations.length >= 1, `${h.name} ${role}: no delete/update was issued`);
      for (const m of mutations) {
        assert.ok(
          m.ops.some(([op, args]) => op === "eq" && args[0] === "shop_id" && args[1] === SHOP_A),
          `${h.name} ${role}: ${m.table} mutation is not scoped to the session shop`
        );
      }
    }
  });

  test(`${h.name}: cashier, driver and every other non-privileged role are denied (403) before any database access`, async () => {
    for (const role of ["cashier", "driver", "designer", "marketer", "accountant", "staff"]) {
      const res = await h.handle(event("DELETE", { id: ROW }), { currentUser: session(untouchableClient(), role), ...h.deps });
      assert.equal(res.statusCode, 403, `${h.name} ${role}: ${res.body}`);
      assert.match(bodyOf(res).error, /permission/i);
    }
  });

  test(`${h.name}: an owner of shop A cannot delete shop B's row`, async () => {
    if (h.crossShop) {
      const client = h.crossShop();
      const res = await h.handle(event("DELETE", { id: ROW }), { currentUser: session(client, "owner"), ...h.deps });
      assert.equal(res.statusCode, h.crossShopStatus, `${h.name}: ${res.body}`);
      assert.equal(mutationCalls(client, h.mutationTables).length, 0, `${h.name}: a cross-shop mutation was issued`);
    } else {
      // No pre-read in this handler: the only defense is the shop_id filter
      // on the mutation itself (plus RLS underneath) — assert it's there.
      const client = h.allowed();
      await h.handle(event("DELETE", { id: ROW, shop_id: SHOP_B }), { currentUser: session(client, "owner"), ...h.deps });
      const mutations = mutationCalls(client, h.mutationTables);
      assert.ok(mutations.length >= 1);
      for (const m of mutations) {
        assert.ok(m.ops.some(([op, args]) => op === "eq" && args[0] === "shop_id" && args[1] === SHOP_A), `${h.name}: mutation not scoped`);
        assert.ok(!m.ops.some(([op, args]) => op === "eq" && args[0] === "shop_id" && args[1] === SHOP_B), `${h.name}: client shop_id was honored`);
      }
    }
  });

  test(`${h.name}: non-destructive GET still works for a cashier (legitimate staff workflows preserved)`, async () => {
    const client = createFakeSupabaseClient([{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]);
    const res = await h.handle({ httpMethod: "GET", headers: {}, queryStringParameters: {} }, { currentUser: session(client, "cashier"), ...h.deps });
    assert.equal(res.statusCode, 200, `${h.name} GET as cashier: ${res.body}`);
  });
}

// ---- The real session helper: unauthenticated and inactive users --------

function fakeAuthClient(responses, userId = "user-x") {
  const client = createFakeSupabaseClient(responses);
  client.auth = { getUser: async () => ({ data: { user: { id: userId } }, error: null }) };
  return client;
}

test("unauthenticated (no bearer token): 401 from the real session helper, before any client is even created", async () => {
  let clientsCreated = 0;
  await assert.rejects(
    () => currentUser({ headers: {} }, { userClient: () => { clientsCreated += 1; return untouchableClient(); } }),
    (e) => e.statusCode === 401
  );
  assert.equal(clientsCreated, 0);
  // And through a real handler with the real helper wired in:
  const res = await handleCustomers(event("DELETE", { id: ROW }), {
    currentUser: (ev) => currentUser(ev, { userClient: () => untouchableClient() })
  });
  assert.equal(res.statusCode, 401);
});

test("inactive member: the real session helper refuses (403 shop_membership_required) and a DELETE never reaches the table", async () => {
  // profiles → default shop; shop_members(active) for that shop → none;
  // shop_members(active) anywhere → none.
  const client = fakeAuthClient([
    { data: { default_shop_id: SHOP_A }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const res = await handleOrders({ ...event("DELETE", { id: ROW }), headers: { authorization: "Bearer jwt" } }, {
    currentUser: (ev) => currentUser(ev, { userClient: () => client }),
    writeShopAudit: async () => {}
  });
  assert.equal(res.statusCode, 403);
  assert.equal(bodyOf(res).code, "shop_membership_required");
  assert.equal(mutationCalls(client, ["orders", "deliveries"]).length, 0);
});

test("the real role resolution feeds the gate: an active cashier membership is denied, an active manager membership is allowed", async () => {
  const cashier = fakeAuthClient([
    { data: { default_shop_id: SHOP_A }, error: null },
    { data: { shop_id: SHOP_A, role: "cashier", status: "active" }, error: null }
  ]);
  const denied = await handleProducts({ ...event("DELETE", { id: ROW }), headers: { authorization: "Bearer jwt" } }, {
    currentUser: (ev) => currentUser(ev, { userClient: () => cashier })
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(mutationCalls(cashier, ["products"]).length, 0);

  const manager = fakeAuthClient([
    { data: { default_shop_id: SHOP_A }, error: null },
    { data: { shop_id: SHOP_A, role: "Manager", status: "active" }, error: null },
    { error: null } // the soft delete
  ]);
  const allowed = await handleProducts({ ...event("DELETE", { id: ROW }), headers: { authorization: "Bearer jwt" } }, {
    currentUser: (ev) => currentUser(ev, { userClient: () => manager })
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  const mutations = mutationCalls(manager, ["products"]);
  assert.equal(mutations.length, 1);
  assert.ok(mutations[0].ops.some(([op, args]) => op === "eq" && args[0] === "shop_id" && args[1] === SHOP_A));
});

test("production entry points are the seam-bound handlers (no second, ungated code path)", async () => {
  const fs = await import("node:fs");
  for (const [file, fn] of [
    ["customers", "handleCustomers"], ["inventory", "handleInventory"], ["products", "handleProducts"],
    ["deliveries", "handleDeliveries"], ["expenses", "handleExpenses"], ["orders", "handleOrders"]
  ]) {
    const src = fs.readFileSync(new URL(`../netlify/functions/${file}.js`, import.meta.url), "utf8");
    assert.match(src, new RegExp(`export (const handler\\s*=\\s*\\(event\\)\\s*=>\\s*${fn}\\(event\\)|async function handler\\(event\\)\\s*\\{\\s*return ${fn}\\(event\\))`), file);
    assert.match(src, /requireDestructiveRole\(ctx\);/, `${file}: DELETE branch is not gated`);
    assert.equal((src.match(/requireDestructiveRole\(ctx\);/g) || []).length, 1, `${file}: gate must sit on exactly the DELETE branch`);
  }
});
