import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStorefrontPublicHandler } from "../netlify/functions/storefront-public.js";
import { createInstantWebsiteHandler } from "../netlify/functions/instant-website.js";
import {
  deliveryDateValid,
  earliestFulfillmentDate,
  resolveShopTimeZone,
  shopLocalDateString,
  generateWebOrderNumber,
  isOrderNumberConflict,
  parseCartQuantity,
  resolveStorefrontPaymentModes
} from "../netlify/functions/_shared/bloom-storefront-commerce.js";
import { storefrontCartTotals } from "../netlify/functions/_shared/bloom-storefront-core.js";
import { buildPublishChecklist } from "../lib/website-studio/publish-checklist.js";

// Phase A-1c (2026-09-28): storefront & website integrity. Drives the REAL
// storefront and Website Studio handlers over a table-aware fake service-role
// client (which enforces orders.order_number UNIQUE like the real schema).
// Stripe is a stub: no network, no real charge.

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";
const P = {
  rose: "11111111-1111-4111-8111-111111111111", // taxable, $19.99
  card: "22222222-2222-4222-8222-222222222222", // NOT taxable, $5.00
  hidden: "33333333-3333-4333-8333-333333333333",
  inactive: "44444444-4444-4444-8444-444444444444",
  deleted: "55555555-5555-4555-8555-555555555555",
  otherShop: "66666666-6666-4666-8666-666666666666",
  vase: "77777777-7777-4777-8777-777777777777" // taxable, $10.00
};

function product(id, shopId, overrides = {}) {
  return {
    id, shop_id: shopId, name: `Item ${id.slice(0, 4)}`, description: "Fresh", price: 19.99, taxable: true,
    image_url: null, category: "Everyday", active: true, available_online: true, deleted_at: null, ...overrides
  };
}

