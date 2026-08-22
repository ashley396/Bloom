/** Lily AI Platform v1 — intent, permissions, and action planning (server-side). */

import { buildLilyBusinessCoach } from "./business-ecosystem.js";
import { isMarketplaceSourcingMessage, detectFlowerMentions } from "./marketplace-lily-sourcing.js";

export const LILY_DOMAINS = [
  "inventory",
  "orders",
  "customers",
  "marketing",
  "marketplace",
  "wholesale",
  "website",
  "reports",
  "employees",
  "navigation",
  "product_ai",
  "coach",
  "general"
];

const ROLE_RANK = { staff: 1, designer: 1, driver: 1, employee: 1, manager: 2, owner: 3, admin: 4 };

/**
 * Ecosystem action tiers (Lily Step 76) — a real, testable classification
 * of every action Lily can plan, not just a hand-authored true/false:
 *
 *   READ        pure lookup/navigation — no side effect, never confirmed.
 *   LOW         content Lily hands to the florist to review before it goes
 *               anywhere (a marketing draft, a product description) — not
 *               a change to shop data, never confirmed.
 *   IMPORTANT   a real write to shop data (add inventory, start an order,
 *               file a support ticket) — always confirmed before Florisyn
 *               acts.
 *   DESTRUCTIVE removes or cancels data, or can't be undone. Nothing is
 *               wired at this tier today — every remove/cancel intent
 *               (e.g. inventory.remove) hands off to a guided screen for
 *               the florist to do it themselves, instead of Lily acting
 *               directly. Defined now so a future destructive action has
 *               a real tier — and the extra confirmation friction that
 *               comes with it — to land in, rather than being bolted on
 *               as a one-off special case.
 */
export const ACTION_TIERS = ["READ", "LOW", "IMPORTANT", "DESTRUCTIVE"];

export function requiresConfirmationForTier(tier) {
  return tier === "IMPORTANT" || tier === "DESTRUCTIVE";
}

