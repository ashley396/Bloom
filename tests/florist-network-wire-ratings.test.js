import test from "node:test";
import assert from "node:assert/strict";
import {
  validateWireRatingPayload,
  canRateWire,
  aggregateShopRatings,
  aggregateRatingsByShop,
} from "../lib/florist-network/wire-orders.js";

test("validateWireRatingPayload requires a wire id and a 1-5 integer rating", () => {
  assert.deepEqual(validateWireRatingPayload({}).errors, [
    "wire_id is required.",
    "rating must be a whole number from 1 to 5.",
  ]);
  assert.ok(validateWireRatingPayload({ wire_id: "w1", rating: 0 }).errors.length);
  assert.ok(validateWireRatingPayload({ wire_id: "w1", rating: 6 }).errors.length);
  assert.ok(validateWireRatingPayload({ wire_id: "w1", rating: 3.5 }).errors.length);
  const ok = validateWireRatingPayload({ wire_id: "w1", rating: 5, comment: "Beautiful, on time." });
  assert.deepEqual(ok, { errors: [], wire_id: "w1", rating: 5, comment: "Beautiful, on time." });
});

test("validateWireRatingPayload trims and caps comment length, treats blank as null", () => {
  assert.equal(validateWireRatingPayload({ wire_id: "w1", rating: 4, comment: "  " }).comment, null);
  const long = "x".repeat(600);
  assert.equal(validateWireRatingPayload({ wire_id: "w1", rating: 4, comment: long }).comment.length, 500);
});

test("canRateWire only allows delivered wires", () => {
  assert.equal(canRateWire({ status: "delivered" }), true);
  assert.equal(canRateWire({ status: "DELIVERED" }), true);
  assert.equal(canRateWire({ status: "out_for_delivery" }), false);
  assert.equal(canRateWire({ status: "cancelled" }), false);
  assert.equal(canRateWire(null), false);
});

test("aggregateShopRatings computes a rounded average and count", () => {
  assert.deepEqual(aggregateShopRatings([]), { average: null, count: 0 });
  assert.deepEqual(aggregateShopRatings([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), { average: 4.3, count: 3 });
});

test("aggregateRatingsByShop groups rows by the rated shop", () => {
  const rows = [
    { ratee_shop_id: "shop-a", rating: 5 },
    { ratee_shop_id: "shop-a", rating: 3 },
    { ratee_shop_id: "shop-b", rating: 2 },
  ];
  const byShop = aggregateRatingsByShop(rows);
  assert.deepEqual(byShop.get("shop-a"), { average: 4, count: 2 });
  assert.deepEqual(byShop.get("shop-b"), { average: 2, count: 1 });
  assert.equal(byShop.has("shop-c"), false);
});
