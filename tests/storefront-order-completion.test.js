import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createStorefrontPublicHandler } from "../netlify/functions/storefront-public.js";
import { deliveryDateValid } from "../netlify/functions/_shared/bloom-storefront-commerce.js";
import { storefrontCartTotals } from "../netlify/functions/_shared/bloom-storefront-core.js";

// Phase A-1b (2026-09-28): storefront order completion. Before this batch
// every web order returned 400 "Choose a due, pickup, or delivery date."
// because the shared order validator was handed only name/phone/subtotal;
// pay-now also inserted the order BEFORE checking Stripe/Connect (orphan
// orders on every 503/409). These tests drive the REAL handler over a
// table-aware fake service-role client; Stripe is a stub (no real charge).

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";
const P = {
  rose: "11111111-1111-4111-8111-111111111111", // visible, $19.99
  hidden: "22222222-2222-4222-8222-222222222222",
  inactive: "33333333-3333-4333-8333-333333333333",
  deleted: "44444444-4444-4444-8444-444444444444",
  otherShop: "55555555-5555-4555-8555-555555555555"
};

function product(id, shopId, overrides = {}) {
  return {
    id, shop_id: shopId, name: `Bouquet ${id.slice(0, 4)}`, description: "Fresh", price: 19.99,
    image_url: null, category: "Everyday", active: true, available_online: true, deleted_at: null, ...overrides
  };
}

function seed({ projectStatus = "published", connect = null, taxRate = 8.25, deliveryFee = 10 } = {}) {
  return {
    shops: [
      { id: SHOP_A, slug: "shop-a", name: "Shop A", tax_rate: taxRate, default_delivery_fee: deliveryFee, stripe_connect_account_id: connect },
      { id: SHOP_B, slug: "shop-b", name: "Shop B", tax_rate: 0, default_delivery_fee: 0, stripe_connect_account_id: null }
    ],
    bloom_website_projects: [{ id: PROJECT_A, shop_id: SHOP_A, status: projectStatus, theme_id: "garden" }],
    bloom_website_pages: [{ id: "home", shop_id: SHOP_A, project_id: PROJECT_A, slug: "home", title: "Home", visible: true, nav_order: 0 }],
    bloom_shop_catalog_products: [],
    products: [
      product(P.rose, SHOP_A),
      product(P.hidden, SHOP_A, { available_online: false }),
      product(P.inactive, SHOP_A, { active: false }),
      product(P.deleted, SHOP_A, { deleted_at: "2026-09-01T00:00:00Z" }),
      product(P.otherShop, SHOP_B)
    ],
    orders: [],
    payment_hub_payment_links: [],
    bloom_storefront_order_events: []
  };
}

/** Table-aware fake service-role client that records every write. */
function fakeAdmin(tables) {
  const writes = [];
  let seq = 0;
  return {
    writes,
    from(table) {
      const rows = tables[table] || (tables[table] = []);
      const filters = [];
      const apply = () => rows.filter((r) => filters.every((f) => f(r)));
      const builder = {
        select() { return builder; },
        eq(c, v) { filters.push((r) => String(r[c]) === String(v)); return builder; },
        is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return builder; },
        order() { return builder; },
        limit() { return builder; },
        insert(payload) {
          seq += 1;
          const inserted = { id: `${table}-${seq}`, ...payload };
          rows.push(inserted);
          writes.push({ table, payload });
          const result = { data: null, error: null, select() { return { single: async () => ({ data: inserted, error: null }) }; } };
          return result;
        },
        maybeSingle: async () => ({ data: apply()[0] || null, error: null }),
        single: async () => ({ data: apply()[0] || null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: apply(), error: null }).then(resolve, reject); }
      };
      return builder;
    }
  };
}

function stripeStub() {
  const created = [];
  return {
    created,
    factory: () => ({
      checkout: { sessions: { create: async (params, opts) => { created.push({ params, opts }); return { id: "cs_test_stub", url: "https://checkout.stripe.test/cs_test_stub" }; } } }
    })
  };
}

/** Runs fn with the given env vars set (undefined = unset), then restores the caller's values. */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function setup(seedOpts = {}, { stripe } = {}) {
  const tables = seed(seedOpts);
  const client = fakeAdmin(tables);
  const handler = createStorefrontPublicHandler({ admin: () => client, createStripe: stripe?.factory });
  return { tables, client, handler };
}

