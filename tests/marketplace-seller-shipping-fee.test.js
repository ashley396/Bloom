import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260820000000_marketplace_seller_shipping_fee.sql"),
    "utf8"
  );
}

test("adds shipping_flat_fee and free_shipping_over to marketplace_seller_profiles", () => {
  const sql = migrationSql();
  assert.match(sql, /add column if not exists shipping_flat_fee numeric/);
  assert.match(sql, /add column if not exists free_shipping_over numeric/);
});

test("both new columns are constrained to non-negative values", () => {
  const sql = migrationSql();
  assert.match(sql, /shipping_flat_fee_check[\s\S]*check \(shipping_flat_fee is null or shipping_flat_fee >= 0\)/);
  assert.match(sql, /free_shipping_over_check[\s\S]*check \(free_shipping_over is null or free_shipping_over >= 0\)/);
});

test("checkout.js reads the new columns and never charges shipping when the seller offers pickup", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-checkout.js"), "utf8");
  assert.match(src, /shipping_flat_fee, free_shipping_over/);
  assert.match(src, /shippingFeeFor\(/);
  // Shipping is excluded from the platform fee — it's a pass-through
  // cost, not marketplace revenue.
  assert.doesNotMatch(src, /const amount[\s\S]{0,300}shippingFee/);
});

test("seller dashboard exposes the shipping fields on the Store Profile form, and the dead Shipping-profiles tab is gone", () => {
  const js = fs.readFileSync(path.join(root, "public/wholesale-seller-dashboard.js"), "utf8");
  assert.match(js, /name="shipping_flat_fee"/);
  assert.match(js, /name="free_shipping_over"/);
  assert.doesNotMatch(js, /wholesaleShippingForm/);
  assert.doesNotMatch(js, /save-shipping/);
});

test("marketplace-seller.js no longer reads or writes the never-wired marketplace_shipping_profiles table", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-seller.js"), "utf8");
  assert.doesNotMatch(src, /marketplace_shipping_profiles/);
  assert.doesNotMatch(src, /save-shipping/);
  assert.match(src, /shipping_flat_fee:/);
  assert.match(src, /free_shipping_over:/);
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260820000000_marketplace_seller_shipping_fee\.sql/);
  assert.match(chain, /20260820000000_marketplace_seller_shipping_fee\.sql/);
});
