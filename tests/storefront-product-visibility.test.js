import test from "node:test";
import assert from "node:assert/strict";
import { createStorefrontPublicHandler, legacyProductIsPublic } from "../netlify/functions/storefront-public.js";
import { signPreviewToken } from "../netlify/functions/_shared/bloom-storefront-core.js";

// Phase A-1 (2026-09-28): a product a florist explicitly excluded from
// online sale must never appear on the public storefront, its sitemap, or
// be purchasable through web checkout. The old loader tested a
// non-existent `show_online` column (always true) and never excluded
// soft-deleted rows. These tests drive the REAL handler with a
// table-aware fake service-role client — the only stub is the database.

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";

const P = {
  visible: "11111111-1111-4111-8111-111111111111",
  notOnline: "22222222-2222-4222-8222-222222222222",
  inactive: "33333333-3333-4333-8333-333333333333",
  deleted: "44444444-4444-4444-8444-444444444444",
  otherShop: "55555555-5555-4555-8555-555555555555",
  nullFlag: "66666666-6666-4666-8666-666666666666"
};

function product(id, shopId, overrides = {}) {
  return {
    id,
    shop_id: shopId,
    name: `Product ${id.slice(0, 4)}`,
    description: "Fresh arrangement",
    price: 45,
    image_url: `https://cdn.example/${id}.jpg`,
    category: "Everyday",
    active: true,
    available_online: true,
    deleted_at: null,
    ...overrides
  };
}

function seed({ projectStatus = "published", includeProject = true } = {}) {
  return {
    shops: [
      { id: SHOP_A, slug: "shop-a", name: "Shop A", tax_rate: 6, default_delivery_fee: 0, website_published: projectStatus === "published" },
      { id: SHOP_B, slug: "shop-b", name: "Shop B", tax_rate: 6, default_delivery_fee: 0, website_published: true }
    ],
    bloom_website_projects: includeProject ? [{ id: PROJECT_A, shop_id: SHOP_A, status: projectStatus, theme_id: "garden", settings: {} }] : [],
    bloom_website_pages: includeProject ? [{ id: "page-home", shop_id: SHOP_A, project_id: PROJECT_A, slug: "home", title: "Home", visible: true, nav_order: 0, sections: [] }] : [],
    bloom_shop_catalog_products: [],
    products: [
      product(P.visible, SHOP_A),
      product(P.notOnline, SHOP_A, { available_online: false }),
      product(P.inactive, SHOP_A, { active: false }),
      product(P.deleted, SHOP_A, { deleted_at: "2026-09-01T00:00:00Z" }),
      product(P.nullFlag, SHOP_A, { available_online: null }),
      product(P.otherShop, SHOP_B)
    ]
  };
}

/** Table-aware fake of the service-role client: real eq/is filtering on seeded rows. */
function fakeAdmin(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const rows = tables[table] || [];
      const filters = [];
      const record = { table, ops: [] };
      calls.push(record);
      const apply = () => rows.filter((r) => filters.every((f) => f(r)));
      const builder = {
        select() { record.ops.push("select"); return builder; },
        eq(col, val) { record.ops.push(["eq", col, val]); filters.push((r) => String(r[col]) === String(val)); return builder; },
        is(col, val) { record.ops.push(["is", col, val]); filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return builder; },
        order() { return builder; },
        limit() { return builder; },
        insert(payload) { record.ops.push(["insert", payload]); const inserted = { id: "new-row", ...payload }; return { select() { return { single: async () => ({ data: inserted, error: null }) }; } }; },
        maybeSingle: async () => ({ data: apply()[0] || null, error: null }),
        single: async () => ({ data: apply()[0] || null, error: apply()[0] ? null : { message: "no rows" } }),
        then(resolve, reject) { return Promise.resolve({ data: apply(), error: null }).then(resolve, reject); }
      };
      return builder;
    }
  };
}

function handlerFor(tables) {
  const client = fakeAdmin(tables);
  return { client, handler: createStorefrontPublicHandler({ admin: () => client, currentUser: async () => { throw Object.assign(new Error("no session"), { statusCode: 401 }); } }) };
}

function get(qs) {
  return { httpMethod: "GET", headers: {}, queryStringParameters: qs };
}

test("legacyProductIsPublic: only available_online=true AND active<>false AND deleted_at IS NULL", () => {
  assert.equal(legacyProductIsPublic(product("x", SHOP_A)), true);
  assert.equal(legacyProductIsPublic(product("x", SHOP_A, { available_online: false })), false);
  assert.equal(legacyProductIsPublic(product("x", SHOP_A, { available_online: null })), false);
  assert.equal(legacyProductIsPublic(product("x", SHOP_A, { available_online: undefined })), false);
  assert.equal(legacyProductIsPublic(product("x", SHOP_A, { active: false })), false);
  assert.equal(legacyProductIsPublic(product("x", SHOP_A, { deleted_at: "2026-01-01T00:00:00Z" })), false);
  assert.equal(legacyProductIsPublic(null), false);
});