const pad = (n) => String(n).padStart(2, "0");
function isoDaysAhead(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
let ip = 0;
function order(body) {
  ip += 1;
  return {
    httpMethod: "POST",
    headers: { "x-forwarded-for": `10.9.${Math.floor(ip / 250)}.${ip % 250}`, origin: "https://www.florisyn.com" },
    queryStringParameters: {},
    body: JSON.stringify({
      action: "create_web_order",
      shop_slug: "shop-a",
      payment_mode: "pay_later",
      cart: { lines: [{ id: P.rose, qty: 3 }] },
      customer: { name: "Web Buyer", phone: "555-010-0100", email: "buyer@example.com" },
      ...body,
      options: { fulfillment: "PICKUP", delivery_date: isoDaysAhead(3), ...(body?.options || {}) }
    })
  };
}
const writesTo = (client, table) => client.writes.filter((w) => w.table === table);
function assertNoMutation(client, label) {
  for (const table of ["orders", "payment_hub_payment_links", "bloom_storefront_order_events"]) {
    assert.equal(writesTo(client, table).length, 0, `${label}: unexpected write to ${table}`);
  }
}

test("pay-later: a valid storefront order succeeds, with the fulfillment date on the created order (was always 400)", async () => {
  const { handler, client } = setup();
  const date = isoDaysAhead(3);
  const res = await handler(order({ options: { fulfillment: "PICKUP", delivery_date: date } }));
  assert.equal(res.statusCode, 201, res.body);
  const [row] = writesTo(client, "orders").map((w) => w.payload);
  assert.equal(row.shop_id, SHOP_A);
  assert.equal(row.delivery_date, date);
  assert.equal(row.fulfillment, "PICKUP");
  assert.equal(row.order_source, "Website");
  assert.equal(row.payment_status, "UNPAID");
  // pay-later auto-creates a secure payment link and the created-order event
  assert.equal(writesTo(client, "payment_hub_payment_links").length, 1);
  assert.ok(writesTo(client, "bloom_storefront_order_events").some((w) => w.payload.event_type === "web_order_created"));
  const body = JSON.parse(res.body);
  assert.equal(body.commerce.payment_mode, "pay_later");
});

test("authoritative pricing and tax: server catalog price × qty, shop tax rate, cents-rounded totals — client price/subtotal/tax ignored", async () => {
  const { handler, client } = setup({ taxRate: 8.25 });
  const res = await handler(order({
    cart: { lines: [{ id: P.rose, qty: 3, price: 0.01, name: "forged" }], subtotal: 0.03 },
    subtotal: 0.03,
    total: 0.03,
    options: { fulfillment: "PICKUP", delivery_date: isoDaysAhead(3), tax_rate: 0, discount: 50, delivery_fee: 0 }
  }));
  assert.equal(res.statusCode, 201, res.body);
  const [row] = writesTo(client, "orders").map((w) => w.payload);
  assert.equal(row.subtotal, 59.97);              // 3 × 19.99, rounded (not 59.970000000000006)
  assert.equal(row.tax_rate, 8.25);                // shop's rate, not the client's 0
  assert.equal(row.tax, 4.95);                     // round(59.97 × 8.25%) = 4.9475 → 4.95
  assert.equal(row.delivery_fee, 0);               // pickup
  assert.equal(row.total, 64.92);
  assert.equal(row.balance_due, 64.92);
  assert.match(row.arrangement_description, /^3 × Bouquet/);
});

test("delivery vs pickup: delivery requires an address and adds the shop's delivery fee; pickup adds none", async () => {
  const a = setup({ deliveryFee: 10 });
  const noAddress = await a.handler(order({ options: { fulfillment: "DELIVERY", delivery_date: isoDaysAhead(3) } }));
  assert.equal(noAddress.statusCode, 400);
  assert.match(JSON.parse(noAddress.body).error, /address/i);
  assertNoMutation(a.client, "delivery without address");

  const b = setup({ deliveryFee: 10, taxRate: 0 });
  const withAddress = await b.handler(order({ options: { fulfillment: "DELIVERY", delivery_date: isoDaysAhead(3), delivery_address: "12 Elm St, Springfield" } }));
  assert.equal(withAddress.statusCode, 201, withAddress.body);
  const [row] = writesTo(b.client, "orders").map((w) => w.payload);
  assert.equal(row.fulfillment, "DELIVERY");
  assert.equal(row.delivery_address, "12 Elm St, Springfield");
  assert.equal(row.delivery_fee, 10);
  assert.equal(row.total, 69.97);
});

test("missing fulfillment date fails with no order, payment link or event written", async () => {
  const { handler, client } = setup();
  for (const date of ["", "   ", undefined, null]) {
    const res = await handler(order({ options: { fulfillment: "PICKUP", delivery_date: date } }));
    assert.equal(res.statusCode, 400, `date=${JSON.stringify(date)}: ${res.body}`);
    assert.match(JSON.parse(res.body).error, /date/i);
  }
  assertNoMutation(client, "missing date");
});

test("malformed dates fail cleanly (no rollover to a different day, no DB-level 500)", async () => {
  const { handler, client } = setup();
  for (const date of ["2027-02-30", "2027-13-01", "02/10/2027", "tomorrow", "2027-2-3", "2027-02-03T10:00"]) {
    const res = await handler(order({ options: { fulfillment: "PICKUP", delivery_date: date } }));
    assert.equal(res.statusCode, 400, `${date}: ${res.body}`);
  }
  assert.equal(deliveryDateValid("2027-02-30").valid, false);
  assert.equal(deliveryDateValid("2028-02-29").valid, true); // real leap day
  assertNoMutation(client, "malformed date");
});

test("hidden, inactive, deleted and cross-shop products cannot be purchased by submitting their id", async () => {
  const { handler, client } = setup();
  for (const id of [P.hidden, P.inactive, P.deleted, P.otherShop]) {
    const res = await handler(order({ cart: { lines: [{ id, qty: 1 }] } }));
    assert.equal(res.statusCode, 400, `${id}: ${res.body}`);
    assert.match(JSON.parse(res.body).error, /no longer available/i);
  }
  assertNoMutation(client, "hidden products");
});

test("unpublished storefront cannot place an order", async () => {
  const { handler, client } = setup({ projectStatus: "draft" });
  const res = await handler(order({}));
  assert.equal(res.statusCode, 403);
  assertNoMutation(client, "unpublished");
});

test("the order is created only for the storefront's own shop — a client shop_id is ignored", async () => {
  const { handler, client } = setup();
  const res = await handler(order({ shop_id: SHOP_B, options: { fulfillment: "PICKUP", delivery_date: isoDaysAhead(3), shop_id: SHOP_B } }));
  assert.equal(res.statusCode, 201, res.body);
  const rows = writesTo(client, "orders").map((w) => w.payload);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shop_id, SHOP_A);
  for (const w of client.writes) assert.equal(w.payload.shop_id, SHOP_A, `${w.table} written for the wrong shop`);
});

