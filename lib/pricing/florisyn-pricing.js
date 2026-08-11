/** Florisyn public subscription pricing — single source of truth for tiers and annual math. */

export const ANNUAL_MONTHS_FREE = 2;
export const TRIAL_DAYS = 14;

export const PRICING_TIERS = [
  {
    code: "starter",
    signupCode: "starter",
    name: "Starter",
    monthly: 59,
    summary: "Essential POS, orders, and inventory for solo shops.",
    features: [
      "Florist POS & order center",
      "Customer records & order history",
      "Inventory & low-stock alerts",
      "Product catalog & recipes",
      "Payments & invoices",
      "Mobile-friendly workspace"
    ]
  },
  {
    code: "professional",
    signupCode: "pro",
    name: "Pro",
    monthly: 99,
    popular: true,
    summary: "The full operating system — reporting, deliveries, website, and AI.",
    features: [
      "Everything in Starter",
      "Delivery routing & dispatch",
      "Lily & Rose AI assistants",
      "Website Studio with SEO",
      "Email campaigns",
      "Advanced reports & dashboards"
    ]
  },
  {
    code: "premium",
    signupCode: "premium",
    name: "Premium",
    monthly: 149,
    summary: "Multi-store, wholesale, AI Suite, and priority support.",
    features: [
      "Everything in Pro",
      "Multi-store management",
      "Wholesale marketplace seller tools",
      "AI Suite — Marketing, Photo & POS intelligence",
      "Custom domain & DNS verification",
      "Priority support"
    ]
  }
];

export function normalizePricingPlan(code) {
  if (code === "pro") return "professional";
  return code || "trial";
}

export function tierByCode(code) {
  const normalized = normalizePricingPlan(code);
  return PRICING_TIERS.find((t) => t.code === normalized) || null;
}

export function tierBySignupCode(signupCode) {
  return PRICING_TIERS.find((t) => t.signupCode === signupCode) || null;
}

export function monthlyPrice(planCode) {
  return tierByCode(planCode)?.monthly ?? 0;
}

/** Total charged once per year (pay for 10 months — 2 months free). */
export function annualTotal(monthly) {
  return monthly * (12 - ANNUAL_MONTHS_FREE);
}

/** Display price when showing annual plans as a monthly equivalent. */
export function annualMonthlyDisplay(monthly) {
  return Math.round(annualTotal(monthly) / 12);
}

export function planQuote(planCode, interval = "monthly") {
  const monthly = monthlyPrice(planCode);
  if (!monthly) {
    return { interval, monthly: 0, display: 0, billed: 0, savings: 0 };
  }
  if (interval === "annual") {
    const billed = annualTotal(monthly);
    return {
      interval,
      monthly,
      display: annualMonthlyDisplay(monthly),
      billed,
      savings: monthly * 12 - billed
    };
  }
  return {
    interval: "monthly",
    monthly,
    display: monthly,
    billed: monthly,
    savings: 0
  };
}

export function validSubscriptionPrices() {
  const prices = new Set();
  for (const tier of PRICING_TIERS) {
    prices.add(tier.monthly);
    prices.add(annualTotal(tier.monthly));
  }
  return [...prices];
}

export function catalogForClient() {
  return {
    annualMonthsFree: ANNUAL_MONTHS_FREE,
    trialDays: TRIAL_DAYS,
    tiers: PRICING_TIERS.map((tier) => ({
      ...tier,
      quotes: {
        monthly: planQuote(tier.code, "monthly"),
        annual: planQuote(tier.code, "annual")
      }
    }))
  };
}
