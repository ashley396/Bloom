/** Resolve Stripe Price IDs for Florisyn subscription plans. */

import { normalizePricingPlan } from "../../../lib/pricing/florisyn-pricing.js";

const MONTHLY = {
  starter: "STRIPE_PRICE_STARTER",
  professional: "STRIPE_PRICE_PROFESSIONAL",
  premium: "STRIPE_PRICE_PREMIUM"
};

const ANNUAL = {
  starter: "STRIPE_PRICE_STARTER_ANNUAL",
  professional: "STRIPE_PRICE_PROFESSIONAL_ANNUAL",
  premium: "STRIPE_PRICE_PREMIUM_ANNUAL"
};

export function stripePriceEnvKey(planCode, interval = "monthly") {
  const code = normalizePricingPlan(planCode);
  const map = interval === "annual" ? ANNUAL : MONTHLY;
  return map[code] || null;
}

export function stripePriceId(planCode, interval = "monthly", env = process.env) {
  const key = stripePriceEnvKey(planCode, interval);
  if (!key) return null;
  return env[key] || null;
}