test("pay-now reaches the Stripe Checkout session stage (stubbed — no real charge) with the server total and the shop's Connect account", async () => {
  const stripe = stripeStub();
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_stub_only", SITE_URL: "https://staging.example" }, async () => {
    const { handler, client } = setup({ connect: "acct_test_shopA", taxRate: 8.25 }, { stripe });
    const res = await handler(order({ action: "create_web_checkout", payment_mode: "pay_now" }));
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(stripe.created.length, 1);
    const { params, opts } = stripe.created[0];
    assert.equal(params.line_items[0].price_data.unit_amount, 6492); // $64.92 in cents, server-computed
    assert.equal(params.payment_intent_data.transfer_data.destination, "acct_test_shopA");
    assert.equal(params.metadata.bloom_shop_id, SHOP_A);
    assert.ok(opts.idempotencyKey);
    assert.equal(params.success_url.startsWith("https://staging.example/store/shop-a/"), true);
    assert.equal(JSON.parse(res.body).handoff.checkout_url, "https://checkout.stripe.test/cs_test_stub");
    assert.equal(writesTo(client, "orders").length, 1);
  });
});

test("pay-now that cannot succeed (no Stripe key, or no Connect account) fails BEFORE any order is written (was an orphan order)", async () => {
  const stripe = stripeStub();
  await withEnv({ STRIPE_SECRET_KEY: undefined }, async () => {
    const noKey = setup({ connect: "acct_test_shopA" }, { stripe });
    const r1 = await noKey.handler(order({ action: "create_web_checkout", payment_mode: "pay_now" }));
    assert.equal(r1.statusCode, 503);
    assertNoMutation(noKey.client, "pay-now without key");
  });
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_stub_only" }, async () => {
    const noConnect = setup({ connect: null }, { stripe });
    const r2 = await noConnect.handler(order({ action: "create_web_checkout", payment_mode: "pay_now" }));
    assert.equal(r2.statusCode, 409);
    assert.equal(JSON.parse(r2.body).code, "stripe_connect_required");
    assertNoMutation(noConnect.client, "pay-now without Connect");
  });
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_stub_only", SITE_URL: undefined, URL: undefined }, async () => {
    const noSite = setup({ connect: "acct_test_shopA" }, { stripe });
    const ev = order({ action: "create_web_checkout", payment_mode: "pay_now" });
    delete ev.headers.origin;
    const r3 = await noSite.handler(ev);
    assert.equal(r3.statusCode, 503);
    assert.match(JSON.parse(r3.body).error, /SITE_URL/);
    assertNoMutation(noSite.client, "pay-now without a site base URL");
  });
  assert.equal(stripe.created.length, 0, "no Stripe session may be created when pay-now is not possible");
});