test("published storefront: an available-online product appears (1) and (7)", async () => {
  const { handler } = handlerFor(seed());
  const res = await handler(get({ shop: "shop-a" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.preview, false);
  assert.equal(body.site.allowed, true);
  const ids = body.products.map((p) => String(p.id));
  assert.deepEqual(ids, [P.visible]);
  assert.equal(body.products[0].sync.available_online, true);
});

test("published storefront never exposes: available_online=false (2), inactive (3), soft-deleted (4), null flag, another shop's product (5)", async () => {
  const { handler, client } = handlerFor(seed());
  const res = await handler(get({ shop: "shop-a" }));
  const ids = new Set(JSON.parse(res.body).products.map((p) => String(p.id)));
  for (const hidden of [P.notOnline, P.inactive, P.deleted, P.nullFlag, P.otherShop]) {
    assert.equal(ids.has(hidden), false, `${hidden} leaked to the public storefront`);
  }
  // The products query itself is shop-scoped and excludes deleted rows.
  const productsQuery = client.calls.find((c) => c.table === "products");
  assert.ok(productsQuery.ops.some((op) => Array.isArray(op) && op[0] === "eq" && op[1] === "shop_id" && op[2] === SHOP_A));
  assert.ok(productsQuery.ops.some((op) => Array.isArray(op) && op[0] === "is" && op[1] === "deleted_at" && op[2] === null));
});

test("collection and search filters can't resurrect a hidden product", async () => {
  const { handler } = handlerFor(seed());
  for (const qs of [{ shop: "shop-a", collection: "everyday" }, { shop: "shop-a", q: "Product" }, { shop: "shop-a", q: P.notOnline.slice(0, 4) }]) {
    const res = await handler(get(qs));
    const ids = JSON.parse(res.body).products.map((p) => String(p.id));
    assert.ok(!ids.includes(P.notOnline) && !ids.includes(P.inactive) && !ids.includes(P.deleted), JSON.stringify(qs));
  }
});

test("unpublished storefront exposes nothing (6): draft project → 404, no project → 404, and no product data in the body", async () => {
  for (const tables of [seed({ projectStatus: "draft" }), seed({ includeProject: false })]) {
    const { handler, client } = handlerFor(tables);
    const res = await handler(get({ shop: "shop-a" }));
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.products, undefined);
    assert.match(body.error, /not published/i);
    assert.equal(client.calls.some((c) => c.table === "products"), false, "products must not even be queried for an unpublished site");
  }
});

test("a signed preview of a draft site still applies the same visibility rules", async () => {
  process.env.BLOOM_STOREFRONT_PREVIEW_SECRET = "test-preview-secret";
  try {
    const { handler } = handlerFor(seed({ projectStatus: "draft" }));
    const token = signPreviewToken(SHOP_A, Date.now() + 60_000);
    const res = await handler(get({ shop: "shop-a", preview_token: token }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.preview, true);
    assert.deepEqual(body.products.map((p) => String(p.id)), [P.visible]);
  } finally {
    delete process.env.BLOOM_STOREFRONT_PREVIEW_SECRET;
  }
});

test("sitemap (8): lists only the visible product; hidden/inactive/deleted/other-shop ids never appear; draft site → 403", async () => {
  const { handler } = handlerFor(seed());
  const res = await handler(get({ shop: "shop-a", action: "sitemap" }));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, new RegExp(`/product/${P.visible}<`));
  for (const hidden of [P.notOnline, P.inactive, P.deleted, P.nullFlag, P.otherShop]) {
    assert.doesNotMatch(res.body, new RegExp(hidden), `${hidden} leaked into the sitemap`);
  }
  const draft = handlerFor(seed({ projectStatus: "draft" }));
  const res2 = await draft.handler(get({ shop: "shop-a", action: "sitemap" }));
  assert.equal(res2.statusCode, 403);
  assert.doesNotMatch(res2.body, /product\//);
});

test("web checkout cannot buy a hidden product: the cart is reconciled against the same public catalog", async () => {
  const { handler, client } = handlerFor(seed());
  const today = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const attempt = async (id) =>
    handler({
      httpMethod: "POST",
      headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` },
      queryStringParameters: {},
      body: JSON.stringify({
        action: "create_web_order",
        shop_slug: "shop-a",
        cart: { lines: [{ id, qty: 1 }] },
        customer: { name: "Web Buyer", phone: "555-010-0100" },
        options: { fulfillment: "PICKUP", delivery_date: today },
        payment_mode: "pay_later"
      })
    });
  for (const hidden of [P.notOnline, P.inactive, P.deleted, P.otherShop]) {
    const res = await attempt(hidden);
    assert.equal(res.statusCode, 400, `${hidden}: ${res.body}`);
    assert.match(JSON.parse(res.body).error, /no longer available/i);
  }
  // Positive path: the visible product IS purchasable — proves the catalog
  // is populated, so the rejections above are real rejections, not an
  // empty catalog rejecting everything. (Tightened to 201 in A-1b, which
  // fixed the missing-delivery-date validation defect.)
  const ok = await attempt(P.visible);
  assert.equal(ok.statusCode, 201, ok.body);
  const insert = client.calls.find((c) => c.table === "orders")?.ops.find((op) => Array.isArray(op) && op[0] === "insert")?.[1];
  assert.equal(insert.shop_id, SHOP_A);
  assert.equal(insert.subtotal, 45);
  assert.equal(insert.tax_rate, 6);
});

test("the storefront reads legacy products through exactly one loader (no second, ungated query)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../netlify/functions/storefront-public.js", import.meta.url), "utf8");
  assert.equal((src.match(/from\("products"\)/g) || []).length, 1);
  assert.doesNotMatch(src, /p\.show_online/, "the non-existent show_online column must never be read again");
  assert.match(src, /\.is\("deleted_at", null\)/);
  assert.match(src, /available_online: legacyProductIsPublic\(p\)/);
});
