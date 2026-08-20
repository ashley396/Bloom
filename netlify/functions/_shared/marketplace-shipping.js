/**
 * Real shipping-fee computation for marketplace checkout — extends the
 * seller storefront profile (marketplace_seller_profiles) that already
 * carries minimum_order_amount and pickup_available, rather than the
 * never-wired marketplace_shipping_profiles freeform-JSON table.
 */

/**
 * @param {object} args
 * @param {boolean} args.pickupAvailable - seller offers local pickup.
 * @param {number|null|undefined} args.shippingFlatFee
 * @param {number|null|undefined} args.freeShippingOver
 * @param {number} args.subtotal - pre-discount cart subtotal for this seller.
 * @returns {number} the shipping fee to charge, in dollars (0 if none).
 */
export function shippingFeeFor({ pickupAvailable, shippingFlatFee, freeShippingOver, subtotal }) {
  // A seller who offers pickup might also ship, but today's cart has no
  // way for a buyer to say which they want for that seller — so rather
  // than guess and risk charging someone shipping they never asked for,
  // the fee only ever applies when shipping is the seller's only option.
  if (pickupAvailable) return 0;

  const fee = Number(shippingFlatFee) || 0;
  if (fee <= 0) return 0;

  const threshold = freeShippingOver != null ? Number(freeShippingOver) : null;
  if (threshold != null && threshold > 0 && Number(subtotal) >= threshold) return 0;

  return fee;
}
