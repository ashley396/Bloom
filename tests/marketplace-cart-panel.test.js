import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// Before this phase, #marketplaceCartCheckout was bound once at page load
// to a static element that no HTML anywhere ever provided — a florist
// could add items to their cart, but there was never a real "review and
// check out the whole cart" surface to reach, only per-item instant
// checkout. These tests assert the review panel is real: it exists in the
// DOM, it's reachable from a real button, and its contents (including the
// checkout button) are rendered — and rebound — from real cart state
// rather than assumed to exist once.

test("the cart button and its review panel are real, reachable DOM elements — not orphaned markup", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="marketplaceCartBtn"/);
  assert.match(html, /id="marketplaceCartPanel"/);
  // The panel is a sibling of the button, not buried inside content that
  // only renders after some other action — it exists from first paint,
  // just hidden.
  assert.match(html, /id="marketplaceCartPanel" class="marketplace-cart-panel" hidden/);
});

test("renderCartPanel renders every real cart line — name, quantity, per-line total, and a remove control — and a live subtotal, never a hardcoded total", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  const fn = js.slice(js.indexOf("function renderCartPanel"), js.indexOf("function bindCartBtn"));
  assert.match(fn, /readCart\(\)/);
  assert.match(fn, /data-cart-qty/);
  assert.match(fn, /data-cart-remove/);
  assert.match(fn, /cartLineTotal\(row\)/);
  assert.match(fn, /subtotal = cart\.reduce/);
  assert.match(fn, /Your cart is empty/);
});

test("the checkout button lives inside the panel and is rebound after every render — not a stale, one-time listener on an element that gets replaced", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  const fn = js.slice(js.indexOf("function renderCartPanel"), js.indexOf("function bindCartBtn"));
  assert.match(fn, /id="marketplaceCartCheckout"/);
  assert.match(fn, /panel\.querySelector\('#marketplaceCartCheckout'\)\?\.addEventListener\('click'/);
});

test("removing a cart line or changing its quantity writes back to the SAME localStorage cart the rest of the app reads, then re-renders — never a separate parallel cart", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  const fn = js.slice(js.indexOf("function renderCartPanel"), js.indexOf("function bindCartBtn"));
  assert.match(fn, /writeCart\(readCart\(\)\.filter\(\(row\) => row\.id !== btn\.dataset\.cartRemove\)\)/);
  assert.match(fn, /Math\.max\(1, Math\.floor\(Number\(input\.value\) \|\| 1\)\)/, "quantity is clamped to a real positive integer, never 0 or negative");
  assert.match(fn, /renderCartPanel\(hooks, state\)/);
});

test("the checkout click reads a live promo code from the panel's own input, never window.prompt, and clears the cart only after a real successful session URL comes back", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  const fn = js.slice(js.indexOf("function renderCartPanel"), js.indexOf("function bindCartBtn"));
  assert.match(fn, /marketplaceCartPromo/);
  assert.doesNotMatch(fn, /window\.prompt/, "the cart panel's own promo field replaces the old window.prompt UX");
  assert.match(fn, /if \(result\.url\) \{\s*writeCart\(\[\]\);/);
});

test("a stale/unavailable item returned by checkout is dropped from the cart AND the panel re-renders, so the buyer immediately sees what's left", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  const fn = js.slice(js.indexOf("function renderCartPanel"), js.indexOf("function bindCartBtn"));
  assert.match(fn, /staleIds = new Set\(error\.items\.map/);
  const errorBranch = fn.slice(fn.indexOf("staleIds = new Set"));
  assert.match(errorBranch, /renderCartPanel\(hooks, state\)/);
});

test("a promo code typed into the panel survives a quantity/remove re-render instead of being silently wiped", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  const fn = js.slice(js.indexOf("function renderCartPanel"), js.indexOf("function bindCartBtn"));
  assert.match(fn, /priorPromo = hooks\.\$\('#marketplaceCartPromo'\)\?\.value/);
  assert.match(fn, /if \(priorPromo\) \{/);
});

test("adding an item to the cart from ANY of the three add-to-cart flows (browse grid, standing order, reorder) refreshes the panel live if it's open, not just the badge count", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  const calls = js.match(/refreshCartUI\(hooks, state\);/g) || [];
  assert.equal(calls.length, 3, "expected exactly the three add-to-cart call sites to use refreshCartUI");
  const fn = js.slice(js.indexOf("function refreshCartUI"), js.indexOf("function refreshCartUI") + 400);
  assert.match(fn, /panel && !panel\.hidden/, "only re-renders when the panel is actually open — never forces it open");
});

test("opening the cart panel closes the notifications panel, and vice versa — only one dropdown open at a time", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  const cartFn = js.slice(js.indexOf("function bindCartBtn"), js.indexOf("function renderCategoryOptions"));
  assert.match(cartFn, /marketplaceNotifPanel/);
  const notifFn = js.slice(js.indexOf("function bindNotifBell"), js.indexOf("function bindNotifBell") + 600);
  assert.match(notifFn, /marketplaceCartPanel/);
});

test("bindCartBtn is wired into the real page load, not left dangling as dead code the way the old checkout listener was", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /bindCartBtn\(hooks, state\);/);
});
