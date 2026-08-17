// One Stripe client for the whole app.
//
// Stripe's guidance is to construct a single client at startup and reuse
// it for every request rather than `new Stripe(...)` per-request — the
// client pools HTTP connections internally, so re-creating it is wasted
// work. Every route in server.js imports `stripeClient` from here.
import "dotenv/config";
import Stripe from "stripe";

const RAW_KEY = process.env.STRIPE_SECRET_KEY;

// A copy-pasted README key ("sk_test_REPLACE_ME") looks enough like a
// real key that Stripe would accept the *shape* and only fail deep
// inside whichever API call happens to run first, as a bare 401. Catching
// it here — before the server even starts — turns that into one clear
// message that says exactly what to do next.
function assertRealKey(value, envVarName, dashboardUrl) {
  const looksLikePlaceholder =
    !value || value.includes("REPLACE_ME") || value.includes("your_") || value.trim() === "";
  if (looksLikePlaceholder) {
    throw new Error(
      `\nMissing or placeholder ${envVarName}.\n\n` +
        `  1. Copy .env.example to .env (if you haven't already)\n` +
        `  2. Get a real value from ${dashboardUrl}\n` +
        `  3. Set ${envVarName}=... in .env\n\n` +
        `This sample talks to Stripe on every route — it can't run without a real ${envVarName}.\n`
    );
  }
}

assertRealKey(RAW_KEY, "STRIPE_SECRET_KEY", "https://dashboard.stripe.com/test/apikeys");

// The API version is intentionally NOT passed to `new Stripe(...)` here.
// Every stripe-node release pins itself to the API version it was built
// and tested against (this sample's package.json requires stripe@^22.5.0,
// which speaks the 2026-07-29.dahlia API version) — omitting the option
// lets the SDK apply that version automatically instead of us
// hardcoding a string that would drift out of sync with the package.
export const stripeClient = new Stripe(RAW_KEY);
