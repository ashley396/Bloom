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

    const site = stripeRedirectBaseUrl();
    const feePercent = Number(process.env.BLOOM_MARKETPLACE_FEE_PERCENT || 5);
    const sessions = [];

    for (const [, sellerCart] of bySeller) {
      const lineItems = sellerCart.lines.map(({ listing, quantity }) => ({
        quantity,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(Number(listing.price) * 100),
          product_data: { name: listing.name }
        }
      }));
      const amount = sellerCart.lines.reduce(
        (sum, { listing, quantity }) => sum + Math.round(Number(listing.price) * quantity * 100),
        0
      );
      const fee = Math.round(amount * (feePercent / 100));
      const orderItems = sellerCart.lines.map(({ listing, quantity }) => ({
        listing_id: listing.id,
        name: listing.name,
        quantity,
        unit_price: listing.price,
        unit: listing.unit || "each"
      }));
      const orderTotal = sellerCart.lines.reduce(
        (sum, { listing, quantity }) => sum + Number(listing.price) * quantity,
        0
      );

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: user.email,
        line_items: lineItems,
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
          quantity: String(orderItems.reduce((n, i) => n + i.quantity, 0))
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
          total: orderTotal,
          items: orderItems,
          metadata: { stripe_checkout_session_id: session.id }
        });
      } catch {
        /* table may not exist pre-migration */
      }

      sessions.push({ url: session.url, seller_shop_id: sellerCart.sellerShopId, total: orderTotal });
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
