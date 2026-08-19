import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { summarizeSellerReviews } from "../netlify/functions/_shared/marketplace-products.js";

const root = process.cwd();

test("summarizeSellerReviews returns an honest empty shape, never a fabricated starting score", () => {
  assert.deepEqual(summarizeSellerReviews([]), {
    count: 0, average: null, fulfillment_average: null, communication_average: null, accuracy_average: null
  });
  assert.deepEqual(summarizeSellerReviews(), {
    count: 0, average: null, fulfillment_average: null, communication_average: null, accuracy_average: null
  });
});

test("summarizeSellerReviews averages real ratings and rounds to one decimal", () => {
  const summary = summarizeSellerReviews([
    { rating: 5, fulfillment_rating: 5, communication_rating: 4 },
    { rating: 4, fulfillment_rating: 3 },
    { rating: 5 },
  ]);
  assert.equal(summary.count, 3);
  assert.equal(summary.average, 4.7);
  assert.equal(summary.fulfillment_average, 4);
  assert.equal(summary.communication_average, 4);
  assert.equal(summary.accuracy_average, null);
});

test("marketplace_seller_reviews migration ties eligibility to a real paid order: unique order_id and an RLS insert check requiring the buyer's own paid/fulfilled/completed order", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260819210000_marketplace_seller_reviews.sql"), "utf8");
  assert.match(sql, /order_id uuid not null unique references public\.marketplace_wholesale_orders/);
  assert.match(sql, /rating integer not null check \(rating between 1 and 5\)/);
  assert.match(sql, /o\.buyer_user_id = auth\.uid\(\)/);
  assert.match(sql, /o\.status in \('paid', 'fulfilled', 'completed'\)/);
  // No UPDATE/DELETE policy — reviews are immutable once posted.
  assert.doesNotMatch(sql, /for update/i);
  assert.doesNotMatch(sql, /for delete/i);
});

test("submitSellerReview derives seller_shop_id from the real order, never from client input, and rejects a duplicate/unpaid review", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  const fn = src.slice(src.indexOf("async function submitSellerReview"), src.indexOf("async function submitRefundRequest"));
  assert.match(fn, /order\.buyer_user_id !== user\.id/);
  assert.match(fn, /REVIEWABLE_ORDER_STATUSES\.includes\(order\.status\)/);
  assert.match(fn, /existingReview/);
  assert.match(fn, /seller_shop_id:\s*order\.seller_shop_id/);
  assert.doesNotMatch(fn, /seller_shop_id:\s*body\./);
});

test("marketplace-catalog.js exposes public seller-reviews reads and attaches a real reviews_summary to the storefront", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.match(src, /resource === "seller-reviews"/);
  assert.match(src, /action === "submit_review"/);
  assert.match(src, /reviews_summary:\s*summarizeSellerReviews/);
  assert.match(src, /can_review:/);
});

test("buyer UI lets a florist rate an order only when the backend says they can, and shows real reviews on the storefront", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /order\.can_review/);
  assert.match(js, /action:\s*'submit_review'/);
  assert.match(js, /resource=seller-reviews/);
  assert.match(js, /reviews_summary/);
});
