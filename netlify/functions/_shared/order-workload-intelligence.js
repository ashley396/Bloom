/**
 * Real, non-fabricated order/delivery workload signals (Phase 6 of the
 * "Florist-Facing Marketing Studio + Lily Connected Intelligence" pass —
 * "Do not fabricate urgency").
 *
 * Every bucket here is computed from real order rows this shop already
 * has — overdue/due-soon from real delivery_date vs. the shop's own
 * timezone-correct "today" (shopDateStr(), the same helper dashboard.js's
 * real KPIs already use — never the server's UTC day), not-designed/
 * not-ready from the real order status vocabulary (order-status.js —
 * the same one Orders/Deliveries pages already use), missing-assignment
 * from the real designer/driver text columns. Nothing here calls an AI
 * model — this is exactly the "code/DB for counts/dates, never ask an
 * LLM to calculate what SQL/JS can calculate reliably" rule: Lily's own
 * chat prompt gets a short, honest summary built from this, and can
 * explain WHY something is urgent (real reasoning, over real data), but
 * never invents that something is urgent when it isn't.
 *
 * Deliberately excludes CANCELLED and any terminal fulfillment status
 * (COMPLETED/DELIVERED) from every bucket — a shop's backlog is what's
 * still actually open, not its full order history.
 */

import { normalizeOrderStatus } from "./order-status.js";
import { shopDateStr } from "./shop-time.js";

const TERMINAL_STATUSES = new Set(["COMPLETED", "DELIVERED", "CANCELLED"]);
// "Not designed" = hasn't even started production yet — still PENDING/CONFIRMED.
const PRE_DESIGN_STATUSES = new Set(["PENDING", "CONFIRMED"]);
// "Not ready" = production hasn't finished — anything before READY/PICKUP_READY.
const PRE_READY_STATUSES = new Set(["PENDING", "CONFIRMED", "DESIGNING"]);
// "Delivery approaching" only makes sense once an order is actually staged
// to go out — READY or already OUT_FOR_DELIVERY, due today or already
// overdue for delivery.
const DELIVERY_STAGED_STATUSES = new Set(["READY", "OUT_FOR_DELIVERY"]);

const DEFAULT_SOON_DAYS = 2;

function dayDiff(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

function orderRef(o) {
  return { id: o.id, order_number: o.order_number || null, customer_name: o.customer_name || null, delivery_date: o.delivery_date || null, status: normalizeOrderStatus(o.status) };
}

/**
 * Pure — given real order rows (already scoped to this shop, already
 * excluding terminal statuses at the query level is fine but not
 * required, since this filters again) and the shop's own "today" date
 * string, buckets them into real, checkable workload signals. Never
 * throws; an order missing a field just doesn't qualify for the buckets
 * that field would inform.
 */
export function buildOrderWorkloadSummary(orders = [], { todayStr, soonDays = DEFAULT_SOON_DAYS } = {}) {
  // Callers should always pass the shop's own timezone-correct today (see
  // ai-context.js's shopDateStr(shop?.timezone) call) — this fallback only
  // covers a caller that omits it, and even then stays timezone-aware
  // (shop-time.js's own fallback zone) rather than the server's UTC day.
  const today = todayStr || shopDateStr();
  const open = (orders || []).filter((o) => o && !TERMINAL_STATUSES.has(normalizeOrderStatus(o.status)));

  const overdue = [];
  const dueSoon = [];
  const notDesigned = [];
  const notReady = [];
  const deliveryApproaching = [];
  const missingAssignment = [];

  for (const o of open) {
    const status = normalizeOrderStatus(o.status);
    const hasDeliveryDate = Boolean(o.delivery_date);
    const diff = hasDeliveryDate ? dayDiff(today, String(o.delivery_date).slice(0, 10)) : null;

    if (hasDeliveryDate && diff < 0) overdue.push(orderRef(o));
    else if (hasDeliveryDate && diff >= 0 && diff <= soonDays) dueSoon.push(orderRef(o));

    if (hasDeliveryDate && diff <= soonDays && PRE_DESIGN_STATUSES.has(status)) notDesigned.push(orderRef(o));
    if (hasDeliveryDate && diff <= soonDays && PRE_READY_STATUSES.has(status)) notReady.push(orderRef(o));

    if (o.fulfillment === "DELIVERY" && hasDeliveryDate && diff <= 0 && DELIVERY_STAGED_STATUSES.has(status)) {
      deliveryApproaching.push(orderRef(o));
    }

    // Missing assignment: due soon enough to matter, but nobody's actually
    // been assigned yet — a real designer field for production, a real
    // driver field only once delivery fulfillment makes one relevant.
    if (hasDeliveryDate && diff <= soonDays) {
      const needsDesigner = !String(o.designer || "").trim() && PRE_READY_STATUSES.has(status);
      const needsDriver = o.fulfillment === "DELIVERY" && !String(o.driver || "").trim() && (status === "READY" || status === "OUT_FOR_DELIVERY");
      if (needsDesigner || needsDriver) missingAssignment.push({ ...orderRef(o), needs_designer: needsDesigner, needs_driver: needsDriver });
    }
  }

  const counts = {
    overdue: overdue.length,
    dueSoon: dueSoon.length,
    notDesigned: notDesigned.length,
    notReady: notReady.length,
    deliveryApproaching: deliveryApproaching.length,
    missingAssignment: missingAssignment.length
  };

  return { overdue, dueSoon, notDesigned, notReady, deliveryApproaching, missingAssignment, counts, summaryText: buildWorkloadSummaryText(counts) };
}

/** One honest sentence — no fabricated positivity, no fabricated urgency;
 * every number here traces back to a real, listed order. */
export function buildWorkloadSummaryText(counts = {}) {
  const parts = [];
  if (counts.overdue) parts.push(`${counts.overdue} order${counts.overdue === 1 ? " is" : "s are"} overdue`);
  if (counts.dueSoon) parts.push(`${counts.dueSoon} due in the next few days`);
  if (counts.notDesigned) parts.push(`${counts.notDesigned} not started yet`);
  if (counts.missingAssignment) parts.push(`${counts.missingAssignment} with nobody assigned`);
  if (!parts.length) return "No open orders are behind right now.";
  return `${parts.join(", ")}.`;
}
