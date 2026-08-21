/** Bloom Business Ecosystem v1 — pure domain logic (POS, payments, wholesale, Lily). */

import { shopDateStr } from "./shop-time.js";

export const FLOWER_SCHEDULES = ["weekly", "biweekly", "monthly", "quarterly", "custom"];
export const FLOWER_SUBSCRIPTION_TYPES = [
  { key: "fresh_flowers", label: "Fresh flowers" },
  { key: "office", label: "Office flowers" },
  { key: "restaurant", label: "Restaurant flowers" },
  { key: "church", label: "Church flowers" },
  { key: "funeral_home", label: "Funeral home flowers" },
  { key: "birthday_club", label: "Birthday Club" },
  { key: "anniversary_club", label: "Anniversary Club" },
  { key: "seasonal_porch", label: "Seasonal porch pots" },
  { key: "holiday_centerpiece", label: "Holiday centerpieces" },
  { key: "custom", label: "Custom plan" }
];

export const LOYALTY_TIERS = [
  { id: "bloom", label: "Florisyn", min_points: 0, multiplier: 1 },
  { id: "silver", label: "Silver", min_points: 500, multiplier: 1.1 },
  { id: "gold", label: "Florisyn Gold", min_points: 1500, multiplier: 1.25 },
  { id: "platinum", label: "Florisyn Platinum", min_points: 4000, multiplier: 1.5 }
];

export const MEMBERSHIP_TEMPLATES = [
  { key: "bloom_gold", label: "Florisyn Gold", benefits: ["10% off", "Free delivery over $75", "Bonus points"] },
  { key: "bloom_platinum", label: "Florisyn Platinum", benefits: ["15% off", "Free delivery", "Priority ordering", "Exclusive products"] },
  { key: "wedding", label: "Wedding Membership", benefits: ["Planning consult", "10% off wedding orders"] },
  { key: "business", label: "Business Membership", benefits: ["Net-30 option", "Dedicated rep", "Volume pricing"] }
];

export const PO_STATUSES = ["draft", "pending_approval", "approved", "sent", "partial", "received", "closed", "cancelled"];
export const DELIVERY_STATUSES = ["scheduled", "out_for_delivery", "delivered", "failed", "returned"];

export function addDays(date, days) {
  const raw = typeof date === "string" ? date.trim() : "";
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
    : new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nextDeliveryDate(schedule, fromDate = new Date(), customIntervalDays = null) {
  const map = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, custom: Number(customIntervalDays) || 30 };
  const add = map[schedule] || 7;
  return addDays(fromDate, add);
}

export function validateFlowerSubscription(body = {}) {
  const errors = [];
  if (!body.customer_id && !body.customer_name) errors.push("Customer is required.");
  if (!FLOWER_SCHEDULES.includes(body.schedule)) errors.push("Invalid delivery schedule.");
  if (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) errors.push("Subscription amount must be greater than zero.");
  return { valid: errors.length === 0, errors };
}

export function computeLoyaltyEarn(amount, tierId = "bloom") {
  const tier = LOYALTY_TIERS.find((t) => t.id === tierId) || LOYALTY_TIERS[0];
  const base = Math.floor(Number(amount || 0));
  return Math.round(base * tier.multiplier);
}

export function computeLoyaltyTier(points) {
  const p = Number(points || 0);
  let current = LOYALTY_TIERS[0];
  for (const t of LOYALTY_TIERS) {
    if (p >= t.min_points) current = t;
  }
  return current;
}

export function validatePointsRedeem(balance, points) {
  const b = Number(balance || 0);
  const r = Number(points || 0);
  if (r <= 0) return { valid: false, error: "Redemption must be positive." };
  if (r > b) return { valid: false, error: "Insufficient points." };
  return { valid: true, remaining: b - r };
}

export function membershipDiscountPercent(membershipKey) {
  const map = { bloom_gold: 10, bloom_platinum: 15, wedding: 10, business: 5 };
  return map[membershipKey] || 0;
}

export function canTransitionPO(from, to) {
  const order = PO_STATUSES.indexOf(from);
  const next = PO_STATUSES.indexOf(to);
  return order >= 0 && next >= 0 && next >= order;
}

