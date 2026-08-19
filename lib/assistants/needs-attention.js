/**
 * Lily Step 73: a real "Needs Attention" home experience.
 *
 * Built from exactly the same real, shop-timezone-correct numbers that
 * already back Rose's spoken dashboard briefing (see loadDashboard() in
 * public/app.js and netlify/functions/dashboard.js) — not a second
 * computation, and never the old hardcoded "I found new floral ideas
 * that match your inventory" placeholder that showed regardless of
 * whether anything actually needed attention.
 *
 * Every item is only included when the real count/amount is > 0, and
 * every item carries a `page` so the UI can deep-link straight to where
 * the florist would actually resolve it — not just fill a chat prompt.
 */

const ITEM_DEFS = [
  {
    key: "ordersDueToday",
    id: "orders-due",
    page: "ordersPage",
    label: (n) => `${n} order${n === 1 ? "" : "s"} due today`
  },
  {
    key: "deliveries",
    id: "active-deliveries",
    page: "deliveriesPage",
    label: (n) => `${n} active deliver${n === 1 ? "y" : "ies"}`
  },
  {
    key: "lowStock",
    id: "low-stock",
    page: "inventoryPage",
    label: (n) => `${n} low-stock item${n === 1 ? "" : "s"}`
  }
];

export function buildNeedsAttentionItems(summary = {}) {
  const items = [];
  for (const def of ITEM_DEFS) {
    const count = Number(summary[def.key] || 0);
    if (count > 0) items.push({ id: def.id, label: def.label(count), page: def.page, count });
  }
  const unpaid = Number(summary.unpaidTotal || 0);
  if (unpaid > 0) {
    items.push({
      id: "unpaid-balance",
      label: `$${unpaid.toFixed(2)} outstanding`,
      page: "invoicesPage",
      count: unpaid
    });
  }
  return items;
}

/** One honest sentence summarizing the list — no fabricated positivity, no fabricated urgency. */
export function needsAttentionSummaryText(items = []) {
  if (!items.length) return "You're all caught up — nothing needs attention right now.";
  if (items.length === 1) return items[0].label + ".";
  return `${items.length} things need a look: ${items.map((i) => i.label).join(", ")}.`;
}