function seed({ taxRate = 8.25, timezone = "America/Chicago", commerce = {}, connect = null, catalog = [] } = {}) {
  return {
    shops: [
      { id: SHOP_A, slug: "shop-a", name: "Shop A", phone: "555-010-0100", tax_rate: taxRate, default_delivery_fee: 10, timezone, stripe_connect_account_id: connect },
      { id: SHOP_B, slug: "shop-b", name: "Shop B", tax_rate: 0, default_delivery_fee: 0, timezone: "UTC", stripe_connect_account_id: null }
    ],
    shop_hours: [],
    bloom_website_projects: [{ id: PROJECT_A, shop_id: SHOP_A, status: "published", theme_id: "garden", commerce_settings: commerce, seo_settings: {} }],
    bloom_website_pages: [{ id: "home", shop_id: SHOP_A, project_id: PROJECT_A, slug: "home", title: "Home", visible: true, nav_order: 0, sections: [] }],
    bloom_shop_catalog_products: catalog,
    products: [
      product(P.rose, SHOP_A, { name: "Rose Bouquet" }),
      product(P.card, SHOP_A, { name: "Greeting Card", price: 5, taxable: false }),
      product(P.vase, SHOP_A, { name: "Glass Vase", price: 10 }),
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

/**
 * Fake service-role client: real eq/is filtering, records writes, enforces
 * orders.order_number UNIQUE, and — like PostgREST — answers a `products`
 * select naming a column the real schema doesn't have with { error } (42703),
 * not a throw. That is exactly how the old publish gate silently saw 0 products.
 */
function fakeAdmin(tables, { failInsert } = {}) {
  const writes = [];
  const insertAttempts = [];
  let seq = 0;
  return {
    writes,
    insertAttempts,
    from(table) {
      const rows = tables[table] || (tables[table] = []);
      const filters = [];
      let selectError = null;
      const apply = () => rows.filter((r) => filters.every((f) => f(r)));
      const result = () => (selectError ? { data: null, error: selectError } : null);
      const builder = {
        select(cols = "*") {
          if (table === "products" && cols !== "*") {
            const unknown = cols.split(",").map((c) => c.trim()).filter((c) => c && !productsSchemaColumns().has(c));
            if (unknown.length) selectError = { code: "42703", message: `column products.${unknown[0]} does not exist` };
          }
          return builder;
        },
        eq(c, v) { filters.push((r) => String(r[c]) === String(v)); return builder; },
        is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return builder; },
        order() { return builder; },
        limit() { return builder; },
        insert(payload) {
          insertAttempts.push({ table, payload: { ...payload } });
          let error = null;
          if (failInsert && table === "orders") error = failInsert(payload);
          if (!error && table === "orders" && rows.some((r) => r.order_number === payload.order_number)) {
            error = { code: "23505", message: 'duplicate key value violates unique constraint "orders_order_number_key"', details: `Key (order_number)=(${payload.order_number}) already exists.` };
          }
          let inserted = null;
          if (!error) {
            seq += 1;
            inserted = { id: `${table}-${seq}`, ...payload };
            rows.push(inserted);
            writes.push({ table, payload });
          }
          const single = async () => ({ data: inserted, error });
          return { data: null, error, select() { return { single }; }, then(res, rej) { return Promise.resolve({ data: null, error }).then(res, rej); } };
        },
        maybeSingle: async () => result() || { data: apply()[0] || null, error: null },
        single: async () => result() || { data: apply()[0] || null, error: null },
        then(resolve, reject) { return Promise.resolve(result() || { data: apply(), error: null }).then(resolve, reject); }
      };
      return builder;
    }
  };
}

function stripeStub({ chargesEnabled = true, retrieveFails = false } = {}) {
  const created = [];
  const retrieved = [];
  return {
    created,
    retrieved,
    factory: (key, options) => ({
      accounts: {
        retrieve: async (id) => {
          retrieved.push({ id, options });
          if (retrieveFails) throw new Error("stripe timeout");
          return { id, charges_enabled: chargesEnabled };
        }
      },
      checkout: { sessions: { create: async (params) => { created.push(params); return { id: "cs_test_stub", url: "https://checkout.stripe.test/cs" }; } } }
    })
  };
}

async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function setup(seedOpts = {}, { stripe = stripeStub(), newOrderNumber, failInsert } = {}) {
  const tables = seed(seedOpts);
  const client = fakeAdmin(tables, { failInsert });
  const handler = createStorefrontPublicHandler({ admin: () => client, createStripe: stripe.factory, newOrderNumber });
  return { tables, client, handler, stripe };
}

let ip = 0;
function post(body, shopTz = "America/Chicago") {
  ip += 1;
  const date = earliestFulfillmentDate({ leadDays: 2, timeZone: shopTz });
  return {
    httpMethod: "POST",
    headers: { "x-forwarded-for": `10.77.${Math.floor(ip / 250)}.${ip % 250}`, origin: "https://www.florisyn.com" },
    queryStringParameters: {},
    body: JSON.stringify({
      action: "create_web_order",
      shop_slug: "shop-a",
      payment_mode: "pay_later",
      cart: { lines: [{ id: P.rose, qty: 1 }] },
      customer: { name: "Web Buyer", phone: "555-010-0100" },
      ...body,
      options: { fulfillment: "PICKUP", delivery_date: date, ...(body?.options || {}) }
    })
  };
}
const get = (handler) => handler({ httpMethod: "GET", headers: {}, queryStringParameters: { shop: "shop-a" } });
const orderRows = (client) => client.writes.filter((w) => w.table === "orders").map((w) => w.payload);
function assertNoMutation(client, label) {
  for (const table of ["orders", "payment_hub_payment_links", "bloom_storefront_order_events"]) {
    assert.equal(client.writes.filter((w) => w.table === table).length, 0, `${label}: unexpected write to ${table}`);
  }
}

// ------------------------------------------------------------------ 1. taxable

test("tax: a taxable product is taxed at the shop's rate", async () => {
  const { handler, client } = setup({ taxRate: 8.25 });
  const res = await handler(post({ cart: { lines: [{ id: P.rose, qty: 3 }] } }));
  assert.equal(res.statusCode, 201, res.body);
  const [row] = orderRows(client);
  assert.deepEqual([row.subtotal, row.tax, row.tax_rate, row.total], [59.97, 4.95, 8.25, 64.92]);
});

test("tax: a non-taxable product (products.taxable = false) is not taxed", async () => {
  const { handler, client } = setup({ taxRate: 8.25 });
  const res = await handler(post({ cart: { lines: [{ id: P.card, qty: 2 }] } }));
  assert.equal(res.statusCode, 201, res.body);
  const [row] = orderRows(client);
  assert.deepEqual([row.subtotal, row.tax, row.total], [10, 0, 10]);
});

test("tax: a mixed cart taxes only the taxable line amounts", async () => {
  const { handler, client } = setup({ taxRate: 8.25 });
  const res = await handler(post({ cart: { lines: [{ id: P.rose, qty: 1 }, { id: P.card, qty: 2 }] } }));
  assert.equal(res.statusCode, 201, res.body);
  const [row] = orderRows(client);
  // taxable base 19.99 → 1.649175 → 1.65; the $10 of cards is untaxed
  assert.deepEqual([row.subtotal, row.tax, row.total], [29.99, 1.65, 31.64]);
});

test("tax: a forged browser `taxable` flag and a forged tax rate are both ignored", async () => {
  const { handler, client } = setup({ taxRate: 8.25 });
  const res = await handler(post({
    cart: { lines: [{ id: P.rose, qty: 1, taxable: false, tax_rate: 0 }, { id: P.card, qty: 2, taxable: true }] },
    tax_rate: 50,
    options: { tax_rate: 0, taxable: false, tax: 0 }
  }));
  assert.equal(res.statusCode, 201, res.body);
  const [row] = orderRows(client);
  assert.deepEqual([row.subtotal, row.tax, row.tax_rate, row.total], [29.99, 1.65, 8.25, 31.64]);
});

test("tax: every figure is rounded to cents (mixed cart, fractional rate, delivery fee untaxed)", async () => {
  const { handler, client } = setup({ taxRate: 7.125 });
  const res = await handler(post({
    cart: { lines: [{ id: P.rose, qty: 3 }, { id: P.card, qty: 2 }] },
    options: { fulfillment: "DELIVERY", delivery_address: "1 Elm St" }
  }));
  assert.equal(res.statusCode, 201, res.body);
  const [row] = orderRows(client);
  // taxable 59.97 × 7.125% = 4.2728… → 4.27; + $10 cards + $10 delivery fee
  assert.deepEqual([row.subtotal, row.tax, row.delivery_fee, row.total], [69.97, 4.27, 10, 84.24]);
  const t = storefrontCartTotals([{ price: 19.99, qty: 3, taxable: true }, { price: 5, qty: 2, taxable: false }], 7.125, 0, 0);
  assert.deepEqual([t.subtotal, t.taxableSubtotal, t.tax, t.total], [69.97, 59.97, 4.27, 74.24]);
});

test("tax: the public product list carries each product's real taxable flag (for the cart estimate)", async () => {
  const { handler } = setup();
  const body = JSON.parse((await get(handler)).body);
  const byId = Object.fromEntries(body.products.map((p) => [String(p.id), p.taxable]));
  assert.equal(byId[P.rose], true);
  assert.equal(byId[P.card], false);
});

// ------------------------------------------------------------------ 2. quantity

test("quantity: 0, negative, fractional, non-numeric and over-maximum quantities are rejected — never turned into 1", async () => {
  const { handler, client } = setup();
  for (const qty of [0, -1, 1.5, "1.5", "abc", "NaN", null, "", 100, 1000, true, [2], { n: 2 }]) {
    const res = await handler(post({ cart: { lines: [{ id: P.rose, qty }] } }));
    assert.equal(res.statusCode, 400, `qty=${JSON.stringify(qty)}: ${res.body}`);
    assert.match(JSON.parse(res.body).error, /whole number from 1 to 99/);
  }
  const missing = await handler(post({ cart: { lines: [{ id: P.rose }] } }));
  assert.equal(missing.statusCode, 400, missing.body);
  assertNoMutation(client, "invalid quantities");
});

test("quantity: whole numbers 1–99 are accepted and charged exactly", async () => {
  assert.deepEqual([1, 99, "2", " 7 "].map(parseCartQuantity), [1, 99, 2, 7]);
  const { handler, client } = setup({ taxRate: 0 });
  const res = await handler(post({ cart: { lines: [{ id: P.vase, qty: 99 }] } }));
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(orderRows(client)[0].subtotal, 990);
  assert.match(orderRows(client)[0].arrangement_description, /^99 × Glass Vase$/);
});

// ------------------------------------------------------------------ 3. shop-local dates

test("dates: 'today' is the shop's own calendar day around UTC midnight, for shops in different timezones", () => {
  // 03:30 UTC on Oct 1 is still Sep 30 in Los Angeles and Chicago, already Oct 1 in Tokyo.
  const afterUtcMidnight = new Date("2026-10-01T03:30:00Z");
  assert.equal(shopLocalDateString(afterUtcMidnight, "America/Los_Angeles"), "2026-09-30");
  assert.equal(shopLocalDateString(afterUtcMidnight, "America/Chicago"), "2026-09-30");
  assert.equal(shopLocalDateString(afterUtcMidnight, "Asia/Tokyo"), "2026-10-01");
  assert.equal(deliveryDateValid("2026-09-30", 0, afterUtcMidnight, "America/Los_Angeles").valid, true, "same-day pickup for an LA shop at 8:30pm local");
  assert.equal(deliveryDateValid("2026-09-30", 0, afterUtcMidnight, "Asia/Tokyo").valid, false, "already yesterday in Tokyo");
  // 23:30 UTC on Sep 30 is already Oct 1 in Tokyo, still Sep 30 in LA.
  const beforeUtcMidnight = new Date("2026-09-30T23:30:00Z");
  assert.equal(deliveryDateValid("2026-09-30", 0, beforeUtcMidnight, "Asia/Tokyo").valid, false);
  assert.equal(deliveryDateValid("2026-09-30", 0, beforeUtcMidnight, "America/Los_Angeles").valid, true);
  // lead days count from the shop-local day
  assert.equal(earliestFulfillmentDate({ leadDays: 2, now: afterUtcMidnight, timeZone: "America/Los_Angeles" }), "2026-10-02");
  assert.equal(earliestFulfillmentDate({ leadDays: 2, now: afterUtcMidnight, timeZone: "Asia/Tokyo" }), "2026-10-03");
  // across a month/year boundary
  assert.equal(earliestFulfillmentDate({ leadDays: 1, now: new Date("2027-01-01T02:00:00Z"), timeZone: "America/Denver" }), "2027-01-01");
});

test("dates: no zone is assumed — a missing or invalid shop timezone falls back to UTC, reported as a fallback", () => {
  assert.deepEqual(resolveShopTimeZone("America/Chicago"), { timeZone: "America/Chicago", fallback: false });
  assert.deepEqual(resolveShopTimeZone(null), { timeZone: "UTC", fallback: true });
  assert.deepEqual(resolveShopTimeZone("Mars/Olympus_Mons"), { timeZone: "UTC", fallback: true });
  assert.equal(shopLocalDateString(new Date("2026-10-01T03:30:00Z"), "Mars/Olympus_Mons"), "2026-10-01");
});

test("dates: the real handler validates against the shop's timezone (two shops a full day apart, at any moment)", async () => {
  // UTC−11 and UTC+14 are always on different calendar days.
  const behind = "Pacific/Pago_Pago";
  const ahead = "Pacific/Kiritimati";
  const behindToday = shopLocalDateString(new Date(), behind);
  const aheadToday = shopLocalDateString(new Date(), ahead);
  assert.notEqual(behindToday, aheadToday);

  const a = setup({ timezone: behind });
  const okBehind = await a.handler(post({ options: { delivery_date: behindToday } }, behind));
  assert.equal(okBehind.statusCode, 201, `same-day order in a UTC−11 shop: ${okBehind.body}`);
  assert.equal(orderRows(a.client)[0].delivery_date, behindToday);

  const b = setup({ timezone: ahead });
  const pastAhead = await b.handler(post({ options: { delivery_date: behindToday } }, ahead));
  assert.equal(pastAhead.statusCode, 400, pastAhead.body);
  assert.match(JSON.parse(pastAhead.body).error, /past/i);
  assertNoMutation(b.client, "past date in a UTC+14 shop");
  const okAhead = await b.handler(post({ options: { delivery_date: aheadToday } }, ahead));
  assert.equal(okAhead.statusCode, 201, okAhead.body);

  // The public site gives the browser the same shop-local earliest date.
  const site = JSON.parse((await get(b.handler)).body);
  assert.equal(site.commerce.earliest_date, aheadToday);
});

// ------------------------------------------------------------------ 4. order numbers

test("order numbers: human-readable WEB-<shop-local YYMMDD>-<6 chars>, no ambiguous characters", () => {
  let i = 0;
  const seq = [0, 1, 2, 29, 30, 31];
  const n = generateWebOrderNumber({ now: new Date("2026-10-01T03:30:00Z"), timeZone: "America/Los_Angeles", randomInt: () => seq[i++] });
  assert.equal(n, "WEB-260930-234XYZ");
  for (let k = 0; k < 200; k += 1) assert.match(generateWebOrderNumber({ timeZone: "UTC" }), /^WEB-\d{6}-[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(isOrderNumberConflict({ code: "23505", message: 'duplicate key value violates unique constraint "orders_order_number_key"' }), true);
  assert.equal(isOrderNumberConflict({ code: "23505", message: 'duplicate key value violates unique constraint "some_other_key"' }), false);
  assert.equal(isOrderNumberConflict({ code: "23514", message: "order_number check" }), false);
});

test("order numbers: a collision is retried with a fresh number and the order is saved once", async () => {
  const numbers = ["WEB-260930-AAAAAA", "WEB-260930-AAAAAA", "WEB-260930-BBBBBB"];
  const { handler, client, tables } = setup({}, { newOrderNumber: () => numbers.shift() });
  tables.orders.push({ id: "existing", shop_id: SHOP_B, order_number: "WEB-260930-AAAAAA" });
  const res = await handler(post({}));
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).order.order_number, "WEB-260930-BBBBBB");
  assert.equal(client.insertAttempts.filter((a) => a.table === "orders").length, 3);
  assert.equal(orderRows(client).length, 1);
});

test("order numbers: if every attempt collides the customer gets a retryable 503 and nothing is written", async () => {
  const { handler, client, tables } = setup({}, { newOrderNumber: () => "WEB-260930-AAAAAA" });
  tables.orders.push({ id: "existing", shop_id: SHOP_B, order_number: "WEB-260930-AAAAAA" });
  const res = await handler(post({}));
  assert.equal(res.statusCode, 503, res.body);
  assert.equal(client.insertAttempts.filter((a) => a.table === "orders").length, 3);
  assertNoMutation(client, "exhausted order-number retries");
});

test("order numbers: a non-collision insert error is not retried", async () => {
  const { handler, client } = setup({}, { failInsert: () => ({ code: "23514", message: "violates check constraint" }) });
  const res = await handler(post({}));
  assert.equal(res.statusCode >= 500, true, res.body);
  assert.equal(client.insertAttempts.filter((a) => a.table === "orders").length, 1);
  assertNoMutation(client, "non-conflict insert failure");
});

test("order numbers: 40 concurrent web orders all succeed with distinct numbers (real generator, UNIQUE enforced)", async () => {
  const { handler, client } = setup({ taxRate: 0 });
  const results = await Promise.all(Array.from({ length: 40 }, () => handler(post({}))));
  for (const r of results) assert.equal(r.statusCode, 201, r.body);
  const numbers = orderRows(client).map((r) => r.order_number);
  assert.equal(new Set(numbers).size, 40);
  for (const n of numbers) assert.match(n, /^WEB-\d{6}-[2-9A-HJ-NP-Z]{6}$/);
});

// ------------------------------------------------------------------ 5. no payment option

test("no payment option: pay-later off and card not ready → the site says so before checkout, and the server refuses with no mutation", async () => {
  await withEnv({ STRIPE_SECRET_KEY: undefined }, async () => {
    const { handler, client } = setup({ commerce: { pay_later_enabled: false } });
    const site = JSON.parse((await get(handler)).body);
    assert.deepEqual(site.commerce.payment_modes, []);
    assert.equal(site.commerce.ordering_available, false);
    assert.match(site.commerce.unavailable_message, /currently unavailable/i);
    for (const mode of ["pay_later", "pay_now"]) {
      const res = await handler(post({ payment_mode: mode, action: mode === "pay_now" ? "create_web_checkout" : "create_web_order" }));
      assert.equal(res.statusCode, 403, res.body);
      assert.equal(JSON.parse(res.body).code, "online_ordering_unavailable");
    }
    assertNoMutation(client, "no payment option");
  });
  // A connected account id that can't accept charges is still "no option".
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_stub_only" }, async () => {
    const { handler, client } = setup({ commerce: { pay_later_enabled: false }, connect: "acct_pending" }, { stripe: stripeStub({ chargesEnabled: false }) });
    assert.equal(JSON.parse((await get(handler)).body).commerce.ordering_available, false);
    const res = await handler(post({ payment_mode: "pay_later" }));
    assert.equal(res.statusCode, 403, res.body);
    assertNoMutation(client, "pay-later off + half-onboarded Connect");
  });
});

