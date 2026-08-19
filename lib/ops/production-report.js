/** Designer / production throughput report (pure). */

export function buildProductionReport(orders = [], { days = 7 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const recent = orders.filter((o) => {
    const ts = Date.parse(o.updated_at || o.created_at || "");
    return !Number.isNaN(ts) && ts >= cutoff;
  });

  const byDesigner = new Map();
  const byStatus = new Map();

  for (const order of recent) {
    const designer = String(order.designer || "Unassigned").trim() || "Unassigned";
    const status = String(order.status || "PENDING").toUpperCase();
    byDesigner.set(designer, (byDesigner.get(designer) || 0) + 1);
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }

  const designers = [...byDesigner.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const statuses = [...byStatus.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const fulfilled = recent.filter((o) =>
    ["DELIVERED", "COMPLETED", "READY", "OUT_FOR_DELIVERY"].includes(
      String(o.status || "").toUpperCase()
    )
  ).length;

  return {
    days,
    order_count: recent.length,
    fulfilled_count: fulfilled,
    throughput_rate: recent.length ? Math.round((fulfilled / recent.length) * 100) : 0,
    designers,
    statuses,
  };
}
