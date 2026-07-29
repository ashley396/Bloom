import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import {
  canPurchaseWithVerification,
  checkoutListingSelectFields,
  isMissingVerificationTableError,
  mapCheckoutListing
} from "./_shared/marketplace-verification.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      const e = new Error("STRIPE_SECRET_KEY is not configured in Netlify.");
      e.statusCode = 503;
      throw e;
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { client, user } = await currentUser(event);
    const body = bodyOf(event);

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

    const { data: item, error } = await client
      .from("marketplace_listings")
      .select(checkoutListingSelectFields())
      .eq("id", body.listing_id)
      .single();
    if (error) throw error;

    const listing = mapCheckoutListing(item);
    if (!listing?.active) {
      return json(409, { error: "This marketplace listing is no longer available." });
    }

    const destination = listing.stripe_connect_account_id;
    if (!destination) {
      return json(409, { error: "This supplier has not completed Stripe Connect onboarding." });
    }

    const qty = Math.max(1, Number(body.quantity || 1));
    const amount = Math.round(Number(listing.price) * qty * 100);
    const fee = Math.round(amount * (Number(process.env.BLOOM_MARKETPLACE_FEE_PERCENT || 5) / 100));
    const site = (process.env.SITE_URL || event.headers.origin || "").replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [{
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(Number(listing.price) * 100),
          product_data: { name: listing.name }
        }
      }],
      payment_intent_data: {
        application_fee_amount: fee,
        transfer_data: { destination }
      },
      success_url: `${site}/?marketplace=success`,
      cancel_url: `${site}/?marketplace=cancelled`,
      metadata: { listing_id: listing.id }
    });

    return json(200, { url: session.url });
  } catch (error) {
    return fail(error);
  }
}