export function detectIntent(message = "") {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();

  if (/^add\s+\d+/i.test(text) && /rose|stem|hydrangea|inventory|bunch|flower/i.test(text)) {
    const m = text.match(/add\s+(\d+)\s+(.+)/i);
    return { domain: "inventory", intent: "inventory.add", confidence: 0.92, slots: { quantity: m?.[1], item: m?.[2]?.trim() } };
  }
  if (/^remove\s+\d+/i.test(text)) {
    const m = text.match(/remove\s+(\d+)\s+(.+)/i);
    return { domain: "inventory", intent: "inventory.remove", confidence: 0.9, slots: { quantity: m?.[1], item: m?.[2]?.trim() } };
  }
  if (/create an order for/i.test(lower)) {
    const m = text.match(/create an order for\s+(.+)/i);
    return { domain: "orders", intent: "orders.create", confidence: 0.88, slots: { customer_name: m?.[1]?.trim() } };
  }
  if (/today'?s deliveries|show deliveries/i.test(lower)) {
    return { domain: "orders", intent: "deliveries.today", confidence: 0.86, slots: {} };
  }
  // Checked before customers.find's own "find ..." pattern below — "find
  // me 100 white roses for Friday" is a real flower name plus real
  // sourcing language, not a customer search, and must never fall
  // through to searching customers for a flower's name.
  if (/find\s+.+(carnation|wholesale|marketplace)|compare wholesale prices/i.test(lower) || isMarketplaceSourcingMessage(text)) {
    return { domain: "marketplace", intent: "marketplace.search", confidence: 0.84, slots: { query: text, flowers: detectFlowerMentions(text) } };
  }
  if (/find\s+.+/i.test(lower) && !/marketplace|wholesale|carnation/i.test(lower)) {
    const m = text.match(/find\s+(.+)/i);
    return { domain: "customers", intent: "customers.find", confidence: 0.8, slots: { query: m?.[1]?.trim() } };
  }
  if (/publish this product|create product description|wholesale description/i.test(lower)) {
    return { domain: "wholesale", intent: "wholesale.product", confidence: 0.83, slots: { prompt: text } };
  }
  // Narrowed on purpose (AI-OS Phase 2): this used to also match the bare
  // word "website" anywhere in the message, which hijacked real creation/
  // campaign requests ("make a campaign for Facebook and my website...")
  // into a content-free navigate the instant "website" appeared, no matter
  // what the rest of the sentence asked for. "update homepage" and "add
  // this product" are genuinely unambiguous single-purpose navigation
  // requests; anything else now falls through to the LLM classifier in
  // ai-intent-router.js, which reads the whole sentence instead of one word.
  if (/update homepage|add this product/i.test(lower)) {
    return { domain: "website", intent: "website.update", confidence: 0.78, slots: { prompt: text } };
  }
  if (/reorder|reduce waste|improve margin|subscription growth|vendor savings|holiday planning/i.test(lower)) {
    return { domain: "coach", intent: "coach.business", confidence: 0.84, slots: { prompt: text } };
  }
  if (/most profit|what made.*profit|revenue/i.test(lower)) {
    return { domain: "reports", intent: "reports.insights", confidence: 0.82, slots: {} };
  }
  if (/clock in/i.test(lower)) {
    const m = text.match(/clock in\s+(.+)/i);
    return { domain: "employees", intent: "employees.clock_in", confidence: 0.87, slots: { name: m?.[1]?.trim() } };
  }
  if (/payroll|show payroll/i.test(lower)) {
    return { domain: "employees", intent: "employees.payroll", confidence: 0.85, slots: {} };
  }
  if (/generate.*product|product title|seo|tags|variant|suggested price/i.test(lower)) {
    return { domain: "product_ai", intent: "product_ai.generate", confidence: 0.8, slots: { prompt: text } };
  }
  if (/photograph arrangement|flower recognition|recipe estimation|cost estimate/i.test(lower)) {
    return { domain: "product_ai", intent: "florist.photo_placeholder", confidence: 0.75, slots: {} };
  }
  if (/new users today|marketplace growth|pending approvals|support backlog|system health/i.test(lower)) {
    return { domain: "admin", intent: "admin.insights", confidence: 0.7, slots: { prompt: text } };
  }
  if (/\b(bug|broken|not working|isn'?t working|error message|crash(ed|ing)?|glitch|won'?t (save|load|open)|keeps? (failing|erroring)|stuck on|something'?s wrong)\b/i.test(lower)) {
    return { domain: "support", intent: "support.report_issue", confidence: 0.86, slots: { prompt: text } };
  }

  return { domain: "general", intent: "general.chat", confidence: 0.4, slots: { prompt: text } };
}

function inferMarketingChannel(lower) {
  if (lower.includes("facebook")) return "facebook";
  if (lower.includes("instagram")) return "instagram";
  if (lower.includes("google")) return "google_business";
  if (lower.includes("sms")) return "sms";
  if (lower.includes("blog")) return "blog";
  if (lower.includes("email")) return "email";
  if (lower.includes("holiday")) return "holiday_campaign";
  return "general";
}

const PERMISSIONS = {
  "inventory.add": ["owner", "manager", "staff", "designer"],
  "inventory.remove": ["owner", "manager"],
  "orders.create": ["owner", "manager", "staff"],
  "deliveries.today": ["owner", "manager", "staff", "driver"],
  "customers.find": ["owner", "manager", "staff"],
  "marketing.generate": ["owner", "manager", "staff", "designer"],
  "marketplace.search": ["owner", "manager", "staff"],
  "wholesale.product": ["owner", "manager"],
  "website.update": ["owner", "manager"],
  "reports.insights": ["owner", "manager"],
  "employees.clock_in": ["owner", "manager", "staff"],
  "employees.payroll": ["owner", "manager"],
  "product_ai.generate": ["owner", "manager", "staff", "designer"],
  "florist.photo_placeholder": ["owner", "manager", "staff", "designer"],
  "navigation.open": ["owner", "manager", "staff", "designer", "driver", "employee"],
  "general.chat": ["owner", "manager", "staff", "designer", "driver", "employee"],
  "support.report_issue": ["owner", "manager", "staff", "designer", "driver", "employee"],
  "admin.insights": ["super_admin", "support", "billing", "designer"]
};

export function checkLilyPermission(intent, role, { isPlatformAdmin = false } = {}) {
  if (intent.startsWith("admin.")) {
    return isPlatformAdmin ? { allowed: true } : { allowed: false, reason: "admin_only" };
  }
  const allowedRoles = PERMISSIONS[intent] || PERMISSIONS["general.chat"];
  const normalized = String(role || "staff").toLowerCase();
  if (allowedRoles.includes(normalized)) return { allowed: true };
  if (ROLE_RANK[normalized] >= ROLE_RANK.manager && allowedRoles.includes("manager")) {
    return { allowed: true };
  }
  return { allowed: false, reason: "insufficient_role" };
}

export function planClientAction(intent, slots = {}) {
  const plan = planClientActionByTier(intent, slots);
  if (!plan) return null;
  const { tier, ...rest } = plan;
  return { ...rest, tier, requiresConfirmation: requiresConfirmationForTier(tier) };
}

function planClientActionByTier(intent, slots = {}) {
  switch (intent) {
    case "inventory.add":
      return {
        tier: "IMPORTANT",
        type: "api",
        label: `Add ${slots.quantity} ${slots.item} to inventory`,
        navigate: "inventoryPage",
        endpoint: "inventory",
        method: "POST",
        body: { name: slots.item, quantity: Number(slots.quantity || 0) }
      };
    case "inventory.remove":
      // Lily never removes stock directly — she hands off to a guided
      // screen for the florist to do it themselves, so this is IMPORTANT
      // (a confirmed handoff), not DESTRUCTIVE (nothing is deleted here).
      return {
        tier: "IMPORTANT",
        type: "guided",
        label: "Adjust inventory manually",
        navigate: "inventoryPage",
        message: `Open inventory to remove ${slots.quantity} ${slots.item}. Lily will not delete stock without your confirmation.`
      };
    case "orders.create":
      return {
        tier: "IMPORTANT",
        type: "guided",
        label: `Start order for ${slots.customer_name}`,
        navigate: "ordersPage",
        openDialog: "orderDialog",
        prefill: { customer_name: slots.customer_name }
      };
    case "deliveries.today":
      return { tier: "READ", type: "navigate", navigate: "deliveriesPage" };
    case "customers.find":
      return { tier: "READ", type: "navigate", navigate: "customersPage", prefill: { search: slots.query } };
    case "marketplace.search":
      return { tier: "READ", type: "navigate", navigate: "marketplacePage", prefill: { search: slots.query } };
    case "wholesale.product":
      return { tier: "READ", type: "navigate", navigate: "wholesaleSellerPage" };
    case "website.update":
      return { tier: "READ", type: "navigate", navigate: "websitePage" };
    case "reports.insights":
      return { tier: "READ", type: "navigate", navigate: "reportsPage" };
    case "employees.clock_in":
      return { tier: "READ", type: "navigate", navigate: "staffPage", prefill: { staff: slots.name } };
    case "employees.payroll":
      return { tier: "READ", type: "navigate", navigate: "staffPage" };
    // marketing.generate intentionally has no case here anymore — real
    // marketing creation runs through classifyRequest()/runJob() in
    // lily-ai.js (AI-OS Phase 2/4), which plans and persists a finished
    // asset instead of handing back a bare "generate" directive. The
    // PERMISSIONS entry above is still used directly by that path.
    case "product_ai.generate":
      return { tier: "LOW", type: "generate", mode: "product", prompt: slots.prompt };
    case "florist.photo_placeholder":
      return {
        tier: "READ",
        type: "message",
        // This used to say the feature was "coming soon" — it's real now
        // (see lib/floral-library/recipe-intelligence.js and Florist
        // Community's "Build recipe with Lily" flow, which already does
        // confidence-labeled flower ID + a stem-count recipe from a photo).
        message: "I can already read flowers from a photo — post it to Florist Community and tap \"Build recipe with Lily\" for a confidence-labeled, editable stem-count recipe."
      };
    case "admin.insights":
      return { tier: "READ", type: "admin", navigate: "admin_command_center" };
    case "support.report_issue":
      return {
        tier: "IMPORTANT",
        type: "api",
        label: "Send this to Bud so he can look into it",
        successMessage: "Bud sent that in — Florisyn will follow up.",
        endpoint: "support-ticket",
        method: "POST",
        body: { action: "create", subject: String(slots.prompt || "").slice(0, 120), body: slots.prompt }
      };
    default:
      return null;
  }
}

export function buildCoachSuggestions(context = {}) {
  if (context.ecosystem_coach || context.use_ecosystem_coach) {
    return buildLilyBusinessCoach(context).map((s) => ({
      id: s.id,
      title: s.title,
      detail: s.detail,
      prompt: s.prompt
    }));
  }
  const suggestions = [];
  const inventory = Array.isArray(context.inventory) ? context.inventory : [];
  const orders = Array.isArray(context.recent_orders) ? context.recent_orders : [];
  const low = inventory.filter((row) => Number(row.quantity ?? 0) <= Number(row.low_stock_level ?? 5));
  if (low.length) {
    suggestions.push({
      id: "reorder",
      title: "Inventory reorder",
      detail: `${low.length} items are at or below low-stock levels.`,
      prompt: "Which items should I reorder first?"
    });
  }
  const unpaid = orders.filter((o) => String(o.payment_status || "").toUpperCase() === "UNPAID");
  if (unpaid.length) {
    suggestions.push({
      id: "collections",
      title: "Outstanding payments",
      detail: `${unpaid.length} recent orders are still unpaid.`,
      prompt: "Show unpaid orders from this week"
    });
  }
  if (inventory.length >= 5) {
    suggestions.push({
      id: "slow-movers",
      title: "Review slow-moving stems",
      detail: "Compare arrival dates and vase life in Inventory.",
      prompt: "What inventory should I use first today?"
    });
  }
  suggestions.push({
    id: "holiday",
    title: "Holiday preparation",
    detail: "Draft website and social content before peak dates.",
    prompt: "Write a holiday campaign email for our shop"
  });
  return suggestions.slice(0, 5);
}

function cryptoRandomId() {
  return `lily-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeHistoryEntry(entry = {}) {
  return {
    id: entry.id || cryptoRandomId(),
    role: entry.role === "assistant" ? "assistant" : "user",
    content: String(entry.content || "").slice(0, 8000),
    created_at: entry.created_at || new Date().toISOString()
  };
}

export function searchHistory(history = [], query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return history;
  return history.filter((row) => String(row.content || "").toLowerCase().includes(q));
}

export function mapAdminInsight(prompt = "", metrics = {}) {
  const lower = String(prompt || "").toLowerCase();
  const k = metrics.kpis || metrics;
  if (/new users today|users today/i.test(lower)) {
    return `New shop memberships today: ${k.new_users_today ?? k.new_members_today ?? "—"}. Total florists: ${k.total_florists ?? "—"}.`;
  }
  if (/revenue|mrr/i.test(lower)) {
    return `Monthly recurring revenue is ${formatMoney(k.monthly_recurring_revenue)}. Gross marketplace sales: ${formatMoney(k.gross_marketplace_sales)}.`;
  }
  if (/marketplace growth|listings/i.test(lower)) {
    return `Marketplace listings: ${k.total_marketplace_listings ?? "—"}. Sellers: ${k.total_marketplace_sellers ?? "—"}. Pending approvals: ${k.pending_marketplace_approvals ?? "—"}.`;
  }
  if (/pending approval|verification/i.test(lower)) {
    return `Pending florist verifications: ${k.pending_florist_verifications ?? "—"}. Pending marketplace approvals: ${k.pending_marketplace_approvals ?? "—"}.`;
  }
  if (/system health/i.test(lower)) {
    const health = metrics.health || {};
    return health.environment_valid
      ? "Core environment variables are configured. Review Command Center → System health for live checks."
      : `System health needs attention. Missing: ${(health.missing_env || []).slice(0, 5).join(", ") || "configuration"}.`;
  }
  if (/support backlog/i.test(lower)) {
    return `Open support tickets: ${k.open_support_tickets ?? metrics.support_open ?? "—"}.`;
  }
  return "Ask about new users, revenue, marketplace growth, pending approvals, system health, or support backlog.";
}

function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