export function buildFinanceCenter(financeTotals = {}, extras = {}) {
  const revenue = Number(financeTotals.revenue || extras.revenue || 0);
  const expenses = Number(financeTotals.expenses || extras.expenses || 0);
  const profit = revenue - expenses;
  return {
    profit_and_loss: { revenue, expenses, profit, margin: revenue ? (profit / revenue) * 100 : 0 },
    cash_flow: { inflow: revenue, outflow: expenses, net: profit },
    accounts_receivable: Number(extras.accounts_receivable || 0),
    accounts_payable: Number(extras.accounts_payable || 0),
    expenses_total: expenses,
    sales_tax: Number(extras.sales_tax || 0),
    payroll_summary: Number(extras.payroll_summary || 0),
    invoice_aging: extras.invoice_aging || { current: 0, days_30: 0, days_60: 0, days_90_plus: 0 },
    // Florisyn functional-completion pass #3: these used to fall back to a
    // formula guessed off revenue (85% of revenue as a "monthly budget",
    // 90% as "bank deposits") whenever no real figure was supplied — a made
    // -up number presented in the same shape as every other real field
    // here. No budget-setting feature or bank-reconciliation source exists
    // yet, so there is no real value to compute; `null` says exactly that
    // instead of manufacturing one.
    budgets: extras.budgets || { monthly: null, actual: expenses },
    bank_deposits: extras.bank_deposits != null ? Number(extras.bank_deposits) : null
  };
}

export function buildBusinessDashboardKpis(base = {}, ecosystem = {}) {
  return {
    revenue: base.totalSales ?? base.todaySales ?? 0,
    profit: base.profit ?? 0,
    best_sellers: ecosystem.best_sellers || [],
    low_inventory: base.lowStock ?? 0,
    upcoming_deliveries: base.deliveriesToday ?? base.upcomingDeliveries?.length ?? 0,
    recurring_revenue: Number(ecosystem.recurring_revenue || 0),
    wholesale_sales: Number(ecosystem.wholesale_sales || 0),
    marketplace_sales: Number(ecosystem.marketplace_sales || 0),
    employee_productivity: ecosystem.employee_productivity || null
  };
}

// Beta-blocker repair: waste_risk used to be hardcoded ("Medium") for every
// shop regardless of its real state. The inventory table already carries
// real received_at/use_by freshness-tracking columns (added specifically
// for "use-first" waste tracking) — this only evaluates currently-stocked
// items that actually have a use_by date set, so a shop that has never
// used freshness tracking gets an honest `null` (no real signal) instead
// of a guess. "High" only when a meaningful share of tracked items are
// already at or past their use-by date while still in stock.
export function computeWasteRisk(inventoryRows = [], timezone) {
  const tracked = inventoryRows.filter((i) => i.use_by && Number(i.quantity) > 0);
  if (tracked.length === 0) return null;
  const today = shopDateStr(timezone);
  const atRisk = tracked.filter((i) => String(i.use_by).slice(0, 10) <= today).length;
  return atRisk / tracked.length >= 0.2 ? "High" : "Low";
}

export function buildLilyBusinessCoach(context = {}) {
  const suggestions = [];
  const low = context.low_stock_count || 0;
  if (low > 0) {
    suggestions.push({ id: "reorder", title: "Reorder flowers", detail: `${low} SKUs need restock.`, prompt: "What should I reorder first?" });
  }
  if (context.waste_risk === "High") {
    suggestions.push({ id: "waste", title: "Reduce waste", detail: "Use aging stems in daily specials.", prompt: "Build a promotion using aging inventory" });
  }
  if (context.margin_health && context.margin_health < 60) {
    suggestions.push({ id: "margin", title: "Improve margins", detail: "Review pricing on top sellers.", prompt: "Which products should I increase prices on?" });
  }
  if (context.subscription_count < 5) {
    suggestions.push({ id: "subs", title: "Grow subscriptions", detail: "Offer office or birthday club plans.", prompt: "Draft a flower subscription offer for offices" });
  }
  if (context.unpaid_total > 100) {
    suggestions.push({ id: "ar", title: "Collect receivables", detail: `$${context.unpaid_total.toFixed(0)} outstanding.`, prompt: "Show unpaid orders" });
  }
  suggestions.push({ id: "holiday", title: "Holiday planning", detail: "Prep inventory and marketing early.", prompt: "Holiday campaign for our shop" });
  if (context.vendor_savings) {
    suggestions.push({ id: "vendor", title: "Vendor savings", detail: "Compare last PO costs.", prompt: "Summarize vendor spend this month" });
  }
  return suggestions.slice(0, 7);
}

export const REPORT_CATALOG = [
  { id: "financial", label: "Financial", sources: ["finance", "expenses"] },
  { id: "sales", label: "Sales", sources: ["orders", "payments"] },
  { id: "inventory", label: "Inventory", sources: ["inventory"] },
  { id: "payroll", label: "Payroll", sources: ["staff"] },
  { id: "customers", label: "Customers", sources: ["customers", "loyalty"] },
  { id: "marketing", label: "Marketing", sources: ["website", "lily"] },
  { id: "subscriptions", label: "Subscriptions", sources: ["bloom_customer_subscriptions"] },
  { id: "marketplace", label: "Marketplace", sources: ["marketplace"] },
  { id: "wholesale", label: "Wholesale", sources: ["wholesale"] }
];

export function portalCapabilities() {
  return ["orders", "deliveries", "subscriptions", "payment_methods", "gift_cards", "invoices", "loyalty", "rewards"];
}
