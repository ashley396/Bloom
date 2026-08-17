/**
 * Stripe throws "You can only create new accounts if you've signed up for
 * Connect" when the *platform's own* Stripe account (the one behind
 * STRIPE_SECRET_KEY) hasn't activated Connect yet. That's a Florisyn
 * platform setup step, not something the florist/wholesaler did wrong —
 * surfacing Stripe's raw text there just confuses whoever clicked
 * "Connect." Rewrite it into something actionable.
 */
export function friendlyStripeConnectError(error) {
  const msg = String(error?.message || error?.raw?.message || "");
  if (/signed up for connect/i.test(msg)) {
    const e = new Error(
      "Florisyn's own Stripe account needs Connect turned on before shops can connect theirs. This is a one-time setup step for Florisyn (not something you did wrong) — an admin needs to enable Connect at dashboard.stripe.com/connect/accounts/overview, then try Connect again."
    );
    e.statusCode = 503;
    e.code = "platform_connect_not_enabled";
    return e;
  }
  return error;
}