test("no payment option: pay-later off but card checkout genuinely ready → only pay-now is offered", async () => {
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_stub_only" }, async () => {
    const { handler } = setup({ commerce: { pay_later_enabled: false }, connect: "acct_ready" });
    const site = JSON.parse((await get(handler)).body);
    assert.deepEqual(site.commerce.payment_modes, ["pay_now"]);
    assert.equal(site.commerce.ordering_available, true);
  });
  assert.deepEqual(resolveStorefrontPaymentModes({ stripe_checkout_enabled: true, pay_later_enabled: true }, {}), ["pay_later"], "readiness is never assumed");
});

test("no payment option: the storefront UI shows the message and disables Place order before submission", () => {
  const html = fs.readFileSync(new URL("../public/storefront/index.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../public/storefront/storefront.js", import.meta.url), "utf8");
  assert.match(html, /id="checkoutUnavailable"/);
  assert.match(js, /const unavailable = commerce\.ordering_available === false \|\| !modes\.length;/);
  assert.match(js, /if \(submit\) submit\.disabled = unavailable;/);
});

// ------------------------------------------------------------------ 8. customer email

test("customer email is persisted on the web order (orders.metadata.customer_email) through the normal contract", async () => {
  const { handler, client } = setup();
  const res = await handler(post({ customer: { name: "Web Buyer", phone: "555-010-0100", email: " buyer@example.com " } }));
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(orderRows(client)[0].metadata, { source: "storefront", customer_email: "buyer@example.com" });

  const noEmail = setup();
  await noEmail.handler(post({}));
  assert.deepEqual(orderRows(noEmail.client)[0].metadata, { source: "storefront" });

  const bad = setup();
  const r = await bad.handler(post({ customer: { name: "Web Buyer", phone: "555-010-0100", email: "not-an-email" } }));
  assert.equal(r.statusCode, 400, r.body);
  assertNoMutation(bad.client, "invalid email");
});

