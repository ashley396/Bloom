import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { handleOrders, sanitizeOrderMetadata } from "../netlify/functions/orders.js";

/**
 * Homecoming/Prom special-event order support. This reuses the existing
 * order architecture end to end:
 *  - occasion is still the plain `occasion` <select> in the order builder
 *    (public/index.html) — Homecoming/Prom are just two more options.
 *  - special-event details (event date, school/event name, student name,
 *    product type, outfit color, flower colors, notes) live under the
 *    existing orders.metadata jsonb column, namespaced as
 *    metadata.homecoming_prom — the same extensibility mechanism the wire
 *    order intake already uses for its own metadata (see
 *    orders-financial-integrity.test.js).
 *  - the inspiration photo reuses the delivery-proofs storage pattern
 *    (private bucket, shop-id-prefixed path, signed URL only) via a new,
 *    independent `order-attachments` bucket — see
 *    netlify/functions/_shared/order-attachments.js and the accompanying
 *    (not-yet-applied) migration.
 */

const SHOP_ID = "11111111-1111-1111-1111-111111111111";
const USER = { id: "user-a" };

function event(httpMethod, body, queryStringParameters) {
  return { httpMethod, body: JSON.stringify(body), queryStringParameters };
}
function bodyOfResponse(response) {
  return JSON.parse(response.body);
}

// --- 1 & 2: dropdown + conditional fields exist in the shipped UI --------

test("Homecoming and Prom both appear in the order builder's occasion dropdown, existing options untouched", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const match = html.match(/<select name="occasion"[^>]*>[\s\S]*?<\/select>/);
  assert.ok(match, "occasion <select> not found in the order builder");
  const select = match[0];
  const options = [...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(options, [
    "Select occasion",
    "Birthday",
    "Anniversary",
    "Sympathy",
    "Funeral",
    "Get Well",
    "New Baby",
    "Wedding",
    "Homecoming",
    "Prom",
    "Just Because",
    "Other",
  ]);
});

test("choosing Homecoming or Prom reveals a dedicated special-event details section", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="orderHomecomingSection"\s+hidden/, "details section should start hidden");
  for (const field of [
    'name="event_date"',
    'name="event_school_name"',
    'name="event_student_name"',
    'name="event_product_type"',
    'name="event_outfit_color"',
    'name="event_flower_colors"',
    'name="event_special_notes"',
    'id="orderInspirationPhoto"',
  ]) {
    assert.ok(html.includes(field), `expected ${field} in the Homecoming/Prom details section`);
  }
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /HOMECOMING_PROM_OCCASIONS=new Set\(\["Homecoming","Prom"\]\)/);
  assert.match(app, /function toggleHomecomingSection\(/);
  assert.match(app, /\$\("#orderOccasion"\)\?\.addEventListener\("change",toggleHomecomingSection\)/);
});

// --- 3: regular (non-Homecoming/Prom) orders are unaffected --------------

test("a regular order's metadata is untouched when no homecoming/prom fields are sent", async () => {
  let rpcArgs;
  const client = {
    async rpc(name, args) {
      rpcArgs = args;
      return { data: { item: { id: "order-1", ...args.p_order } }, error: null };
    },
  };
  const response = await handleOrders(
    event("POST", {
      customer_name: "Sam",
      occasion: "Birthday",
      arrangement_description: "Dozen roses",
      fulfillment: "PICKUP",
      delivery_date: "2026-09-20",
      subtotal: 60,
    }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {} }
  );
  assert.equal(response.statusCode, 201);
  assert.equal(rpcArgs.p_order.occasion, "Birthday");
  assert.deepEqual(rpcArgs.p_order.metadata, {});
});

test("sanitizeOrderMetadata accepts a homecoming_prom payload like any other metadata object", () => {
  const details = {
    homecoming_prom: {
      event_date: "2026-09-19",
      event_school_name: "Lincoln High School — Homecoming",
      event_student_name: "Jordan Smith",
      event_product_type: "Corsage",
      event_outfit_color: "Emerald green",
      event_flower_colors: "White with emerald accents",
      event_special_notes: "Wrist size 6 inches",
    },
  };
  assert.deepEqual(sanitizeOrderMetadata(details), details);
});

