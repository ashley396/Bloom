import test from "node:test";
import assert from "node:assert/strict";
import { shippingFeeFor } from "../netlify/functions/_shared/marketplace-shipping.js";

test("shippingFeeFor charges the seller's flat fee when they don't offer pickup", () => {
  assert.equal(
    shippingFeeFor({ pickupAvailable: false, shippingFlatFee: 12.5, freeShippingOver: null, subtotal: 40 }),
    12.5
  );
});

test("shippingFeeFor never charges when the seller offers pickup — the cart can't yet say which the buyer wants", () => {
  assert.equal(
    shippingFeeFor({ pickupAvailable: true, shippingFlatFee: 12.5, freeShippingOver: null, subtotal: 40 }),
    0
  );
});

test("shippingFeeFor waives the fee once the subtotal meets the free-shipping threshold", () => {
  assert.equal(
    shippingFeeFor({ pickupAvailable: false, shippingFlatFee: 15, freeShippingOver: 100, subtotal: 100 }),
    0
  );
  assert.equal(
    shippingFeeFor({ pickupAvailable: false, shippingFlatFee: 15, freeShippingOver: 100, subtotal: 99.99 }),
    15
  );
});

test("shippingFeeFor returns 0 when no fee is configured — unchanged behavior for every seller who never set one", () => {
  assert.equal(
    shippingFeeFor({ pickupAvailable: false, shippingFlatFee: null, freeShippingOver: null, subtotal: 40 }),
    0
  );
  assert.equal(
    shippingFeeFor({ pickupAvailable: false, shippingFlatFee: 0, freeShippingOver: null, subtotal: 40 }),
    0
  );
});

test("shippingFeeFor ignores a zero or negative free-shipping threshold rather than waiving the fee for everyone", () => {
  assert.equal(
    shippingFeeFor({ pickupAvailable: false, shippingFlatFee: 10, freeShippingOver: 0, subtotal: 1 }),
    10
  );
});