// ------------------------------------------------------------------ 7. Website Studio

function studio(seedOpts) {
  const tables = seed(seedOpts);
  const client = fakeAdmin(tables);
  const handler = createInstantWebsiteHandler({
    currentUser: async () => ({ client, shopId: SHOP_A, user: { id: "owner-1" }, role: "owner" })
  });
  const call = (body) => handler({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(body) });
  return { tables, client, call };
}

// Real bloom_shop_catalog_products shape: product fields live in the `data`
// jsonb; publish_status and sync are columns (baseline migration).
const CATALOG_PUBLISHED = { id: "cat-1", shop_id: SHOP_A, publish_status: "published", sync: { available_online: true }, data: { name: "Library Peonies", retail_price: 65, primary_image: { url: "https://cdn.example/p.jpg", alt: "Peonies" } } };
const CATALOG_DRAFT = { id: "cat-2", shop_id: SHOP_A, publish_status: "draft", sync: { available_online: true }, data: { name: "Draft Tulips", retail_price: 40 } };

test("Website Studio: the Launch checklist counts the shop's real online products (not the request body, not 0)", async () => {
  const { call } = studio({ catalog: [CATALOG_PUBLISHED, CATALOG_DRAFT] });
  const res = await call({ action: "publish_checklist", products: Array.from({ length: 9 }, () => ({ publish_status: "published", sync: { available_online: true } })) });
  assert.equal(res.statusCode, 200, res.body);
  const d = JSON.parse(res.body);
  // rose + card + vase (legacy, online) + the published library product; hidden,
  // inactive, deleted, other-shop and draft products are excluded; body ignored.
  assert.equal(d.kpis.online_products, 4);
  assert.equal(d.items.find((i) => i.id === "products_online").pass, true);
});

