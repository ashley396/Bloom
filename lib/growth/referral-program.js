/** Florist referral program — codes, rewards, copy (pure). */

export const REFERRAL_REWARD = {
  referrerMonthsFree: 1,
  refereeMonthsFree: 1,
  label: "Give a month, get a month"
};

export function normalizeReferralCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 24);
}

export function generateReferralCode(shopName = "FLORIST") {
  const base = String(shopName || "FLORIST")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return normalizeReferralCode(`${base || "BLOOM"}-${suffix}`);
}

export function referralShareMessage(code, siteUrl = "https://www.florisyn.com") {
  const url = `${String(siteUrl).replace(/\/$/, "")}/signup?ref=${encodeURIComponent(code)}`;
  return {
    code,
    url,
    sms: `I'm using Florisyn for my flower shop — POS, website, and AI in one place. Start your free trial with my link and we both get a free month: ${url}`,
    emailSubject: "Try Florisyn — florist software built by a florist",
    emailBody: `I've been running my shop on Florisyn and thought you'd like it too.\n\nUse my referral link to start your 14-day trial. We each get a free month when you subscribe:\n${url}\n\n— sent from Florisyn`
  };
}

export const CASE_STUDIES = [
  {
    slug: "independent-retail-switch",
    shop: "Independent retail shop",
    city: "Kentucky",
    headline: "One platform replaced three subscriptions",
    quote: "We dropped separate POS, website, and email tools. Florisyn paid for itself the first month.",
    metrics: ["−3 software bills", "+Website orders in 6 weeks", "14-day trial → Pro"],
    plan: "Pro"
  },
  {
    slug: "wedding-studio-growth",
    shop: "Wedding & event studio",
    city: "Southeast US",
    headline: "Website Studio brought consultation requests online",
    quote: "Lily helped rewrite our wedding page and we finally rank for our city.",
    metrics: ["SEO live in one afternoon", "Deposits on file", "Premium for multi-designer"],
    plan: "Premium"
  },
  {
    slug: "peak-season-ops",
    shop: "High-volume delivery shop",
    city: "Midwest US",
    headline: "Mother's Day without the panic board",
    quote: "Holiday Command and delivery routing kept production visible when orders doubled.",
    metrics: ["Capacity alerts at 80%", "Zero missed delivery windows", "Staff on same screen"],
    plan: "Pro"
  }
];
