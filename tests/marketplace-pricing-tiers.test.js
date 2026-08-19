import test from "node:test";
import assert from "node:assert/strict";

import { bestPricingTierFor } from "../netlify/functions/_shared/marketplace-pricing-tiers.js";

test("bestPricingTierFor: returns null when no tier's threshold is met", () => {
  const tiers = [{ name: "Volume florist", min_quantity: 50, discount_percent: 10 }];
  assert.equal(bestPricingTierFor(tiers, 10), null);
  assert.equal(bestPricingTierFor(tiers, 49), null);
});

test("bestPricingTierFor: a quantity exactly at the threshold qualifies", () => {
  const tiers = [{ name: "Volume florist", min_quantity: 50, discount_percent: 10 }];
  const tier = bestPricingTierFor(tiers, 50);
  assert.equal(tier?.name, "Volume florist");
});

test("bestPricingTierFor: picks the highest threshold actually met, not the first tier in the array", () => {
  const tiers = [
    { name: "Small volume", min_quantity: 10, discount_percent: 5 },
    { name: "Big volume", min_quantity: 50, discount_percent: 15 },
  ];
  assert.equal(bestPricingTierFor(tiers, 60)?.name, "Big volume");
  assert.equal(bestPricingTierFor(tiers, 20)?.name, "Small volume");
  assert.equal(bestPricingTierFor(tiers, 5), null);
  // Order in the array must not matter — same result reversed.
  assert.equal(bestPricingTierFor([...tiers].reverse(), 60)?.name, "Big volume");
});

test("bestPricingTierFor: an inactive tier is never selected even if its threshold is met", () => {
  const tiers = [{ name: "Disabled tier", min_quantity: 1, discount_percent: 50, active: false }];
  assert.equal(bestPricingTierFor(tiers, 100), null);
});

test("bestPricingTierFor: tolerates missing/empty input", () => {
  assert.equal(bestPricingTierFor([], 100), null);
  assert.equal(bestPricingTierFor(null, 100), null);
  assert.equal(bestPricingTierFor(undefined, 100), null);
});