test("Website Studio: the publish gate sees legitimate products (was always 0 — phantom columns)", async () => {
  const withProducts = studio({ catalog: [CATALOG_PUBLISHED] });
  const res = await withProducts.call({ action: "publish", approved: true });
  assert.equal(res.statusCode, 409, res.body); // still blocked: this fixture has no SEO/sections
  const failing = JSON.parse(res.body).items.map((i) => i.id);
  assert.equal(failing.includes("products_online"), false, `products must be counted: ${failing}`);

  const tooFew = studio();
  tooFew.tables.products = tooFew.tables.products.filter((p) => p.id === P.rose);
  const res2 = await tooFew.call({ action: "publish", approved: true });
  assert.equal(JSON.parse(res2.body).items.map((i) => i.id).includes("products_online"), true, "one product is genuinely too few");
});

test("Website Studio checklist: 'online' means published AND available online (same rule as the storefront)", () => {
  const products = [
    { publish_status: "published", sync: { available_online: true } },
    { publish_status: "published", sync: { available_online: true } },
    { publish_status: "published", sync: {} },
    { publish_status: undefined, sync: { available_online: true } },
    {}
  ];
  assert.equal(buildPublishChecklist({ products }).kpis.online_products, 2);
});

// ------------------------------------------------------------------ schema drift guard

