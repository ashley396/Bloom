/**
 * AI-enhanced POS analytics — sales tracking, inventory signals, realtime KPIs.
 */

export function computeRealtimeKpis({ orders = [], products = [], windowHours = 24 } = {}) {
  const cutoff = Date.now() - windowHours * 3600000;
  const recent = orders.filter((o) => {
    const t = new Date(o.created_at || o.updated_at || 0).getTime();
    return t >= cutoff && !/cancel/i.test(String(o.status || ""));
  });

  const revenue = recent.reduce((s, o) => s + Number(o.total || 0), 0);
  const paid = recent.filter((o) => /paid|complete/i.test(String(o.payment_status || "")));
  const unpaid = recent.length - paid.length;

  const bySource = {};
  for (const o of recent) {
    const src = o.order_source || "POS";
    bySource[src] = (bySource[src] || 0) + 1;
  }

  const lowStock = products.filter((p) => {
    const qty = Number(p.quantity ?? p.stock ?? p.inventory?.on_hand ?? 999);
    return qty <= 5 && p.active !== false;
  });

  return {
    window_hours: windowHours,
    orders_count: recent.length,
    revenue: Math.round(revenue * 100) / 100,
    avg_order_value: recent.length ? Math.round((revenue / recent.length) * 100) / 100 : 0,
    unpaid_orders: unpaid,
    orders_by_source: bySource,
    low_stock_count: lowStock.length,
    generated_at: new Date().toISOString()
  };
}

export function inventoryAlerts(products = [], thresholds = { low: 5, critical: 2 }) {
  const alerts = [];
  for (const p of products) {
    const qty = Number(p.quantity ?? p.stock ?? p.inventory?.on_hand ?? 0);
    const name = p.name || "Product";
    if (qty <= thresholds.critical) {
      alerts.push({ level: "critical", product_id: p.id, name, qty, action: "Reorder immediately or hide from online shop." });
    } else if (qty <= thresholds.low) {
      alerts.push({ level: "low", product_id: p.id, name, qty, action: "Plan restock this week." });
    }
    if (p.available_online && !p.image_url && !p.primary_image?.url) {
      alerts.push({ level: "warning", product_id: p.id, name, action: "Online product missing photo — add via BloomShot." });
    }
  }
  return {
    alerts: alerts.sort((a, b) => (a.level === "critical" ? -1 : 0) - (b.level === "critical" ? -1 : 0)),
    summary: {
      critical: alerts.filter((a) => a.level === "critical").length,
      low: alerts.filter((a) => a.level === "low").length,
      warnings: alerts.filter((a) => a.level === "warning").length
    }
  };
}

export function salesInsights({ orders = [], days = 30 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const list = orders.filter((o) => new Date(o.created_at || 0).getTime() >= cutoff);
  const byDay = {};
  const byCategory = {};

  for (const o of list) {
    const day = (o.created_at || "").slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + Number(o.total || 0);
    const cat = inferCategory(o.arrangement_description || o.notes || "");
    byCategory[cat] = (byCategory[cat] || 0) + Number(o.total || 0);
  }

  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  const peakDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];

  return {
    period_days: days,
    total_orders: list.length,
    total_revenue: Math.round(list.reduce((s, o) => s + Number(o.total || 0), 0) * 100) / 100,
    top_category: topCategory ? { name: topCategory[0], revenue: Math.round(topCategory[1] * 100) / 100 } : null,
    peak_day: peakDay ? { date: peakDay[0], revenue: Math.round(peakDay[1] * 100) / 100 } : null,
    ai_recommendations: buildPosRecommendations(list, byCategory)
  };
}

function inferCategory(text) {
  const t = String(text).toLowerCase();
  if (/sympathy|funeral|spray/i.test(t)) return "Sympathy";
  if (/wedding|bridal/i.test(t)) return "Wedding";
  if (/plant|orchid/i.test(t)) return "Plants";
  if (/rose|romance/i.test(t)) return "Romance";
  if (/birthday/i.test(t)) return "Birthday";
  return "Everyday";
}

function buildPosRecommendations(orders, byCategory) {
  const recs = [];
  if (orders.length < 5) recs.push("Capture more orders in POS to unlock stronger trend insights.");
  const sympathy = byCategory["Sympathy"] || 0;
  const wedding = byCategory["Wedding"] || 0;
  if (sympathy > wedding * 2) recs.push("Sympathy drives revenue — ensure sympathy collection is prominent online.");
  if (wedding > sympathy * 2) recs.push("Wedding season strength — promote consultation booking on your website.");
  const webOrders = orders.filter((o) => /website|web/i.test(String(o.order_source || ""))).length;
  if (webOrders / Math.max(orders.length, 1) < 0.15) recs.push("Online orders are under 15% — run an Instagram campaign from AI Marketing.");
  return recs;
}
