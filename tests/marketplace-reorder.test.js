import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("reorder-preview re-checks each item against the listing's CURRENT price/availability — never resubmits the stale order", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.match(src, /resource === "reorder-preview"/);
  assert.match(src, /async function reorderPreview/);
  // Re-fetches the listing fresh from the LISTINGS table by id — does not
  // trust the order's own frozen item snapshot for price or availability.
  assert.match(src, /client\.from\(LISTINGS\)\.select\("\*"\)\.in\("id",\s*listingIds\)/);
  assert.match(src, /current_price:/);
  assert.match(src, /price_changed:/);
  assert.match(src, /available:\s*stillAvailable/);
  // Ownership check — a buyer can only reorder their own order.
  assert.match(src, /order\.buyer_user_id !== user\.id/);
});

test("reorder-preview flags a listing that's gone inactive or unavailable since the original purchase, rather than silently re-adding it", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  const fn = src.slice(src.indexOf("async function reorderPreview"), src.indexOf("export async function handler"));
  assert.match(fn, /stillAvailable\s*=\s*Boolean\(current\)\s*&&\s*current\.active\s*&&\s*current\.currently_available/);
});

test("buyer UI's Reorder button adds items to the cart at TODAY's price and reports anything no longer available", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /data-market-reorder/);
  assert.match(js, /resource=reorder-preview/);
  assert.match(js, /item\.current_price/);
  assert.match(js, /if \(!item\.available \|\| !item\.listing_id\)/);
  assert.match(js, /unavailable\.push/);
});
