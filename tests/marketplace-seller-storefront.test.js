import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("marketplace_seller_profiles storefront migration is additive and preserves existing seller profiles", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260819190000_marketplace_seller_storefront.sql"),
    "utf8"
  );
  for (const column of [
    "location_city text",
    "location_state text",
    "location_country text",
    "delivery_area text",
    "delivery_radius_miles numeric",
    "pickup_address text",
    "pickup_hours text",
    "ordering_policy text",
    "order_deadline_note text",
    "contact_email text",
    "contact_phone text",
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`, "i"), `missing column: ${column}`);
  }
  assert.match(sql, /pickup_available boolean not null default false/);
  assert.match(sql, /featured_listing_ids uuid\[\] not null default '\{\}'/);
});

test("marketplace-seller.js PUT profile persists the full storefront and only lets a seller feature their own listings", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-seller.js"), "utf8");
  for (const field of [
    "location_city", "location_state", "location_country", "delivery_area", "delivery_radius_miles",
    "pickup_available", "pickup_address", "pickup_hours", "shipping_flat_fee", "free_shipping_over",
    "ordering_policy", "order_deadline_note", "contact_email", "contact_phone",
  ]) {
    assert.match(src, new RegExp(`${field}:`), `PUT profile missing field ${field}`);
  }
  // featured_listing_ids is resolved against the seller's OWN shop_id —
  // a client-supplied ID for someone else's listing must never be trusted.
  assert.match(src, /client\.from\(LISTINGS\)\.select\("id"\)\.eq\("shop_id",\s*shopId\)\.in\("id",\s*ids\)/);
});

test("marketplace-catalog.js returns the full storefront profile plus seller-curated featured products", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.match(src, /SELLER_PROFILE_FIELDS/);
  assert.match(src, /location_city/);
  assert.match(src, /featured_listing_ids/);
  assert.match(src, /featured,?\s*$/m);
  // Featured items are drawn only from this seller's own already-filtered,
  // already-browsable storefrontItems — never fabricated, never someone
  // else's listing.
  assert.match(src, /featuredIds\.map\(\(id\) => storefrontItems\.find\(\(item\) => item\.id === id\)\)/);
});

test("buyer marketplace UI has a real storefront view, not just a text-filtered product grid", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /function openStorefront/);
  assert.match(js, /function storefrontHtml/);
  assert.match(js, /marketplace-catalog\?shopId=/);
  assert.doesNotMatch(js, /marketplaceSellerFilter'\)\.value = storefront\.dataset/);
});

test("seller dashboard has a real Store Profile section wired to PUT marketplace-seller", () => {
  const js = fs.readFileSync(path.join(root, "public/wholesale-seller-dashboard.js"), "utf8");
  assert.match(js, /function renderProfile/);
  assert.match(js, /wholesaleProfileForm/);
  assert.match(js, /method:\s*'PUT'/);
  assert.match(js, /featured_listing_ids/);
});