test("the public site only offers 'pay now' when card checkout can actually succeed (key AND the shop's Connect account)", async () => {
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_stub_only" }, async () => {
    const get = (h) => h({ httpMethod: "GET", headers: {}, queryStringParameters: { shop: "shop-a" } });
    const withoutConnect = JSON.parse((await get(setup({ connect: null }).handler)).body);
    assert.deepEqual(withoutConnect.commerce.payment_modes, ["pay_later"]);
    assert.equal(withoutConnect.commerce.stripe_available, false);
    const withConnect = JSON.parse((await get(setup({ connect: "acct_test_shopA" }).handler)).body);
    assert.deepEqual(withConnect.commerce.payment_modes, ["pay_now", "pay_later"]);
  });
});

test("a public request body cannot move \"now\" to bypass the past-date or lead-days rules", async () => {
  const { handler, client } = setup();
  const past = await handler(order({ _now: "2000-01-01T00:00:00Z", options: { fulfillment: "PICKUP", delivery_date: "2001-06-01" } }));
  assert.equal(past.statusCode, 400, past.body);
  assert.match(JSON.parse(past.body).error, /past/i);

  const tables = seed();
  tables.bloom_website_projects[0].commerce_settings = { delivery_lead_days: 5 };
  const lead = fakeAdmin(tables);
  const leadHandler = createStorefrontPublicHandler({ admin: () => lead });
  const tooSoon = await leadHandler(order({ _now: "2000-01-01T00:00:00Z", options: { fulfillment: "PICKUP", delivery_date: isoDaysAhead(1) } }));
  assert.equal(tooSoon.statusCode, 400, tooSoon.body);
  assert.match(JSON.parse(tooSoon.body).error, /lead time/i);
  assertNoMutation(client, "past date");
  assertNoMutation(lead, "lead days");
});

test("storefrontCartTotals rounds every figure to cents", () => {
  const t = storefrontCartTotals([{ price: 19.99, qty: 3 }], 8.25, 4.999, 0);
  assert.equal(t.subtotal, 59.97);
  assert.equal(t.tax, 4.95);
  assert.equal(t.deliveryFee, 5);
  assert.equal(t.total, 69.92);
});

test("customers can see the checkout result: announce() mirrors into a visible notice", () => {
  const html = fs.readFileSync(new URL("../public/storefront/index.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../public/storefront/storefront.js", import.meta.url), "utf8");
  // Source-level wiring check only — the real rendering is proven in a browser.
  assert.match(html, /id="storefrontNotice" class="storefront-notice" hidden>/);
  assert.match(html, /id="storefrontNoticeText" aria-hidden="true"/);
  assert.doesNotMatch(html, /storefrontNotice"[^>]*aria-hidden/, "the container (holding a focusable button) must not be aria-hidden");
  assert.match(js, /getElementById\("storefrontNotice"\)/);
  assert.match(js, /notice\.hidden = !msg;/);
  assert.match(js, /added to cart`, \{ transient: true \}\)/);
  assert.match(js, /cartDrawer"\)\.hidden = false;\s+\/\/ A-1b[^\n]*\n\s+const notice = document\.getElementById\("storefrontNotice"\);\s+if \(notice\) notice\.hidden = true;/, "opening the cart hides any leftover notice");
});

test("storefront overlays out-rank the shared Atelier shell rule that forced them to position: relative", () => {
  const shell = fs.readFileSync(new URL("../public/florisyn-atelier-shell.css", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../public/storefront/storefront.css", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../public/storefront/index.html", import.meta.url), "utf8");
  // The competing rule (specificity 0,1,1) and the body class that activates it.
  assert.ok(/body\.florisyn-atelier-shell > \* \{\s*position: relative;/.test(shell), "shell rule changed — re-check the storefront overlay overrides");
  assert.ok(html.includes('<body class="bloom-storefront florisyn-atelier-shell">'));
  // Our overrides (0,2,1) keep the drawer and notice fixed and inside a 375px viewport.
  assert.ok(css.includes("body.bloom-storefront > .storefront-cart { position: fixed; z-index: 20; box-sizing: border-box; }"));
  assert.ok(css.includes("body.bloom-storefront > .storefront-notice { position: fixed; z-index: 1000; box-sizing: border-box; }"));
});
