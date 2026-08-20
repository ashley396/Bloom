import test from "node:test";
import assert from "node:assert/strict";
import { shippingFeeFor, isPickupFulfillment } from "../netlify/functions/_shared/marketplace-shipping.js";

test("shippingFeeFor charges the seller's flat fee when they don't offer pickup", () => {
  assert.equal(
    shippingFeeFor({ pickupAvailable: false, shippingFlatFee: 12.5, freeShippingOver: null, subtotal: 40 }),
    12.5
  );
});

test("shippingFeeFor charges the fee even for a pickup-capable seller once the buyer explicitly chooses shipping", () => {
  assert.equal(
    shippingFeeFor({ pickupAvailable: false, shippingFlatFee: 12.5, freeShippingOver: null, subtotal: 40 }),
    12.5
  );
  assert.equal(
    shippingFeeFor({ pickupAvailable: true, buyerFulfillmentChoice: "shipping", shippingFlatFee: 12.5, freeShippingOver: null, subtotal: 40 }),
    12.5
  );
});

test("shippingFeeFor defaults to no charge for a pickup-capable seller when the buyer never made a choice — never a surprise charge", () => {
  assert.equal(
    shippingFeeFor({ pickupAvailable: true, shippingFlatFee: 12.5, freeShippingOver: null, subtotal: 40 }),
    0
  );
  assert.equal(
    shippingFeeFor({ pickupAvailable: true, buyerFulfillmentChoice: "pickup", shippingFlatFee: 12.5, freeShippingOver: null, subtotal: 40 }),
    0
  );
});

test("isPickupFulfillment: a buyer's requested fulfillment method can never override a seller who offers no pickup at all", () => {
  assert.equal(isPickupFulfillment({ pickupAvailable: false, buyerFulfillmentChoice: "pickup" }), false);
  assert.equal(isPickupFulfillment({ pickupAvailable: false }), false);
});

test("isPickupFulfillment: pickup is the safe default for a pickup-capable seller until the buyer explicitly asks to ship", () => {
  assert.equal(isPickupFulfillment({ pickupAvailable: true }), true);
  assert.equal(isPickupFulfillment({ pickupAvailable: true, buyerFulfillmentChoice: "pickup" }), true);
  assert.equal(isPickupFulfillment({ pickupAvailable: true, buyerFulfillmentChoice: "shipping" }), false);
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
