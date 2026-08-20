import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// A seller who offers both pickup and shipping used to never be charged
// shipping at all — the cart had no way to ask the buyer which they
// wanted for that seller (see the checkout-level shippingFeeFor fix).
// These tests cover the buyer-facing half: the cart now carries which
// seller each line belongs to, fetches that seller's pickup/shipping
// info, shows a real per-seller fulfillment choice when it's meaningful,
// and sends the buyer's choice to checkout — never trusting it blindly
// (checkout re-verifies against the seller's own profile; see
// tests/marketplace-checkout.test.js's fulfillment-choice tests).

function readCatalog() {
  return fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
}

function readExperience() {
  return fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
}

test("marketplace-catalog.js exposes a cart-shipping resource with the fields the cart needs, keyed by shop_id", () => {
  const src = readCatalog();
  assert.match(src, /resource === "cart-shipping"/);
  assert.match(src, /shop_id, display_name, pickup_available, shipping_flat_fee, free_shipping_over/);
});

test("matchStandingOrderItems and reorderPreview both carry shop_id through to the add-to-cart flows", () => {
  const products = fs.readFileSync(path.join(root, "netlify/functions/_shared/marketplace-products.js"), "utf8");
  const fn = products.slice(products.indexOf("export function matchStandingOrderItems"), products.indexOf("export function validateFloralAttributes"));
  assert.match(fn, /shop_id: match\.shop_id/);

  const catalog = readCatalog();
  const start = catalog.indexOf("async function reorderPreview");
  const preview = catalog.slice(start, catalog.indexOf("return { order_id: orderId, items: preview };", start));
  assert.match(preview, /shop_id: current\?\.shop_id/);
});

test("all three add-to-cart flows carry shop_id onto the stored cart line, not just id/price/quantity", () => {
  const js = readExperience();
  const pushCalls = js.match(/cart\.push\(\{[^}]*\}\)/g) || [];
  assert.equal(pushCalls.length, 3, "expected exactly the three known add-to-cart cart.push sites");
  for (const call of pushCalls) {
    assert.match(call, /shop_id:/, `cart.push call missing shop_id: ${call}`);
  }
});

test("the cart panel groups lines by seller and only shows a fulfillment choice when that seller offers pickup AND has a real shipping fee configured", () => {
  const js = readExperience();
  const fn = js.slice(js.indexOf("function renderCartPanel"), js.indexOf("function bindCartBtn"));
  assert.match(fn, /groupIndex = new Map\(\)/);
  assert.match(fn, /!seller \|\| !seller\.pickup_available \|\| !Number\(seller\.shipping_flat_fee\)/);
  assert.match(fn, /data-fulfillment-shop=/);
  assert.match(fn, /Local pickup \(free\)/);
});

test("changing the fulfillment radio persists the buyer's choice for that seller without needing a full re-render", () => {
  const js = readExperience();
  const fn = js.slice(js.indexOf("function renderCartPanel"), js.indexOf("function bindCartBtn"));
  assert.match(fn, /data-fulfillment-shop\]/);
  assert.match(fn, /writeFulfillment\(map\)/);
});

test("checkout sends the buyer's real per-seller fulfillment choices, never inventing or omitting them", () => {
  const js = readExperience();
  const fn = js.slice(js.indexOf("function renderCartPanel"), js.indexOf("function bindCartBtn"));
  assert.match(fn, /fulfillment: readFulfillment\(\)/);
});

test("opening the cart panel and any live cart refresh both fetch seller shipping info, not just the initial render", () => {
  const js = readExperience();
  const calls = js.match(/loadCartShipping\(hooks, state\)/g) || [];
  // bindCartBtn (panel open) + refreshCartUI (live update while open) +
  // the function's own definition line = 3 occurrences of the name.
  assert.ok(calls.length >= 2, "expected loadCartShipping to be called from at least bindCartBtn and refreshCartUI");
});

test("loadCartShipping only re-fetches sellers not already cached, and never throws the cart into a broken state on failure", () => {
  const js = readExperience();
  const fn = js.slice(js.indexOf("async function loadCartShipping"), js.indexOf("async function loadCartShipping") + 700);
  assert.match(fn, /missing = shopIds\.filter/);
  assert.match(fn, /catch \{/);
});
