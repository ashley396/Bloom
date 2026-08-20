import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import {
  canPurchaseWithVerification,
  checkoutListingSelectFields,
  isMissingVerificationTableError,
  mapCheckoutListing
} from "./_shared/marketplace-verification.js";
import {
  PROMOTIONS_TABLE,
  applyPercentOffCents,
  isPromotionActive,
  normalizePromoCode
} from "./_shared/marketplace-promotions.js";
import { PRICING_TIERS_TABLE, bestPricingTierFor } from "./_shared/marketplace-pricing-tiers.js";
import { shippingFeeFor } from "./_shared/marketplace-shipping.js";

function stripeRedirectBaseUrl() {
  const site = String(process.env.SITE_URL || process.env.URL || "").trim().replace(/\/$/, "");
  if (!site) {
    const e = new Error("SITE_URL is not configured in Netlify.");
    e.statusCode = 503;
    throw e;
  }
  return site;
}

function normalizeCart(body = {}) {
  if (Array.isArray(body.items) && body.items.length) {
    return body.items.map((row) => ({
      listing_id: row.listing_id || row.id,
      quantity: Math.max(1, Number(row.quantity || 1)),
    }));
  }
  if (body.listing_id) {
    return [{ listing_id: body.listing_id, quantity: Math.max(1, Number(body.quantity || 1)) }];
  }
  return [];
}

/**
 * Core handler logic, dependency-injectable for handler-level tests (see
 * tests/marketplace-checkout.test.js) without a real Stripe/Supabase
 * connection. `handler` below is the thin Netlify entrypoint that always
 * uses the real dependencies.
 */