// --- 4: order create stores homecoming/prom metadata ----------------------

test("POST stores Homecoming/Prom details under metadata.homecoming_prom without a table migration", async () => {
  let rpcArgs;
  const client = {
    async rpc(name, args) {
      rpcArgs = args;
      return { data: { item: { id: "order-2", ...args.p_order } }, error: null };
    },
  };
  const response = await handleOrders(
    event("POST", {
      customer_name: "Taylor Reyes",
      occasion: "Homecoming",
      arrangement_description: "Wrist corsage",
      fulfillment: "PICKUP",
      delivery_date: "2026-09-19",
      subtotal: 45,
      metadata: {
        homecoming_prom: {
          event_date: "2026-09-19",
          event_school_name: "Lincoln High School — Homecoming",
          event_student_name: "Jordan Smith",
          event_product_type: "Corsage",
          event_outfit_color: "Emerald green",
          event_flower_colors: "White with emerald accents",
          event_special_notes: "Wrist size 6 inches",
        },
      },
    }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {} }
  );
  assert.equal(response.statusCode, 201);
  assert.equal(rpcArgs.p_order.occasion, "Homecoming");
  assert.equal(rpcArgs.p_order.metadata.homecoming_prom.event_school_name, "Lincoln High School — Homecoming");
  assert.equal(rpcArgs.p_order.metadata.homecoming_prom.event_student_name, "Jordan Smith");
});

// --- 5: inspiration photo belongs to the correct shop/order ---------------

function fakeStorageClient({ uploadResult, signedUrlResult } = {}) {
  const uploads = [];
  const signedUrlCalls = [];
  return {
    client: {
      storage: {
        from(bucket) {
          return {
            async upload(path, buffer, opts) {
              uploads.push({ bucket, path, size: buffer.length, opts });
              return uploadResult || { error: null };
            },
            async createSignedUrl(path, seconds) {
              signedUrlCalls.push({ bucket, path, seconds });
              return signedUrlResult || { data: { signedUrl: `https://signed.example/${path}` }, error: null };
            },
          };
        },
      },
    },
    uploads,
    signedUrlCalls,
  };
}

test("uploaded inspiration photo path is prefixed with the authenticated shop_id (tenant isolation)", async () => {
  const storage = fakeStorageClient();
  let rpcArgs;
  const client = {
    ...storage.client,
    async rpc(name, args) {
      rpcArgs = args;
      return { data: { item: { id: "order-3", ...args.p_order } }, error: null };
    },
  };
  const tinyPngDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const response = await handleOrders(
    event("POST", {
      customer_name: "Taylor Reyes",
      occasion: "Prom",
      arrangement_description: "Bouquet",
      fulfillment: "PICKUP",
      delivery_date: "2026-09-19",
      subtotal: 65,
      metadata: { homecoming_prom: { event_student_name: "Jordan Smith" } },
      inspiration_photo_data_url: tinyPngDataUrl,
    }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {} }
  );
  assert.equal(response.statusCode, 201);
  assert.equal(storage.uploads.length, 1);
  assert.equal(storage.uploads[0].bucket, "order-attachments");
  assert.match(storage.uploads[0].path, new RegExp(`^${SHOP_ID}/\\d+-[0-9a-f-]+\\.png$`));
  assert.equal(rpcArgs.p_order.metadata.homecoming_prom.inspiration_photo_path, storage.uploads[0].path);
  assert.equal(rpcArgs.p_order.metadata.homecoming_prom.event_student_name, "Jordan Smith");
});

