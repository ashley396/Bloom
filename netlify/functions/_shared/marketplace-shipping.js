/**
 * Real shipping-fee computation for marketplace checkout — extends the
 * seller storefront profile (marketplace_seller_profiles) that already
 * carries minimum_order_amount and pickup_available, rather than the
 * never-wired marketplace_shipping_profiles freeform-JSON table.
 *
 * A seller who offers pickup might also ship — the cart lets a buyer say
 * which they want for that seller (a fulfillment radio, shown only when
 * the seller actually offers both). Nothing in the client is ever trusted
 * blindly: pickupAvailable always comes from the seller's own profile row,
 * looked up server-side, so a buyer can never talk their way into pickup
 * for a seller who never offered it.
 */

/**
 * @param {object} args
 * @param {boolean} args.pickupAvailable - seller offers local pickup.
 * @param {"pickup"|"shipping"|undefined} [args.buyerFulfillmentChoice] - what
 *   the buyer picked for this seller, if the cart showed them a choice.
 *   Undefined (no choice made, or none was offered) defaults to pickup
 *   when it's available — never surprise someone with a shipping charge
 *   they didn't ask for.
 * @returns {boolean} true if this order resolves to pickup (no shipping fee).
 */
export function isPickupFulfillment({ pickupAvailable, buyerFulfillmentChoice }) {
  return Boolean(pickupAvailable) && buyerFulfillmentChoice !== "shipping";
}

/**
 * @param {object} args
 * @param {boolean} args.pickupAvailable - seller offers local pickup.
 * @param {"pickup"|"shipping"|undefined} [args.buyerFulfillmentChoice]
 * @param {number|null|undefined} args.shippingFlatFee
 * @param {number|null|undefined} args.freeShippingOver
 * @param {number} args.subtotal - pre-discount cart subtotal for this seller.
 * @returns {number} the shipping fee to charge, in dollars (0 if none).
 */
export function shippingFeeFor({ pickupAvailable, buyerFulfillmentChoice, shippingFlatFee, freeShippingOver, subtotal }) {
  if (isPickupFulfillment({ pickupAvailable, buyerFulfillmentChoice })) return 0;

  const fee = Number(shippingFlatFee) || 0;
  if (fee <= 0) return 0;

  const threshold = freeShippingOver != null ? Number(freeShippingOver) : null;
  if (threshold != null && threshold > 0 && Number(subtotal) >= threshold) return 0;

  return fee;
}
