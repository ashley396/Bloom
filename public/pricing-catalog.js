/** Browser pricing catalog — keep in sync with lib/pricing/florisyn-pricing.js */

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

export function annualTotal(monthly) {
  return monthly * (12 - ANNUAL_MONTHS_FREE);
}

export function annualMonthlyDisplay(monthly) {
  return Math.round(annualTotal(monthly) / 12);
}

export function planQuote(monthly, interval = "monthly") {
  if (interval === "annual") {
    const billed = annualTotal(monthly);
    return {
      interval,
      display: annualMonthlyDisplay(monthly),
      billed,
      savings: monthly * 12 - billed
    };
  }
  return { interval: "monthly", display: monthly, billed: monthly, savings: 0 };
}

export function formatMoney(amount) {
  return `$${Number(amount).toLocaleString("en-US")}`;
}
