import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("marketplace_listings floral attributes migration is additive/nullable and preserves existing listings", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260819170000_marketplace_floral_attributes.sql"),
    "utf8"
  );
  for (const column of [
    "variety text",
    "color text",
    "stem_length_in numeric",
    "grade text",
    "grower_name text",
    "origin text",
    "stems_per_bunch numeric",
    "bunches_per_box numeric",
    "case_quantity numeric",
    "price_per_stem numeric",
    "price_per_bunch numeric",
    "price_per_box numeric",
    "price_per_case numeric",
    "available_from date",
    "available_until date",
    "seasonal_months integer\\[\\]",
    "lead_time_days numeric",
    "delivery_region text",
    "pickup_city text",
    "pickup_state text",
    "substitution_note text",
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`, "i"), `missing column: ${column}`);
  }
  assert.match(sql, /availability_status text not null default 'available_now'/);
  assert.match(sql, /marketplace_listings_availability_status_check/);
  assert.match(sql, /available_now.*scheduled.*seasonal.*preorder.*limited.*sold_out/s);
});

test("marketplace-seller.js accepts every floral attribute on save-product", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-seller.js"), "utf8");
  for (const field of [
    "variety", "color", "stem_length_in", "grade", "grower_name", "origin",
    "stems_per_bunch", "bunches_per_box", "case_quantity",
    "price_per_stem", "price_per_bunch", "price_per_box", "price_per_case",
    "availability_status", "available_from", "available_until", "seasonal_months",
    "lead_time_days", "delivery_region", "pickup_city", "pickup_state", "substitution_note",
  ]) {
    assert.match(src, new RegExp(`"${field}"`), `LISTING_FIELDS missing ${field}`);
  }
  assert.match(src, /validateFloralAttributes\(body\)/);
  assert.match(src, /normalizeAvailabilityStatus\(body\.availability_status\)/);
  assert.match(src, /normalizeSeasonalMonths\(body\.seasonal_months\)/);
});

test("marketplace-catalog.js surfaces floral attributes and real search/filters for buyers", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.match(src, /resolveDisplayPrice/);
  assert.match(src, /isCurrentlyAvailable/);
  assert.match(src, /display_price:/);
  assert.match(src, /unit_prices:/);
  assert.match(src, /currently_available:/);
  // Search text now includes floral fields, not just product/supplier/category/description.
  assert.match(src, /item\.variety,\s*item\.color,\s*item\.grower_name,\s*item\.origin/);
  for (const param of ["variety", "color", "grower", "origin", "availability", "availableOnly", "minStemLength", "byDate"]) {
    assert.match(src, new RegExp(`params\\.${param}`), `catalog missing filter param ${param}`);
  }
});

test("buyer marketplace UI shows floral spec sheet and availability badges, not just name/price", () => {
  const src = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(src, /availabilityBadgeHtml/);
  assert.match(src, /specSheetHtml/);
  assert.match(src, /display_price/);
});

test("seller product dialog exposes floral fields and never destabilizes the existing generic listing path", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const dialog = html.slice(html.indexOf('id="wholesaleProductDialog"'), html.indexOf("</dialog>", html.indexOf('id="wholesaleProductDialog"')));
  for (const name of ["variety", "color", "grade", "stem_length_in", "grower_name", "origin", "price_per_stem", "price_per_bunch", "price_per_box", "price_per_case", "availability_status", "lead_time_days", "available_from", "available_until", "substitution_note"]) {
    assert.match(dialog, new RegExp(`name="${name}"`), `product dialog missing field ${name}`);
  }
  // The original required fields are still present and required — this is
  // additive, not a redesign of the existing working form.
  assert.match(dialog, /name="product_name" required/);
  assert.match(dialog, /name="price" type="number" step="0.01" required/);
});