export async function handleMarketplaceCheckout(event, dependencies = {}) {
  const authenticate = dependencies.currentUser || currentUser;
  const createStripe = dependencies.createStripe || ((key) => new Stripe(key));
  const isEnabled = dependencies.isFeatureEnabled || isFeatureEnabled;

  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    if (!isEnabled("MARKETPLACE_PUBLIC")) {
      return json(503, { error: "Wholesale marketplace is disabled." });
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      const e = new Error("STRIPE_SECRET_KEY is not configured in Netlify.");
      e.statusCode = 503;
      throw e;
    }

    const stripe = createStripe(process.env.STRIPE_SECRET_KEY);
    const { client, user, shopId } = await authenticate(event);
    const body = bodyOf(event);
    const cart = normalizeCart(body);
    if (!cart.length) return json(400, { error: "Cart is empty." });

    const { data: application, error: applicationError } = await client
      .from("marketplace_verification_applications")
      .select("status, profile_data, documents_expire_at, approval_expires_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (applicationError) {
      if (isMissingVerificationTableError(applicationError)) {
        return json(503, {
          error: "Marketplace verification is not configured yet. Apply the marketplace verification migration in Supabase."
        });
      }
      throw applicationError;
    }

    const purchaseCheck = canPurchaseWithVerification(application);
    if (!purchaseCheck.allowed) {
      const messages = {
        missing_application: "Submit and complete wholesale verification before purchasing.",
        not_approved: "Your wholesale verification must be approved before you can purchase from wholesalers.",
        documents_expired: "Your verification documents have expired. Please resubmit verification.",
        approval_expired: "Your wholesale verification approval has expired. Please resubmit verification."
      };
      return json(403, { error: messages[purchaseCheck.reason] || "Verification required for checkout." });
    }

    const listingIds = [...new Set(cart.map((row) => row.listing_id).filter(Boolean))];
    const { data: listingRows, error } = await client
      .from("marketplace_listings")
      .select(checkoutListingSelectFields())
      .in("id", listingIds);
    if (error) throw error;

    const listingMap = new Map((listingRows || []).map((row) => [row.id, mapCheckoutListing(row)]));

    // List every unavailable line by name in one response instead of
    // aborting on the first one — a buyer with several stale cart items
    // should be able to fix the whole cart in one pass, not discover
    // each problem one checkout attempt at a time.
    const unavailable = cart
      .map((line) => {
        const listing = listingMap.get(line.listing_id);
        if (!listing) return { listing_id: line.listing_id, name: "An item", reason: "no longer exists" };
        if (!listing.active) return { listing_id: line.listing_id, name: listing.name, reason: "is no longer available" };
        if (!listing.stripe_connect_account_id) return { listing_id: line.listing_id, name: listing.name, reason: "seller hasn't completed Stripe Connect onboarding" };
        return null;
      })
      .filter(Boolean);
    if (unavailable.length) {
      // `items` (not a bespoke field name) so this rides the existing
      // generic err.items passthrough in app.js's api() helper, the same
      // mechanism already used elsewhere for structured error detail.
      return json(409, {
        error: `${unavailable.length} item${unavailable.length === 1 ? "" : "s"} in your cart can't be purchased right now: ${unavailable.map((u) => `${u.name} (${u.reason})`).join("; ")}.`,
        items: unavailable
      });
    }

    const bySeller = new Map();

    for (const line of cart) {
      const listing = listingMap.get(line.listing_id);
      const destination = listing.stripe_connect_account_id;
      const sellerKey = String(listing.shop_id || listing.seller_shop_id || destination);
      if (!bySeller.has(sellerKey)) {
        bySeller.set(sellerKey, { destination, sellerShopId: listing.shop_id, lines: [] });
      }
      bySeller.get(sellerKey).lines.push({ listing, quantity: line.quantity });
    }

    // MINIMUM ORDER AMOUNT: a seller's storefront profile has always let
    // them set and display a minimum order ($) — the buyer-facing detail
    // panel has shown it since the storefront-enrichment phase — but
    // nothing ever enforced it. A buyer could see "Minimum order: $150"
    // on a seller's page and check out with a $12 order anyway. Checked
    // against the cart's real subtotal for that seller BEFORE any promo
    // or volume-tier discount — a minimum order is a gate on how much is
    // actually in the cart, not on what the buyer ends up paying after a
    // discount, so a big enough tier or promo can never be used to slip
    // an order under a seller's stated minimum.
    const sellerShopIdsInCart = [...bySeller.values()].map((s) => s.sellerShopId).filter(Boolean);
    const { data: sellerProfileRows, error: sellerProfileError } = await client
      .from("marketplace_seller_profiles")
      .select("shop_id, display_name, minimum_order_amount, pickup_available, shipping_flat_fee, free_shipping_over")
      .in("shop_id", sellerShopIdsInCart);
    if (sellerProfileError) throw sellerProfileError;
    const sellerProfileByShop = new Map((sellerProfileRows || []).map((row) => [row.shop_id, row]));

    // Pre-discount subtotal per seller — shared by the minimum-order gate
    // below and the free-shipping threshold in the checkout loop further
    // down, so both are checked against the same real cart value a promo
    // code or volume tier can never be used to slip under.
    const rawSubtotalByShop = new Map(
      [...bySeller.entries()].map(([, sellerCart]) => [
        sellerCart.sellerShopId,
        sellerCart.lines.reduce((sum, { listing, quantity }) => sum + Number(listing.price) * quantity, 0)
      ])
    );

    const belowMinimum = [...bySeller.entries()]
      .map(([, sellerCart]) => {
        const profile = sellerProfileByShop.get(sellerCart.sellerShopId);
        const minimum = Number(profile?.minimum_order_amount) || 0;
        if (minimum <= 0) return null;
        const subtotal = rawSubtotalByShop.get(sellerCart.sellerShopId) || 0;
        if (subtotal >= minimum) return null;
        return { seller_shop_id: sellerCart.sellerShopId, seller_name: profile?.display_name || "This seller", minimum, subtotal };
      })
      .filter(Boolean);
    if (belowMinimum.length) {
      return json(409, {
        error: belowMinimum
          .map((b) => `${b.seller_name} requires a minimum order of ${(Number(b.minimum)).toFixed(2)} (your cart has ${b.subtotal.toFixed(2)} from them)`)
          .join("; ") + ".",
        items: belowMinimum
      });
    }

    // MARKETPLACE SPECIALS: a promo code is scoped to one seller
    // (shop_id + code is the table's real unique key), so it's looked up
    // once against every seller actually present in this cart, never
    // trusted from the client as already-applied. A code the buyer typed
    // that matches NO seller in the cart is a real error worth surfacing
    // (silently charging full price after ignoring their input would be
    // its own kind of dishonesty); a code that matches SOME sellers in a
    // multi-seller cart is applied only to those sessions — the others
    // were never going to be discounted by another seller's code.
    const promoByShop = new Map();
    const promoCode = normalizePromoCode(body.promo_code);
    if (promoCode) {
      const sellerShopIds = [...bySeller.values()].map((s) => s.sellerShopId).filter(Boolean);
      const { data: promoRows, error: promoError } = await client
        .from(PROMOTIONS_TABLE)
        .select("*")
        .eq("code", promoCode)
        .in("shop_id", sellerShopIds);
      if (promoError) throw promoError;
      for (const row of promoRows || []) {
        if (isPromotionActive(row)) promoByShop.set(row.shop_id, row);
      }
      if (!promoByShop.size) {
        return json(400, { error: `Promo code "${promoCode}" isn't valid for the items in your cart.` });
      }
    }

    const site = stripeRedirectBaseUrl();
    const feePercent = Number(process.env.BLOOM_MARKETPLACE_FEE_PERCENT || 5);
    const sessions = [];

    for (const [, sellerCart] of bySeller) {
      const promo = promoByShop.get(sellerCart.sellerShopId) || null;

      // MARKETPLACE VOLUME PRICING: marketplace_pricing_tiers has existed
      // since the greenfield baseline, and the seller dashboard's "Pricing"
      // tab has always let a seller create real tiers — but this is the
      // first time checkout ever reads one back. The tier is chosen by the
      // real total quantity being bought from THIS seller across every
      // line in the cart (tiers are shop-scoped, not per-listing), the
      // same "best fit, not first match" logic every consumer should share
      // via bestPricingTierFor().
      const totalQuantity = sellerCart.lines.reduce((sum, { quantity }) => sum + quantity, 0);
      const { data: tierRows } = await client
        .from(PRICING_TIERS_TABLE)
        .select("id, name, min_quantity, discount_percent")
        .eq("shop_id", sellerCart.sellerShopId)
        .eq("active", true);
      const tier = bestPricingTierFor(tierRows || [], totalQuantity);

      // A promo code and a volume tier are never stacked — the buyer gets
      // whichever discount is larger, not both compounded. A promo code is
      // something the buyer chose to type in; a volume tier is something
      // that applies automatically based on quantity. Compounding them
      // would silently give a bigger discount than either the seller who
      // configured the tier or the promo's own percent_off ever specified
      // on its own, which is exactly the kind of unintended-side-effect
      // pricing bug this checkout has been careful to avoid throughout.
      const promoPercent = promo ? Number(promo.percent_off) || 0 : 0;
      const tierPercent = tier ? Number(tier.discount_percent) || 0 : 0;
      const discountPercent = Math.max(promoPercent, tierPercent);
      const appliedTier = discountPercent > 0 && tierPercent >= promoPercent ? tier : null;
      const appliedPromo = discountPercent > 0 && promoPercent > tierPercent ? promo : null;

      // Two computation paths, deliberately kept separate rather than
      // unified into one formula: the no-discount path is byte-for-byte
      // the original per-cart-line rounding (price * quantity rounded
      // once), preserving every existing checkout test's exact expected
      // totals. The discounted path rounds the discounted PER-UNIT cents
      // first (via applyPercentOffCents, the same bounded 0-100% helper
      // the buyer catalog's specials listing uses) so the Stripe line
      // item's own unit_amount and the amount used for the platform fee
      // can never silently disagree.
      const lineItems = sellerCart.lines.map(({ listing, quantity }) => {
        const rawUnitAmount = Math.round(Number(listing.price) * 100);
        const unitAmount = discountPercent > 0 ? applyPercentOffCents(rawUnitAmount, discountPercent) : rawUnitAmount;
        return {
          quantity,
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: { name: listing.name }
          }
        };
      });
      const amount = discountPercent > 0
        ? lineItems.reduce((sum, li, idx) => sum + li.price_data.unit_amount * sellerCart.lines[idx].quantity, 0)
        : sellerCart.lines.reduce((sum, { listing, quantity }) => sum + Math.round(Number(listing.price) * quantity * 100), 0);
      const fee = Math.round(amount * (feePercent / 100));
      const orderItems = sellerCart.lines.map(({ listing, quantity }, idx) => ({
        listing_id: listing.id,
        name: listing.name,
        quantity,
        unit_price: discountPercent > 0 ? lineItems[idx].price_data.unit_amount / 100 : listing.price,
        unit: listing.unit || "each"
      }));
      const orderTotal = discountPercent > 0
        ? amount / 100
        : sellerCart.lines.reduce((sum, { listing, quantity }) => sum + Number(listing.price) * quantity, 0);

      // MARKETPLACE SHIPPING: marketplace_seller_profiles has always let a
      // seller set pickup_available — but nothing ever charged for the
      // shipping alternative. Only applied when the seller offers no
      // pickup option at all (see shippingFeeFor's own comment for why),
      // checked against the same pre-discount subtotal as the minimum-
      // order gate above. Shown as its own visible Stripe line item and
      // deliberately excluded from `amount` (and therefore the platform
      // application_fee_amount above) — shipping is a pass-through cost,
      // not marketplace revenue.
      const profile = sellerProfileByShop.get(sellerCart.sellerShopId);
      const shippingFee = shippingFeeFor({
        pickupAvailable: Boolean(profile?.pickup_available),
        shippingFlatFee: profile?.shipping_flat_fee,
        freeShippingOver: profile?.free_shipping_over,
        subtotal: rawSubtotalByShop.get(sellerCart.sellerShopId) || 0
      });
      const stripeLineItems = shippingFee > 0
        ? [...lineItems, { quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(shippingFee * 100), product_data: { name: "Shipping" } } }]
        : lineItems;
      const orderTotalWithShipping = orderTotal + shippingFee;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: user.email,
        line_items: stripeLineItems,
        payment_intent_data: {
          application_fee_amount: fee,
          transfer_data: { destination: sellerCart.destination }
        },
        success_url: `${site}/?marketplace=success`,
        cancel_url: `${site}/?marketplace=cancelled`,
        metadata: {
          marketplace: "wholesale",
          buyer_shop_id: String(shopId || ""),
          seller_shop_id: String(sellerCart.sellerShopId || ""),
          listing_ids: orderItems.map((i) => i.listing_id).join(","),
          quantity: String(orderItems.reduce((n, i) => n + i.quantity, 0)),
          ...(appliedPromo ? { promotion_code: appliedPromo.code } : {}),
          ...(appliedTier ? { pricing_tier: appliedTier.name, pricing_tier_min_quantity: String(appliedTier.min_quantity) } : {}),
          ...(discountPercent > 0 ? { discount_percent: String(discountPercent) } : {}),
          ...(shippingFee > 0 ? { shipping_fee: String(shippingFee) } : {})
        }
      });

      try {
        // buyer_user_id is required for the buyer to ever see this order
        // again — the "marketplace wholesale orders buyer read" RLS policy
        // matches on buyer_user_id = auth.uid(), not buyer_shop_id.
        // status must be one of the table's check-constraint values
        // ('pending', 'processing', 'paid', 'fulfilled', 'completed',
        // 'cancelled') — "pending_payment" is not one of them and was
        // silently failing every insert (caught below).
        await client.from("marketplace_wholesale_orders").insert({
          seller_shop_id: sellerCart.sellerShopId,
          buyer_shop_id: shopId,
          buyer_user_id: user.id,
          listing_id: orderItems[0]?.listing_id || null,
          status: "pending",
          total: orderTotalWithShipping,
          items: orderItems,
          metadata: {
            stripe_checkout_session_id: session.id,
            ...(appliedPromo ? { promotion_code: appliedPromo.code } : {}),
            ...(appliedTier ? { pricing_tier: appliedTier.name } : {}),
            ...(discountPercent > 0 ? { discount_percent: discountPercent } : {}),
            ...(shippingFee > 0 ? { shipping_fee: shippingFee } : {})
          }
        });
      } catch {
        /* table may not exist pre-migration */
      }

      sessions.push({
        url: session.url,
        seller_shop_id: sellerCart.sellerShopId,
        total: orderTotalWithShipping,
        shipping_fee: shippingFee,
        promo_applied: Boolean(appliedPromo),
        pricing_tier_applied: appliedTier ? appliedTier.name : null
      });
    }

    if (sessions.length === 1) {
      return json(200, { url: sessions[0].url, sessions });
    }
    return json(200, { urls: sessions.map((s) => s.url), sessions, message: "Complete checkout for each supplier." });
  } catch (error) {
    return fail(error);
  }
}

export async function handler(event) {
  return handleMarketplaceCheckout(event);
}