let productsColumnsCache = null;
function productsSchemaColumns() {
  if (productsColumnsCache) return productsColumnsCache;
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n");
  const cols = new Set();
  const create = /create table if not exists public\.products \(([\s\S]*?)\n\);/.exec(sql);
  assert.ok(create, "products table definition not found in migrations");
  for (const line of create[1].split("\n")) {
    const m = /^\s*([a-z_]+)\s+[a-z]/.exec(line);
    if (m && !/^(primary|unique|constraint|foreign|check)$/.test(m[1])) cols.add(m[1]);
  }
  for (const alter of sql.matchAll(/alter table (?:if exists )?public\.products\s+([\s\S]*?);/g)) {
    for (const add of alter[1].matchAll(/add column (?:if not exists )?([a-z_]+)/g)) cols.add(add[1]);
  }
  productsColumnsCache = cols;
  return cols;
}

function jsFiles(dirUrl) {
  const root = dirUrl.pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) out.push(p);
    }
  };
  walk(decodeURIComponent(root));
  return out;
}

test("schema drift: every explicit products column list in functions/lib names a real products column", () => {
  const cols = productsSchemaColumns();
  for (const c of ["id", "shop_id", "name", "price", "taxable", "active", "available_online", "deleted_at", "image_url", "category"]) {
    assert.ok(cols.has(c), `expected products.${c} in migrations`);
  }
  const offenders = [];
  for (const file of [...jsFiles(new URL("../netlify/functions/", import.meta.url)), ...jsFiles(new URL("../lib/", import.meta.url))]) {
    const src = fs.readFileSync(file, "utf8");
    for (const q of src.matchAll(/from\("products"\)\s*\.select\("([^"]+)"\)/g)) {
      const missing = q[1].split(",").map((x) => x.trim().split(/[:(\s]/)[0]).filter((x) => x && x !== "*" && !cols.has(x));
      if (missing.length) offenders.push(`${path.basename(file)}: ${missing.join(", ")}`);
    }
  }
  assert.deepEqual(offenders, [], "a products select names columns that do not exist (supabase-js returns { error } and callers can silently read 0 rows)");
});

test("schema drift: the shared online-product loader only reads real products columns", () => {
  const cols = productsSchemaColumns();
  const src = fs.readFileSync(new URL("../netlify/functions/_shared/bloom-storefront-products.js", import.meta.url), "utf8");
  const read = new Set([...src.matchAll(/\bp\.([a-z_]+)/g)].map((m) => m[1]));
  const missing = [...read].filter((c) => !cols.has(c));
  assert.deepEqual(missing, []);
  const studioSrc = fs.readFileSync(new URL("../netlify/functions/instant-website.js", import.meta.url), "utf8");
  assert.doesNotMatch(studioSrc, /publish_status,sync,primary_image/);
  assert.equal((studioSrc.match(/await loadStorefrontVisibleProducts\(client, shopId\)/g) || []).length, 2, "both the Launch checklist and the publish gate use the storefront's reader");
});

// ------------------------------------------------------------------ storefront CSS (source checks; rendering proven in a real browser)

test("storefront CSS: sticky header, out-of-flow skip link, stacked checkout labels, inline checkout errors", () => {
  const css = fs.readFileSync(new URL("../public/storefront/storefront.css", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../public/storefront/storefront.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../public/storefront/index.html", import.meta.url), "utf8");
  assert.ok(css.includes("body.bloom-storefront > .storefront-header { position: sticky; top: 0; z-index: 10; }"));
  assert.ok(css.includes("body.bloom-storefront > .skip-link { position: absolute; z-index: 99; }"));
  assert.match(css, /\.checkout-form label \{\s*display: block;/);
  assert.doesNotMatch(css, /\}\s*\n\s*display: block;\s*\n\s*margin-bottom: 10px;/, "no selector-less rule body (it invalidated the input rule after it)");
  assert.match(html, /id="checkoutError"[^>]*hidden><\/p>\s*<button type="submit" class="primary" id="checkoutSubmit">/);
  assert.match(js, /showCheckoutError\(err\);\s*announce\(err, \{ visual: false \}\);/);
  // the shared shell file is untouched by these fixes
  const shell = fs.readFileSync(new URL("../public/florisyn-atelier-shell.css", import.meta.url), "utf8");
  assert.match(shell, /body\.florisyn-atelier-shell > \* \{\s*position: relative;/);
});

// ------------------------------------------------------------------ independent-review follow-ups

test("client: the storefront uses the server's shop-local earliest date for the default and minimum", () => {
  // Evaluate the real defaultDeliveryDate() from storefront.js (it lives in an IIFE).
  const js = fs.readFileSync(new URL("../public/storefront/storefront.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = js.indexOf("  function defaultDeliveryDate(leadDays) {");
  const end = js.indexOf("\n  }\n", start) + 4;
  assert.ok(start > 0 && end > start);
  const make = new Function("state", `${js.slice(start, end)}\nreturn defaultDeliveryDate;`);
  assert.equal(make({ commerce: { earliest_date: "2031-05-06" } })(0), "2031-05-06");
  // fallback (no server date) is the browser's LOCAL calendar day, not UTC
  const fallback = make({ commerce: null })(0);
  const d = new Date();
  assert.equal(fallback, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  assert.equal(make({ commerce: { earliest_date: "not-a-date" } })(0), fallback);
});

test("client: add-to-cart never builds a line over the 99 maximum", () => {
  const js = fs.readFileSync(new URL("../public/storefront/storefront.js", import.meta.url), "utf8");
  assert.match(js, /if \(line && line\.qty >= 99\) \{/);
});

test("readiness: the Stripe lookup uses a short timeout with no retries, and an outage is cached briefly", async () => {
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_stub_only" }, async () => {
    const down = stripeStub({ retrieveFails: true });
    const { handler } = setup({ connect: "acct_x" }, { stripe: down });
    for (let i = 0; i < 3; i += 1) {
      const site = JSON.parse((await get(handler)).body);
      assert.deepEqual(site.commerce.payment_modes, ["pay_later"], "an outage hides pay-now but the page still loads");
    }
    assert.equal(down.retrieved.length, 1, "failures are cached briefly instead of re-hitting Stripe per page view");
    assert.deepEqual(down.retrieved[0].options, { timeout: 3000, maxNetworkRetries: 0 });
  });
});

test("readiness: Stripe is never asked when card checkout is disabled for the shop", async () => {
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_stub_only" }, async () => {
    const stripe = stripeStub();
    const { handler, client } = setup({ connect: "acct_x", commerce: { stripe_checkout_enabled: false } }, { stripe });
    const site = JSON.parse((await get(handler)).body);
    assert.deepEqual(site.commerce.payment_modes, ["pay_later"]);
    const res = await handler(post({ payment_mode: "pay_now", action: "create_web_checkout" }));
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(stripe.retrieved.length, 0);
    assertNoMutation(client, "pay-now while card checkout is disabled");
  });
});

test("quantity: the 99 maximum applies per product even across duplicate lines; malformed carts are a clean 400", async () => {
  const { handler, client } = setup();
  const split = await handler(post({ cart: { lines: [{ id: P.rose, qty: 60 }, { id: P.rose, qty: 60 }] } }));
  assert.equal(split.statusCode, 400, split.body);
  assert.match(JSON.parse(split.body).error, /whole number from 1 to 99/);
  for (const lines of [[null], "abc", { id: P.rose, qty: 1 }, [42]]) {
    const res = await handler(post({ cart: { lines } }));
    assert.equal(res.statusCode, 400, `lines=${JSON.stringify(lines)}: ${res.body}`);
  }
  assertNoMutation(client, "malformed carts");
});

test("dates: the lead-time message shows the whole-day rule actually enforced", () => {
  const r = deliveryDateValid("2026-10-01", 2.5, new Date("2026-10-01T12:00:00Z"), "UTC");
  assert.equal(r.valid, false);
  assert.equal(r.error, "Orders need at least 2 day(s) lead time.");
});

test("Website Studio: restoring the old phantom-column select would make the fake fail exactly like PostgREST", async () => {
  const client = fakeAdmin(seed());
  const { data, error } = await client.from("products").select("publish_status,sync,primary_image").eq("shop_id", SHOP_A);
  assert.equal(data, null);
  assert.equal(error.code, "42703");
});