test("an invalid inspiration photo upload fails the order save with a clear error, not a silent drop", async () => {
  const storage = fakeStorageClient({ uploadResult: { error: { message: "bucket rejected upload" } } });
  const client = { ...storage.client, async rpc() { throw new Error("must not reach create_order_atomic"); } };
  const response = await handleOrders(
    event("POST", {
      customer_name: "Taylor Reyes",
      occasion: "Prom",
      arrangement_description: "Bouquet",
      fulfillment: "PICKUP",
      delivery_date: "2026-09-19",
      subtotal: 65,
      inspiration_photo_data_url: "data:image/png;base64,AAAA",
    }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {} }
  );
  assert.equal(response.statusCode, 400);
  assert.match(bodyOfResponse(response).error, /bucket rejected upload/);
});

// --- 6: details survive edit — PATCH merges metadata instead of dropping it

function fakePatchClient({ priorOrder, storage }) {
  let updatedPayload;
  const updateFilters = [];
  const client = {
    ...(storage ? storage.client : {}),
    from(table) {
      if (table === "orders") {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              async maybeSingle() {
                return { data: priorOrder, error: null };
              },
            };
          },
          update(payload) {
            updatedPayload = payload;
            return {
              eq(field, value) {
                updateFilters.push([field, value]);
                return this;
              },
              select() {
                return this;
              },
              async single() {
                return { data: { ...priorOrder, ...payload }, error: null };
              },
            };
          },
        };
      }
      if (table === "deliveries") {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              async maybeSingle() {
                return { data: null, error: null };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { client, getUpdatedPayload: () => updatedPayload, getUpdateFilters: () => updateFilters };
}

test("PATCH previously dropped metadata edits entirely — editing Homecoming/Prom details now persists them", async () => {
  const priorOrder = {
    id: "order-4",
    status: "CONFIRMED",
    fulfillment: "PICKUP",
    subtotal: 45,
    tax: 0,
    delivery_fee: 0,
    total: 45,
    tax_rate: 0,
    labor_charge: 0,
    addon_total: 0,
    discount: 0,
    metadata: { homecoming_prom: { event_student_name: "Jordan Smith", event_outfit_color: "Emerald green" } },
  };
  const harness = fakePatchClient({ priorOrder });
  const response = await handleOrders(
    event("PATCH", {
      id: priorOrder.id,
      metadata: { homecoming_prom: { event_student_name: "Jordan Smith", event_outfit_color: "Sapphire blue" } },
    }),
    { currentUser: async () => ({ client: harness.client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {}, recordOrderStatusChange: async () => {} }
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(harness.getUpdatedPayload().metadata.homecoming_prom, {
    event_student_name: "Jordan Smith",
    event_outfit_color: "Sapphire blue",
  });
});

test("PATCH metadata merge preserves unrelated existing keys (e.g. recipe_deducted bookkeeping)", async () => {
  const priorOrder = {
    id: "order-5",
    status: "CONFIRMED",
    fulfillment: "PICKUP",
    subtotal: 45,
    tax: 0,
    delivery_fee: 0,
    total: 45,
    tax_rate: 0,
    labor_charge: 0,
    addon_total: 0,
    discount: 0,
    metadata: { recipe_deducted: true, recipe_deducted_at: "2026-09-01T00:00:00.000Z" },
  };
  const harness = fakePatchClient({ priorOrder });
  const response = await handleOrders(
    event("PATCH", { id: priorOrder.id, metadata: { homecoming_prom: { event_student_name: "New Name" } } }),
    { currentUser: async () => ({ client: harness.client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {}, recordOrderStatusChange: async () => {} }
  );
  assert.equal(response.statusCode, 200);
  const merged = harness.getUpdatedPayload().metadata;
  assert.equal(merged.recipe_deducted, true);
  assert.equal(merged.homecoming_prom.event_student_name, "New Name");
});

test("editing an unrelated homecoming field (no new photo) does not silently drop an already-uploaded inspiration photo", async () => {
  // Regression test: public/app.js's collectHomecomingMetadata() rebuilds
  // homecoming_prom from the visible form fields on every save and never
  // round-trips inspiration_photo_path (it isn't a form field) — so the
  // PATCH body shaped exactly like the real client sends it, below, must
  // still preserve the photo path across an edit that doesn't touch it.
  const priorOrder = {
    id: "order-4b",
    status: "CONFIRMED",
    fulfillment: "PICKUP",
    subtotal: 45,
    tax: 0,
    delivery_fee: 0,
    total: 45,
    tax_rate: 0,
    labor_charge: 0,
    addon_total: 0,
    discount: 0,
    metadata: {
      homecoming_prom: {
        event_student_name: "Jordan Smith",
        event_outfit_color: "Emerald green",
        inspiration_photo_path: `${SHOP_ID}/171234-abc.jpg`,
      },
    },
  };
  const harness = fakePatchClient({ priorOrder });
  const response = await handleOrders(
    // Exactly what collectHomecomingMetadata() produces: the current form
    // fields, no inspiration_photo_path key (it was never a form field to
    // begin with), no inspiration_photo_data_url (no new file was chosen).
    event("PATCH", {
      id: priorOrder.id,
      metadata: { homecoming_prom: { event_student_name: "Jordan Smith", event_outfit_color: "Sapphire blue" } },
    }),
    { currentUser: async () => ({ client: harness.client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {}, recordOrderStatusChange: async () => {} }
  );
  assert.equal(response.statusCode, 200);
  const merged = harness.getUpdatedPayload().metadata.homecoming_prom;
  assert.equal(merged.event_outfit_color, "Sapphire blue", "the actual edit must still go through");
  assert.equal(merged.inspiration_photo_path, `${SHOP_ID}/171234-abc.jpg`, "existing photo path must survive an unrelated edit");
});

test("PATCH can replace the inspiration photo without touching other homecoming fields", async () => {
  const priorOrder = {
    id: "order-6",
    status: "CONFIRMED",
    fulfillment: "PICKUP",
    subtotal: 45,
    tax: 0,
    delivery_fee: 0,
    total: 45,
    tax_rate: 0,
    labor_charge: 0,
    addon_total: 0,
    discount: 0,
    metadata: { homecoming_prom: { event_student_name: "Jordan Smith", inspiration_photo_path: `${SHOP_ID}/old.jpg` } },
  };
  const storage = fakeStorageClient();
  const harness = fakePatchClient({ priorOrder, storage });
  const response = await handleOrders(
    event("PATCH", { id: priorOrder.id, inspiration_photo_data_url: "data:image/jpeg;base64,AAAA" }),
    { currentUser: async () => ({ client: harness.client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {}, recordOrderStatusChange: async () => {} }
  );
  assert.equal(response.statusCode, 200);
  const merged = harness.getUpdatedPayload().metadata;
  assert.equal(merged.homecoming_prom.event_student_name, "Jordan Smith");
  assert.notEqual(merged.homecoming_prom.inspiration_photo_path, `${SHOP_ID}/old.jpg`);
  assert.match(merged.homecoming_prom.inspiration_photo_path, new RegExp(`^${SHOP_ID}/`));
});

// --- reload: GET a signed URL scoped to the requesting shop ---------------

test("GET ?view=inspiration_photo only returns a signed URL for an order in the caller's own shop", async () => {
  const storage = fakeStorageClient();
  const path = `${SHOP_ID}/171234-abc.jpg`;
  const client = {
    ...storage.client,
    from(table) {
      assert.equal(table, "orders");
      return {
        select() {
          return {
            eq(field, value) {
              if (field === "shop_id") assert.equal(value, SHOP_ID, "must filter by the caller's shop_id");
              return this;
            },
            async maybeSingle() {
              return { data: { id: "order-7", metadata: { homecoming_prom: { inspiration_photo_path: path } } }, error: null };
            },
          };
        },
      };
    },
  };
  const response = await handleOrders(
    event("GET", undefined, { order_id: "order-7", view: "inspiration_photo" }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }) }
  );
  assert.equal(response.statusCode, 200);
  const body = bodyOfResponse(response);
  assert.equal(body.signed_url, `https://signed.example/${path}`);
  assert.equal(storage.signedUrlCalls[0].bucket, "order-attachments");
  assert.equal(storage.signedUrlCalls[0].path, path);
});

test("GET ?view=inspiration_photo returns null (not an error) when no photo is on file", async () => {
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: { id: "order-8", metadata: {} }, error: null };
            },
          };
        },
      };
    },
  };
  const response = await handleOrders(
    event("GET", undefined, { order_id: "order-8", view: "inspiration_photo" }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }) }
  );
  assert.equal(response.statusCode, 200);
  assert.equal(bodyOfResponse(response).signed_url, null);
});

