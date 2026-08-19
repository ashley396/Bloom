import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validateMarketingPromotionBody,
  PROMOTION_TYPES,
  PROMOTION_STATUSES,
} from "../netlify/functions/_shared/marketing-promotions.js";

const root = process.cwd();

test("promotion validation requires a name and a real type", () => {
  assert.equal(validateMarketingPromotionBody({}).valid, false);
  assert.equal(validateMarketingPromotionBody({ name: "Spring Sale" }).valid, false);
  assert.equal(validateMarketingPromotionBody({ name: "Spring Sale", promo_type: "made_up" }).valid, false);
  const ok = validateMarketingPromotionBody({ name: "Spring Sale", promo_type: "percentage_off", value: 15 });
  assert.equal(ok.valid, true);
  assert.equal(ok.sanitized.promo_type, "percentage_off");
  assert.equal(ok.sanitized.value, 15);
  for (const t of PROMOTION_TYPES) {
    assert.equal(validateMarketingPromotionBody({ name: "X", promo_type: t, value: 5 }).valid, true);
  }
});

test("a percentage discount can never exceed 100, but a dollar discount can be any non-negative amount", () => {
  assert.equal(
    validateMarketingPromotionBody({ name: "X", promo_type: "percentage_off", value: 150 }).valid,
    false
  );
  assert.equal(
    validateMarketingPromotionBody({ name: "X", promo_type: "percentage_off", value: 100 }).valid,
    true
  );
  assert.equal(
    validateMarketingPromotionBody({ name: "X", promo_type: "dollar_off", value: 500 }).valid,
    true
  );
  assert.equal(validateMarketingPromotionBody({ name: "X", promo_type: "dollar_off", value: -5 }).valid, false);
});

test("promotion date range must be start before end", () => {
  assert.equal(
    validateMarketingPromotionBody({
      name: "X",
      promo_type: "free_delivery",
      value: 0,
      starts_on: "2027-05-09",
      ends_on: "2027-05-01",
    }).valid,
    false
  );
});

test("promotion product_ids are validated as real uuids, not trusted raw", () => {
  const bad = validateMarketingPromotionBody({ name: "X", promo_type: "percentage_off", value: 10, product_ids: ["nope"] });
  assert.equal(bad.valid, false);
  const good = validateMarketingPromotionBody({
    name: "X",
    promo_type: "percentage_off",
    value: 10,
    product_ids: ["11111111-1111-4111-8111-111111111111"],
  });
  assert.equal(good.valid, true);
  assert.deepEqual(good.sanitized.product_ids, ["11111111-1111-4111-8111-111111111111"]);
});

test("marketing-promotions.js gates on the feature flag, stays shop-scoped, and never lets an active/ended promotion's terms be edited", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketing-promotions.js"), "utf8");
  assert.match(src, /isFeatureEnabled\("MARKETING_CAMPAIGNS"\)/);
  assert.match(src, /currentUser\(event\)/);
  assert.match(src, /eq\("shop_id", shopId\)/);
  // update() only ever touches a draft — activating or editing terms after
  // go-live has to go through the explicit "activate"/"end" transitions,
  // not a generic edit that could silently change a live promotion.
  assert.match(src, /action === "update"[\s\S]{0,600}eq\("status", "draft"\)/);
  assert.match(src, /action === "activate"[\s\S]{0,500}eq\("status", "draft"\)/);
});

test("migration adds shop-scoped RLS for marketing_promotions and a percentage-value ceiling", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260819140000_marketing_promotions_v1.sql"),
    "utf8"
  );
  assert.match(sql, /create table if not exists public\.marketing_promotions/i);
  assert.match(sql, /alter table public\.marketing_promotions enable row level security/i);
  assert.match(sql, /is_shop_member\(shop_id\)/);
  assert.match(sql, /revoke all on table public\.marketing_promotions from anon/i);
  assert.match(sql, /marketing_promotions_percentage_range/);
});

test("PROMOTION_STATUSES covers the required draft/active/ended lifecycle", () => {
  assert.deepEqual(PROMOTION_STATUSES, ["draft", "active", "ended"]);
});
