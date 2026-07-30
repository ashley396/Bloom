/** Mirrors production order status normalization (`_shared/order-status.js`). */

export type NormalizedOrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "DESIGNING"
  | "READY"
  | "PICKUP_READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "COMPLETED"
  | "ON_HOLD"
  | "ISSUE"
  | "CANCELLED";

export type PreviewOrderStatus =
  | "pending"
  | "designing"
  | "ready"
  | "out-for-delivery"
  | "delivered"
  | "cancelled";

const STATUS_MAP: Record<NormalizedOrderStatus, PreviewOrderStatus> = {
  PENDING: "pending",
  CONFIRMED: "pending",
  DESIGNING: "designing",
  READY: "ready",
  PICKUP_READY: "ready",
  OUT_FOR_DELIVERY: "out-for-delivery",
  DELIVERED: "delivered",
  COMPLETED: "delivered",
  ON_HOLD: "pending",
  ISSUE: "pending",
  CANCELLED: "cancelled",
};

export function normalizeOrderStatus(value: string | null | undefined): NormalizedOrderStatus {
  const raw = String(value || "PENDING").toUpperCase();
  if (raw === "NEW") return "PENDING";
  return (raw as NormalizedOrderStatus) || "PENDING";
}

export function orderStatusLabel(value: string | null | undefined): string {
  const norm = normalizeOrderStatus(value);
  const labels: Record<NormalizedOrderStatus, string> = {
    PENDING: "Pending",
    CONFIRMED: "Confirmed",
    DESIGNING: "Designing",
    READY: "Ready",
    PICKUP_READY: "Pickup Ready",
    OUT_FOR_DELIVERY: "Out for Delivery",
    DELIVERED: "Delivered",
    COMPLETED: "Completed",
    ON_HOLD: "On Hold",
    ISSUE: "Issue",
    CANCELLED: "Cancelled",
  };
  return labels[norm] || norm;
}

export function toPreviewStatus(value: string | null | undefined): PreviewOrderStatus {
  const norm = normalizeOrderStatus(value);
  return STATUS_MAP[norm] || "pending";
}