// --- storage migration (not yet applied) matches the delivery-proofs pattern

// ============================================================================
// Matching boutonniere — a second linked piece inside the SAME Homecoming/
// Prom order (metadata.homecoming_prom.matching_boutonniere), not a second
// order or customer. Event date, school, customer, and inspiration photo
// are entered once on the main piece and shared/inherited, not re-entered.
// ============================================================================

test("the 'Matching Boutonniere Needed' checkbox and its section exist and start collapsed", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="orderMatchingBoutonniere"[^>]*name="event_matching_boutonniere_needed"/);
  assert.match(html, /Matching Boutonniere Needed/);
  assert.match(html, /id="orderBoutonniereSection"[^>]*hidden/, "boutonniere section should start hidden/collapsed");
  for (const field of [
    'name="boutonniere_recipient_name"',
    'name="boutonniere_match_to"',
    'name="boutonniere_flower_details"',
    'name="boutonniere_notes"',
    'name="boutonniere_price"',
  ]) {
    assert.ok(html.includes(field), `expected ${field} in the matching boutonniere section`);
  }
});

test("the boutonniere flower/color field is a plain editable input, not read-only or disabled", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const match = html.match(/<input name="boutonniere_flower_details"[^>]*>/);
  assert.ok(match, "boutonniere_flower_details input not found");
  assert.doesNotMatch(match[0], /readonly|disabled/);
});

