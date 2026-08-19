import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isPromotionActive,
  normalizePromoCode,
  applyPercentOffCents,
  sanitizePromotionForBuyer,
  PROMOTIONS_TABLE
} from "../netlify/functions/_shared/marketplace-promotions.js";

const root = process.cwd();

// --- pure helpers -----------------------------------------------------

test("isPromotionActive requires the active flag AND being inside the real starts_at/ends_at window right now", () => {
  const now = Date.parse("2026-06-15T12:00:00.000Z");
  assert.equal(isPromotionActive({ active: true, starts_at: null, ends_at: null }, now), true, "no window at all is always active while the flag is on");
  assert.equal(isPromotionActive({ active: false, starts_at: null, ends_at: null }, now), false, "inactive flag always wins");
  assert.equal(isPromotionActive({ active: true, starts_at: "2026-07-01T00:00:00.000Z" }, now), false, "not started yet");
  assert.equal(isPromotionActive({ active: true, ends_at: "2026-06-01T00:00:00.000Z" }, now), false, "already ended");
  assert.equal(isPromotionActive({ active: true, starts_at: "2026-06-01T00:00:00.000Z", ends_at: "2026-06-30T00:00:00.000Z" }, now), true, "inside a real window");
  assert.equal(isPromotionActive(null), false, "no row at all is never active");
});

test("normalizePromoCode trims and uppercases so the seller's save and the buyer's typed code always compare the same real form", () => {
  assert.equal(normalizePromoCode("  spring15 "), "SPRING15");
  assert.equal(normalizePromoCode(""), "");
  assert.equal(normalizePromoCode(undefined), "");
});

test("applyPercentOffCents clamps to [0, 100] and rounds — never a negative or over-100% charge from a corrupt row", () => {
  assert.equal(applyPercentOffCents(1000, 10), 900);
  assert.equal(applyPercentOffCents(1000, 0), 1000);
  assert.equal(applyPercentOffCents(1000, 100), 0);
  assert.equal(applyPercentOffCents(1000, 150), 0, "over-100 is clamped to 100% off, never a negative charge");
  assert.equal(applyPercentOffCents(1000, -20), 1000, "negative percent_off is clamped to 0% off, never a markup");
  assert.equal(applyPercentOffCents(999, 33), Math.round(999 * 0.67));
});

test("sanitizePromotionForBuyer exposes only the buyer-facing shape, never seller-internal fields", () => {
  const buyerShape = sanitizePromotionForBuyer(
    { id: "promo1", shop_id: "shop1", code: "SPRING15", description: "15% off", percent_off: 15, ends_at: "2026-07-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z" },
    "Garden Co"
  );
  assert.deepEqual(buyerShape, {
    id: "promo1",
    code: "SPRING15",
    description: "15% off",
    percent_off: 15,
    seller_shop_id: "shop1",
    seller_display_name: "Garden Co",
    ends_at: "2026-07-01T00:00:00.000Z"
  });
  assert.equal("created_at" in buyerShape, false);
});

test("PROMOTIONS_TABLE points at the real, existing marketplace_promotions table — no new table introduced for this feature", () => {
  assert.equal(PROMOTIONS_TABLE, "marketplace_promotions");
});

// --- migration ----------------------------------------------------------

test("marketplace_promotions buyer-read migration is additive (no new table) and scopes to real active/in-window rows only", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260819240000_marketplace_promotions_buyer_read.sql"),
    "utf8"
  );
  assert.doesNotMatch(sql, /create table/i, "reuses the existing table, never creates a new one");
  assert.match(sql, /create policy "marketplace promotions buyer read" on public\.marketplace_promotions/);
  assert.match(sql, /active = true/);
  assert.match(sql, /starts_at is null or starts_at <= now\(\)/);
  assert.match(sql, /ends_at is null or ends_at >= now\(\)/);
});

// --- seller CRUD (marketplace-seller.js) ---------------------------------

test("save-promotion validates a real code, a bounded percent_off, and a sane date window before writing", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-seller.js"), "utf8");
  const fn = src.slice(src.indexOf('body.action === "save-promotion"'), src.indexOf('body.action === "toggle-promotion"'));
  assert.match(fn, /normalizePromoCode\(body\.code\)/);
  assert.match(fn, /!code/);
  assert.match(fn, /percentOff <= 0 \|\| percentOff > 100/);
  assert.match(fn, /Date\.parse\(endsAt\) < Date\.parse\(startsAt\)/);
  // (shop_id, code) is unique — an id-less save upserts on that key
  // instead of erroring on the constraint or creating a duplicate.
  assert.match(fn, /onConflict: "shop_id,code"/);
  // Every write is shop-scoped — an id-based edit can only ever touch the
  // seller's own row, never another shop's promotion.
  assert.match(fn, /\.eq\("shop_id", shopId\)/);
});

test("toggle-promotion flips only the active flag — never routes through save-promotion's full-row replace, which would wipe the description/date window", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-seller.js"), "utf8");
  const fn = src.slice(src.indexOf('body.action === "toggle-promotion"'), src.indexOf('body.action === "save-customer"'));
  assert.match(fn, /\.update\(\{ active: body\.active !== false \}\)/);
  assert.match(fn, /\.eq\("id", body\.id\)/);
  assert.match(fn, /\.eq\("shop_id", shopId\)/);
});

test("the seller dashboard's promotions select includes the real date-window columns, not just code/percent_off/active", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-seller.js"), "utf8");
  assert.match(src, /PROMOTIONS\)\.select\("id, code, percent_off, active, description, starts_at, ends_at"\)/);
});

// --- buyer catalog resource=specials (marketplace-catalog.js) -----------

test("loadCurrentSpecials only returns real, currently-active specials from VERIFIED sellers — reuses isPromotionActive and loadVerifiedSellerShopIds, not a fifth parallel check", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  const fn = src.slice(src.indexOf("async function loadCurrentSpecials"), src.indexOf("// SUPPLIER VERIFICATION: loadVerifiedSellerShopIds"));
  assert.match(fn, /isPromotionActive\(p\)/);
  assert.match(fn, /loadVerifiedSellerShopIds\(shopIds\)/);
  assert.match(fn, /verifiedShopIds\.has\(p\.shop_id\)/);
  assert.match(fn, /sanitizePromotionForBuyer\(/);
});

test("marketplace-catalog.js wires resource=specials", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.match(src, /params\.resource === "specials"/);
  assert.match(src, /await loadCurrentSpecials\(client\)/);
});

// --- buyer UI -------------------------------------------------------------

test("buyer marketplace page fetches and renders real specials, never a hardcoded promo", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /marketplace-catalog\?resource=specials/);
  assert.match(js, /data-market-copy-promo/);
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="marketplaceSpecialsSection"/);
});

test("checkout only sends a promo_code the buyer actually typed — never auto-applies one silently", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /window\.prompt\('Promo code \(optional\)/);
  assert.match(js, /\.\.\.\(promoCode \? \{ promo_code: promoCode \} : \{\}\)/);
});

// --- seller dashboard UI ---------------------------------------------------

test("wholesale seller dashboard has a real Specials section with a create form and a toggle action, not a read-only list", () => {
  const js = fs.readFileSync(path.join(root, "public/wholesale-seller-dashboard.js"), "utf8");
  assert.match(js, /id="wholesaleSpecialForm"/);
  assert.match(js, /action: 'save-promotion'/);
  assert.match(js, /action: 'toggle-promotion'/);
  assert.match(js, /\['specials', 'Specials'\]/);
});
