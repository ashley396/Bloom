/**
 * Real, non-fabricated sales/financial signals for Lily's and Rose's chat
 * context (Phase 8, "Sales/Business intelligence — FACT vs RECOMMENDATION
 * separation, never fabricate financial figures", of the Lily Connected
 * Intelligence pass).
 *
 * AUDIT BEFORE BUILDING found the real math already exists and is already
 * shipping: dashboard.js already computes todaySales/totalSales/
 * totalExpenses/profit/unpaidTotal/weeklySales from real payments/orders
 * rows, using the shop's own timezone-correct "today" (shopDateStr()) —
 * exactly like Phase 6's workload buckets. What was missing: none of it
 * ever reached Lily's general chat context. Rose's own persona prompt
 * (florist-ai-personas.js) explicitly warns "Never invent exact dollar
 * figures unless context supports them; use ranges instead" precisely
 * because, until now, the context genuinely never supported any real
 * figure — she had no numbers to cite even for a direct, answerable
 * question like "how much did we make today?"
 *
 * This module does not duplicate dashboard.js's full profit-intelligence
 * math (freshness score, waste risk, margin health — inventory-condition
 * signals dashboard.js already surfaces well, computed from the same
 * unbounded full-table reads dashboard.js accepts once per dashboard
 * load, not worth paying once per chat message). It computes a smaller,
 * honest, cheaply-bounded slice instead — today's sales, the trailing
 * 7-day sales trend, and the real unpaid total — from bounded queries (a
 * ~9-day payments window, and only the open/unpaid orders, never the
 * shop's full order history), the same cost discipline as
 * order-workload-intelligence.js.
 *
 * Nothing here calls a model. Real code/DB math only — the "do not ask an
 * LLM to calculate what SQL/JS can calculate reliably" rule.
 */

import { shopDateStr } from "./shop-time.js";

function localDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function netPayment(p) {
  return Number(p?.amount || 0) - Number(p?.refunded_amount || 0);
}

/** Same UTC-noon-anchored day arithmetic as shop-time.js's
 * shopDateStrDaysAgo(), but parameterized on an explicit `todayStr`
 * instead of recomputing real "now" — keeps this function pure and
 * deterministic for tests, matching order-workload-intelligence.js's
 * own todayStr-driven contract. */
function dateStrDaysBefore(todayStr, daysAgo) {
  const [y, m, d] = String(todayStr).split("-").map(Number);
  const anchor = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  anchor.setUTCDate(anchor.getUTCDate() - Number(daysAgo || 0));
  return anchor.toISOString().slice(0, 10);
}

/**
 * Pure — given real SUCCEEDED payment rows (already scoped to this shop,
 * a bounded recent window is fine — see loadFinancialSnapshot) and the
 * shop's real open/unpaid orders, computes real sales-today, real
 * trailing-7-day sales, and the real unpaid total. Never throws; missing
 * fields just contribute zero.
 */
export function buildFinancialSnapshot(recentPayments = [], unpaidOrders = [], { timezone, todayStr } = {}) {
  const today = todayStr || shopDateStr(timezone);
  const payments = recentPayments || [];

  const todaySales = payments.filter((p) => localDate(p?.received_at) === today).reduce((sum, p) => sum + netPayment(p), 0);

  let weekSales = 0;
  for (let n = 6; n >= 0; n--) {
    const dayStr = dateStrDaysBefore(today, n);
    weekSales += payments.filter((p) => localDate(p?.received_at) === dayStr).reduce((sum, p) => sum + netPayment(p), 0);
  }

  const unpaidTotal = (unpaidOrders || []).reduce((sum, o) => sum + Math.max(0, Number(o?.total || 0) - Number(o?.amount_paid || 0)), 0);

  return {
    asOfDate: today,
    todaySales: Math.round(todaySales * 100) / 100,
    weekSales: Math.round(weekSales * 100) / 100,
    unpaidTotal: Math.round(unpaidTotal * 100) / 100
  };
}

const UNAVAILABLE = { todaySales: null, weekSales: null, unpaidTotal: null, available: false };

/**
 * The query half only — timezone-agnostic (the cutoff is a fixed 9-real-
 * day UTC window; only the later bucketing in buildFinancialSnapshot needs
 * the shop's real timezone). Split out so a caller that already knows it
 * will fetch `shops.timezone` in the same parallel batch (ai-context.js)
 * can run this query concurrently with that fetch instead of waiting on
 * it first, then do the timezone-aware bucketing once both land.
 */
export async function loadFinancialRows(client, shopId) {
  // A 9-real-day window safely covers the trailing 7 SHOP-LOCAL days
  // (buildFinancialSnapshot buckets by shop-local date string) regardless
  // of which side of UTC midnight the shop's timezone falls on.
  const cutoffIso = new Date(Date.now() - 9 * 86400000).toISOString();
  const [{ data: recentPayments, error: pErr }, { data: unpaidOrders, error: oErr }] = await Promise.all([
    client.from("payments").select("amount,received_at,refunded_amount").eq("shop_id", shopId).eq("status", "SUCCEEDED").gte("received_at", cutoffIso),
    client.from("orders").select("total,amount_paid").eq("shop_id", shopId).neq("payment_status", "PAID").neq("status", "CANCELLED")
  ]);
  if (pErr || oErr) return { recentPayments: null, unpaidOrders: null, error: pErr || oErr };
  return { recentPayments: recentPayments || [], unpaidOrders: unpaidOrders || [], error: null };
}

/**
 * Loads the bounded real rows above and returns buildFinancialSnapshot()'s
 * result plus `available: true` — or, on a real query error, an honestly
 * unavailable result (never a guessed or zeroed-out figure standing in
 * for a real one) so the rest of Lily's context still returns normally.
 */
export async function loadFinancialSnapshot(client, shopId, { timezone, todayStr } = {}) {
  const { recentPayments, unpaidOrders, error } = await loadFinancialRows(client, shopId);
  if (error) return { ...UNAVAILABLE, asOfDate: todayStr || shopDateStr(timezone) };

  return { ...buildFinancialSnapshot(recentPayments, unpaidOrders, { timezone, todayStr }), available: true };
}