test("checking the box wires up show/hide and a one-time prefill from the main piece's fields", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /\$\("#orderMatchingBoutonniere"\)\?\.addEventListener\("change",e=>\{toggleBoutonniereSection\(\);if\(e\.target\.checked\)prefillBoutonniereFromMainPiece\(\)\}\)/);
  assert.match(app, /function toggleBoutonniereSection\(/);
  assert.match(app, /function prefillBoutonniereFromMainPiece\(/);
  // inherits outfit color + flower colors + student name, but only fills blank fields (stays editable, not overwritten every time)
  assert.match(app, /event_outfit_color/);
  assert.match(app, /event_flower_colors/);
  assert.match(app, /event_student_name/);
  assert.match(app, /!flowerDetails\.value\.trim\(\)/, "prefill should only fill an empty field, never overwrite an edit");
});

test("the board card and piece summary both surface '2 PIECES' when a boutonniere is needed", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /function homecomingPieceBadge\(o\)\{return o\?\.metadata\?\.homecoming_prom\?\.matching_boutonniere\?\.needed\?" · 🎓 2 PIECES \(\+boutonniere\)":""\}/);
  assert.match(app, /\$\{homecomingPieceBadge\(o\)\}/, "board card meta line must render the badge");
  assert.match(app, /needed\?`2 PIECES/, "the in-dialog piece summary must also say 2 PIECES when needed");
});

test("event date, school, and customer are shown once and never re-collected for the boutonniere", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const boutonniereSection = html.match(/<div id="orderBoutonniereSection"[\s\S]*?<\/div><\/section>/)[0];
  for (const forbidden of ['name="event_date"', 'name="event_school_name"', 'name="customer_name"']) {
    assert.ok(!boutonniereSection.includes(forbidden), `boutonniere section must not duplicate ${forbidden}`);
  }
  assert.match(boutonniereSection, /same customer, same event, same inspiration photo above/i);
});

test("unchecked state: POST with no matching_boutonniere key creates no boutonniere on the order", async () => {
  let rpcArgs;
  const client = {
    async rpc(name, args) {
      rpcArgs = args;
      return { data: { item: { id: "order-9", ...args.p_order } }, error: null };
    },
  };
  const response = await handleOrders(
    event("POST", {
      customer_name: "Taylor Reyes",
      occasion: "Homecoming",
      arrangement_description: "Wrist corsage",
      fulfillment: "PICKUP",
      delivery_date: "2026-09-19",
      subtotal: 45,
      metadata: { homecoming_prom: { event_student_name: "Jordan Smith" } },
    }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {} }
  );
  assert.equal(response.statusCode, 201);
  assert.equal(rpcArgs.p_order.metadata.homecoming_prom.matching_boutonniere, undefined);
});

test("checked state: POST persists full matching-boutonniere details linked under the same order's metadata", async () => {
  let rpcArgs;
  const client = {
    async rpc(name, args) {
      rpcArgs = args;
      return { data: { item: { id: "order-10", ...args.p_order } }, error: null };
    },
  };
  const response = await handleOrders(
    event("POST", {
      customer_name: "Taylor Reyes",
      occasion: "Homecoming",
      arrangement_description: "Wrist corsage",
      fulfillment: "PICKUP",
      delivery_date: "2026-09-19",
      subtotal: 45,
      metadata: {
        homecoming_prom: {
          event_student_name: "Jordan Smith",
          event_outfit_color: "Emerald green",
          matching_boutonniere: {
            needed: true,
            recipient_name: "Jordan Smith",
            match_to: "Corsage",
            flower_details: "Match main piece: white with emerald accents (dress: Emerald green)",
            notes: "Pin, don't tape",
            price: 12,
          },
        },
      },
    }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {} }
  );
  assert.equal(response.statusCode, 201);
  const boutonniere = rpcArgs.p_order.metadata.homecoming_prom.matching_boutonniere;
  assert.equal(boutonniere.needed, true);
  assert.equal(boutonniere.recipient_name, "Jordan Smith");
  assert.equal(boutonniere.match_to, "Corsage");
  assert.equal(boutonniere.price, 12);
  // same order — one customer, one order id, no second order created
  assert.equal(rpcArgs.p_order.customer_name, "Taylor Reyes");
});

test("details survive edit: PATCH can add a boutonniere to an existing homecoming order without disturbing its own fields", async () => {
  const priorOrder = {
    id: "order-11",
    status: "CONFIRMED",
    fulfillment: "PICKUP",
    subtotal: 45,
    tax: 0,
    delivery_fee: 0,
    total: 45,
    tax_rate: 0,
    labor_charge: 0,
    addon_total: 0,
    discount: 0,
    metadata: { homecoming_prom: { event_student_name: "Jordan Smith", event_outfit_color: "Emerald green" } },
  };
  const harness = fakePatchClient({ priorOrder });
  const response = await handleOrders(
    event("PATCH", {
      id: priorOrder.id,
      metadata: {
        homecoming_prom: {
          event_student_name: "Jordan Smith",
          event_outfit_color: "Emerald green",
          matching_boutonniere: { needed: true, recipient_name: "Jordan Smith", price: 12 },
        },
      },
    }),
    { currentUser: async () => ({ client: harness.client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {}, recordOrderStatusChange: async () => {} }
  );
  assert.equal(response.statusCode, 200);
  const merged = harness.getUpdatedPayload().metadata.homecoming_prom;
  assert.equal(merged.event_student_name, "Jordan Smith");
  assert.equal(merged.matching_boutonniere.needed, true);
  assert.equal(merged.matching_boutonniere.price, 12);
});

test("details survive edit: PATCH can remove a previously-added boutonniere by omitting it (unchecking the box)", async () => {
  const priorOrder = {
    id: "order-12",
    status: "CONFIRMED",
    fulfillment: "PICKUP",
    subtotal: 45,
    tax: 0,
    delivery_fee: 0,
    total: 45,
    tax_rate: 0,
    labor_charge: 0,
    addon_total: 0,
    discount: 0,
    metadata: { homecoming_prom: { event_student_name: "Jordan Smith", matching_boutonniere: { needed: true, price: 12 } } },
  };
  const harness = fakePatchClient({ priorOrder });
  // The client always resends the full, freshly-collected homecoming_prom object on
  // every save (collectHomecomingMetadata) — with the box unchecked it simply omits
  // matching_boutonniere, and homecoming_prom is fully replaced (not deep-merged),
  // so the boutonniere is dropped rather than left stranded from a stale save.
  const response = await handleOrders(
    event("PATCH", { id: priorOrder.id, metadata: { homecoming_prom: { event_student_name: "Jordan Smith" } } }),
    { currentUser: async () => ({ client: harness.client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {}, recordOrderStatusChange: async () => {} }
  );
  assert.equal(response.statusCode, 200);
  const merged = harness.getUpdatedPayload().metadata.homecoming_prom;
  assert.equal(merged.matching_boutonniere, undefined);
});

test("inspiration photo stays associated with the order for both pieces — same path, not duplicated per piece", async () => {
  const storage = fakeStorageClient();
  let rpcArgs;
  const client = {
    ...storage.client,
    async rpc(name, args) {
      rpcArgs = args;
      return { data: { item: { id: "order-13", ...args.p_order } }, error: null };
    },
  };
  const response = await handleOrders(
    event("POST", {
      customer_name: "Taylor Reyes",
      occasion: "Homecoming",
      arrangement_description: "Wrist corsage",
      fulfillment: "PICKUP",
      delivery_date: "2026-09-19",
      subtotal: 45,
      metadata: { homecoming_prom: { matching_boutonniere: { needed: true, price: 12 } } },
      inspiration_photo_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {} }
  );
  assert.equal(response.statusCode, 201);
  assert.equal(storage.uploads.length, 1, "exactly one photo upload for the whole order, not one per piece");
  const path = rpcArgs.p_order.metadata.homecoming_prom.inspiration_photo_path;
  assert.ok(path);
  assert.equal(rpcArgs.p_order.metadata.homecoming_prom.matching_boutonniere.needed, true);
});

test("regular (non-Homecoming/Prom) orders are unaffected by the boutonniere feature", async () => {
  let rpcArgs;
  const client = {
    async rpc(name, args) {
      rpcArgs = args;
      return { data: { item: { id: "order-14", ...args.p_order } }, error: null };
    },
  };
  const response = await handleOrders(
    event("POST", {
      customer_name: "Sam",
      occasion: "Sympathy",
      arrangement_description: "Standing spray",
      fulfillment: "PICKUP",
      delivery_date: "2026-09-20",
      subtotal: 120,
    }),
    { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER }), writeShopAudit: async () => {} }
  );
  assert.equal(response.statusCode, 201);
  assert.deepEqual(rpcArgs.p_order.metadata, {});
});

test("the (unapplied, pending-review) order-attachments storage migration is private and shop-scoped, matching delivery-proofs", () => {
  // Lives in supabase/pending_migrations/, not supabase/migrations/ — that
  // directory is a gated, reviewed canonical list (see
  // florisyn-live-schema-snapshot.test.js's exact-file-list assertion) and a
  // draft, unapplied migration must not be dropped into it or CI's
  // canonical-migration-set check breaks. Ashley/ChatGPT promote this file
  // (git mv + update that test's expected list) only once it's reviewed and
  // actually applied.
  const sql = fs.readFileSync(
    new URL("../supabase/pending_migrations/20260909230000_order_inspiration_photos_storage.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /insert into storage\.buckets[\s\S]*?'order-attachments'[\s\S]*?false,/);
  assert.match(sql, /public\.is_shop_member\(\(storage\.foldername\(name\)\)\[1\]::uuid\)/);
  assert.match(sql, /for select[\s\S]*?to authenticated/);
  assert.match(sql, /for insert[\s\S]*?to authenticated/);
  assert.doesNotMatch(sql, /to anon/);
});
