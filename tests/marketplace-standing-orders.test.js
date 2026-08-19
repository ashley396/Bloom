import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { matchStandingOrderItems } from "../netlify/functions/_shared/marketplace-products.js";

const root = process.cwd();

test("matchStandingOrderItems matches by real product name/variety against the seller's CURRENT listings, never a stored price", () => {
  const listings = [
    { id: "l1", shop_id: "s1", product_name: "Freedom Rose", price: 3, unit: "stem", active: true, archived_at: null, publish_status: "published" },
    { id: "l2", shop_id: "s1", product_name: "White Hydrangea", price: 5, unit: "stem", active: true, archived_at: null, publish_status: "published" },
  ];
  const matches = matchStandingOrderItems(
    [{ name: "Freedom rose", quantity: 100 }, { name: "White hydrangea", quantity: 50 }, { name: "Eucalyptus bunch", quantity: 5 }],
    listings
  );
  assert.equal(matches.length, 3);
  assert.equal(matches[0].available, true);
  assert.equal(matches[0].listing_id, "l1");
  assert.equal(matches[0].current_price, 3);
  assert.equal(matches[1].available, true);
  assert.equal(matches[2].available, false, "an item with no current listing must be flagged, never dropped or invented");
  assert.equal(matches[2].listing_id, null);
});

test("matchStandingOrderItems never matches a sold-out or unpublished listing", () => {
  const matches = matchStandingOrderItems(
    [{ name: "Freedom rose", quantity: 10 }],
    [{ id: "l1", product_name: "Freedom Rose", price: 3, active: true, archived_at: null, publish_status: "published", availability_status: "sold_out" }]
  );
  assert.equal(matches[0].available, false);
});

test("standing orders migration ties every row to a real buyer (auth.uid()), one policy, no separate insert/select/update policies to drift", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260819230000_marketplace_standing_orders.sql"), "utf8");
  assert.match(sql, /cadence_weekday text not null check \(cadence_weekday in \('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'\)\)/);
  assert.match(sql, /for all using \(buyer_user_id = auth\.uid\(\)\) with check \(buyer_user_id = auth\.uid\(\)\)/);
});

test("loadStandingOrders computes due_today from the shop's own local weekday, not the server's UTC one", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  const fn = src.slice(src.indexOf("async function loadStandingOrders"), src.indexOf("async function saveStandingOrder"));
  assert.match(fn, /shopDateStr\(shopRow\?\.timezone\)/);
  assert.match(fn, /weekdayLabel\(/);
  assert.match(fn, /dueToday = row\.active && row\.cadence_weekday === todayCode/);
  // Only computes (and therefore only queries listings for) a due-today
  // order from a still-verified seller — never wastes a query recomputing
  // a preview for every row, and never previews a lapsed seller's items.
  assert.match(fn, /if \(dueToday && sellerVerified\)/);
});

test("loadStandingOrders re-checks every referenced seller's CURRENT verification status, not just at setup time", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  const fn = src.slice(src.indexOf("async function loadStandingOrders"), src.indexOf("async function saveStandingOrder"));
  assert.match(fn, /verifiedShopIds = await loadVerifiedSellerShopIds\(sellerIds\)/);
  assert.match(fn, /seller_verified: sellerVerified/);
});

test("saveStandingOrder rejects a request with no real items, no label, or an invalid cadence", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  const fn = src.slice(src.indexOf("async function saveStandingOrder"), src.indexOf("async function deleteStandingOrder"));
  assert.match(fn, /!body\.seller_shop_id \|\| !String\(body\.label \|\| ""\)\.trim\(\) \|\| !items\.length/);
  assert.match(fn, /Object\.values\(WEEKDAY_CODES\)\.includes\(body\.cadence_weekday\)/);
  // An edit is ownership-checked before the update is allowed to proceed.
  assert.match(fn, /existing\.buyer_user_id !== user\.id/);
});

test("marketplace-catalog.js wires the standing-orders resource/actions", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.match(src, /resource === "standing-orders"/);
  assert.match(src, /action === "save_standing_order"/);
  assert.match(src, /action === "delete_standing_order"/);
});

test("buyer UI never auto-adds a standing order to the cart — only a real button click, and only for available items", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /data-market-standing-order-add/);
  assert.match(js, /if \(!item\.available \|\| !item\.listing_id\)/);
  assert.match(js, /parseStandingOrderItems/);

  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="marketplaceStandingOrderForm"/);
  assert.match(html, /id="marketplaceStandingOrdersList"/);
});

test("standing order card tells the buyer plainly when the seller has lost verification, instead of silently offering a dead add-to-cart button", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  const fn = js.slice(js.indexOf("function standingOrderCardHtml"), js.indexOf("function standingOrderCardHtml") + 2000);
  assert.match(fn, /!so\.seller_verified/);
  assert.match(fn, /this seller is no longer verified/i);
  // A lapsed seller must never still offer the add-to-cart action, even if
  // a stale preview from before the lapse is still present on the row.
  const dueTodayBranchIndex = fn.indexOf("so.due_today && !so.seller_verified");
  const addButtonIndex = fn.indexOf("data-market-standing-order-add");
  assert.ok(dueTodayBranchIndex !== -1 && dueTodayBranchIndex < addButtonIndex, "the seller-verified check must be branched on before the add-to-cart button is ever rendered");
});
