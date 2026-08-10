/**
 * Platform economics — estimated infrastructure burn vs subscription MRR.
 * Pure estimates for owner planning; verify against vendor dashboards monthly.
 */

import { planPrice } from "../../netlify/functions/_shared/shop-billing.js";
import { PRICING_TIERS } from "../pricing/florisyn-pricing.js";

export const ECONOMICS_ASSUMPTIONS = {
  domain_usd_monthly: 1.25,
  netlify: {
    pro_base: 19,
    /** USD per 100k function invocations above included allowance */
    per_100k_invocations: 25,
    included_invocations: 125_000,
    /** Rough daily API + webhook calls per active shop */
    invocations_per_shop_day: 180
  },
  supabase: {
    pro_base: 25,
    /** Extra compute when many concurrent shops */
    compute_addon: 50,
    /** USD per GB above 8 GB included on Pro */
    per_gb_storage: 0.125,
    /** Estimated stored assets per shop (GB) */
    storage_gb_per_shop: 0.08,
    included_storage_gb: 8
  },
  ai: {
    /** Cloudflare Workers AI — USD per 1k assistant requests */
    per_1k_requests: 0.12,
    requests_per_shop_day: 35
  },
  email: {
    base: 0,
    /** Resend-style tier kick-in */
    pro_base: 20,
    emails_per_shop_month: 18
  },
  maps: {
    /** Share of shops using routed delivery distance monthly */
    shop_fraction: 0.35,
    routes_per_shop_month: 120,
    /** USD per 1k distance lookups after Google credit */
    per_1k_lookups: 5
  },
  stripe: {
    /** Platform subscription processing — not florist customer payments */
    percent: 0.029,
    fixed_usd: 0.3
  }
};

function normalizePlanCounts(metrics = {}) {
  const starter = Number(metrics.starter || 0);
  const professional = Number(metrics.professional || metrics.pro || 0);
  const premium = Number(metrics.premium || 0);
  const active = Number(metrics.activeSubscriptions || metrics.active_subscriptions || 0);
  const known = starter + professional + premium;
  if (known >= active || active === 0) {
    return { starter, professional, premium, active: known || active };
  }
  const ratio = active / Math.max(1, known);
  return {
    starter: Math.round(starter * ratio),
    professional: Math.round(professional * ratio),
    premium: Math.round(premium * ratio),
    active
  };
}

export function estimateMonthlyInvocations(activeShops, assumptions = ECONOMICS_ASSUMPTIONS) {
  const perShop = assumptions.netlify.invocations_per_shop_day * 30;
  return Math.round(activeShops * perShop);
}

export function estimateNetlifyUsd(activeShops, assumptions = ECONOMICS_ASSUMPTIONS) {
  const invocations = estimateMonthlyInvocations(activeShops, assumptions);
  const { pro_base, included_invocations, per_100k_invocations } = assumptions.netlify;
  const overage = Math.max(0, invocations - included_invocations);
  const overageBlocks = Math.ceil(overage / 100_000);
  return roundUsd(pro_base + overageBlocks * per_100k_invocations);
}

export function estimateSupabaseUsd(activeShops, assumptions = ECONOMICS_ASSUMPTIONS) {
  const { pro_base, compute_addon, per_gb_storage, storage_gb_per_shop, included_storage_gb } =
    assumptions.supabase;
  const storageGb = activeShops * storage_gb_per_shop;
  const storageOverage = Math.max(0, storageGb - included_storage_gb);
  const compute = activeShops >= 50 ? compute_addon : 0;
  return roundUsd(pro_base + compute + storageOverage * per_gb_storage);
}

export function estimateAiUsd(activeShops, assumptions = ECONOMICS_ASSUMPTIONS) {
  const requests = activeShops * assumptions.ai.requests_per_shop_day * 30;
  return roundUsd((requests / 1000) * assumptions.ai.per_1k_requests);
}

export function estimateEmailUsd(activeShops, assumptions = ECONOMICS_ASSUMPTIONS) {
  const emails = activeShops * assumptions.email.emails_per_shop_month;
  if (emails <= 3000) return assumptions.email.base;
  return assumptions.email.pro_base;
}

export function estimateMapsUsd(activeShops, assumptions = ECONOMICS_ASSUMPTIONS) {
  const shopsUsingMaps = activeShops * assumptions.maps.shop_fraction;
  const lookups = shopsUsingMaps * assumptions.maps.routes_per_shop_month;
  return roundUsd((lookups / 1000) * assumptions.maps.per_1k_lookups);
}

export function computeMrrFromPlans(planCounts = {}) {
  return roundUsd(
    (planCounts.starter || 0) * planPrice("starter") +
      (planCounts.professional || 0) * planPrice("professional") +
      (planCounts.premium || 0) * planPrice("premium")
  );
}

export function estimateStripeFeesOnMrr(mrr, assumptions = ECONOMICS_ASSUMPTIONS) {
  const payingSubs = mrr > 0 ? Math.max(1, Math.round(mrr / 85)) : 0;
  const { percent, fixed_usd } = assumptions.stripe;
  return roundUsd(mrr * percent + payingSubs * fixed_usd);
}

