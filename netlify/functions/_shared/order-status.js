/**
 * Florist order status vocabulary — maps legacy DB values to display labels.
 */

export const ORDER_STATUSES = [
  { value: "PENDING", label: "Pending", legacy: ["NEW", "PENDING"] },
  { value: "CONFIRMED", label: "Confirmed", legacy: ["CONFIRMED"] },
  { value: "DESIGNING", label: "Designing", legacy: ["DESIGNING"] },
  { value: "READY", label: "Ready", legacy: ["READY"] },
  { value: "PICKUP_READY", label: "Pickup Ready", legacy: ["PICKUP_READY"] },
  { value: "OUT_FOR_DELIVERY", label: "Out for Delivery", legacy: ["OUT_FOR_DELIVERY"] },
  { value: "DELIVERED", label: "Delivered", legacy: ["DELIVERED"] },
  { value: "COMPLETED", label: "Completed", legacy: ["COMPLETED"] },
  { value: "ON_HOLD", label: "On Hold", legacy: ["ON_HOLD"] },
  { value: "ISSUE", label: "Issue", legacy: ["ISSUE"] },
  { value: "CANCELLED", label: "Cancelled", legacy: ["CANCELLED"] },
];

export function normalizeOrderStatus(value) {
  const raw = String(value || "PENDING").toUpperCase();
  if (raw === "NEW") return "PENDING";
  const match = ORDER_STATUSES.find((s) => s.legacy.includes(raw) || s.value === raw);
  return match?.value || raw;
}

export function orderStatusLabel(value) {
  const norm = normalizeOrderStatus(value);
  return ORDER_STATUSES.find((s) => s.value === norm)?.label || norm;
}

export async function recordOrderStatusChange(
  client,
  { shopId, orderId, fromStatus, toStatus, userId, note = null },
) {
  if (!shopId || !orderId || !toStatus) return;
  const from = fromStatus ? normalizeOrderStatus(fromStatus) : null;
  const to = normalizeOrderStatus(toStatus);
  if (from === to) return;
  try {
    await client.from("order_status_history").insert({
      shop_id: shopId,
      order_id: orderId,
      from_status: from,
      to_status: to,
      changed_by: userId || null,
      note: note || null,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "order_status_history insert skipped",
        reason: String(error.message || error).slice(0, 200),
      }),
    );
  }
}