export function buildPlatformEconomics(metrics = {}, options = {}) {
  const assumptions = { ...ECONOMICS_ASSUMPTIONS, ...(options.assumptions || {}) };
  const planCounts = normalizePlanCounts(metrics);
  const activeShops = Math.max(
    Number(metrics.shops || 0),
    planCounts.active,
    Number(metrics.activeSubscriptions || 0)
  );
  const payingActive = Math.max(0, activeShops - Number(metrics.trials || 0));

  const mrrFromPlans = computeMrrFromPlans(planCounts);
  const mrrReported = roundUsd(Number(metrics.estimatedMrr || 0));
  const mrr = mrrReported > 0 ? mrrReported : mrrFromPlans;

  const lineItems = [
    { key: "netlify", label: "Netlify (hosting + functions)", usd: estimateNetlifyUsd(activeShops, assumptions), category: "infra" },
    { key: "supabase", label: "Supabase (database + auth + storage)", usd: estimateSupabaseUsd(activeShops, assumptions), category: "infra" },
    { key: "domain", label: "Domain registrar", usd: assumptions.domain_usd_monthly, category: "infra" },
    { key: "ai", label: "Cloudflare Workers AI (Lily / Rose / AI Suite)", usd: estimateAiUsd(activeShops, assumptions), category: "variable" },
    { key: "email", label: "Transactional email (Resend tier)", usd: estimateEmailUsd(activeShops, assumptions), category: "variable" },
    { key: "maps", label: "Google Maps delivery routing", usd: estimateMapsUsd(activeShops, assumptions), category: "variable" }
  ];

  const infraUsd = roundUsd(lineItems.filter((x) => x.category === "infra").reduce((s, x) => s + x.usd, 0));
  const variableUsd = roundUsd(lineItems.filter((x) => x.category === "variable").reduce((s, x) => s + x.usd, 0));
  const estimatedBurnUsd = roundUsd(infraUsd + variableUsd);
  const stripeFeesUsd = estimateStripeFeesOnMrr(mrr, assumptions);
  const netAfterInfraUsd = roundUsd(mrr - estimatedBurnUsd);
  const netAfterStripeUsd = roundUsd(mrr - estimatedBurnUsd - stripeFeesUsd);
  const infraPercentOfMrr = mrr > 0 ? roundPct((estimatedBurnUsd / mrr) * 100) : null;

  return {
    active_shops: activeShops,
    paying_subscribers: payingActive,
    plan_counts: planCounts,
    mrr_usd: mrr,
    mrr_from_plans_usd: mrrFromPlans,
    estimated_monthly_invocations: estimateMonthlyInvocations(activeShops, assumptions),
    line_items: lineItems,
    infra_usd: infraUsd,
    variable_usd: variableUsd,
    estimated_burn_usd: estimatedBurnUsd,
    stripe_fees_usd: stripeFeesUsd,
    net_after_infra_usd: netAfterInfraUsd,
    net_after_stripe_usd: netAfterStripeUsd,
    infra_percent_of_mrr: infraPercentOfMrr,
    margin_after_infra_percent: mrr > 0 ? roundPct((netAfterInfraUsd / mrr) * 100) : null,
    scale_band: scaleBand(activeShops),
    assumptions_summary: assumptionsSummary(activeShops, assumptions),
    pricing_tiers: PRICING_TIERS.map((t) => ({ code: t.code, name: t.name, monthly: t.monthly }))
  };
}

function scaleBand(activeShops) {
  if (activeShops >= 500) return "500+ subscribers";
  if (activeShops >= 100) return "100–499 subscribers";
  if (activeShops >= 20) return "20–99 subscribers";
  return "Launch (under 20 shops)";
}

function assumptionsSummary(activeShops, assumptions) {
  return [
    `${assumptions.netlify.invocations_per_shop_day} function calls / shop / day`,
    `${assumptions.ai.requests_per_shop_day} AI requests / shop / day`,
    `${Math.round(assumptions.maps.shop_fraction * 100)}% of shops using delivery maps`,
    activeShops >= 50 ? "Supabase Pro + compute add-on modeled" : "Supabase Pro base modeled"
  ];
}

function roundUsd(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function roundPct(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

/** Fixed scenario helper for owner planning (e.g. 500 subscribers). */
export function economicsScenario(subscriberCount, planMix = { starter: 0.4, professional: 0.45, premium: 0.15 }) {
  const starter = Math.round(subscriberCount * planMix.starter);
  const professional = Math.round(subscriberCount * planMix.professional);
  const premium = Math.max(0, subscriberCount - starter - professional);
  return buildPlatformEconomics({
    shops: subscriberCount,
    activeSubscriptions: subscriberCount,
    trials: 0,
    starter,
    professional,
    premium,
    estimatedMrr: computeMrrFromPlans({ starter, professional, premium })
  });
}
