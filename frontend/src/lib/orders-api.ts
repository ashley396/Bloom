import type { FloristOrder, OrderFilterChip } from "./orders-sample";
import { getOrdersListPhotoId, getOrdersPhotoSlotForOrderId } from "./floral-asset-library";
import { toPreviewStatus } from "./order-status";

const FALLBACK_SLOTS = [
  "orders.list.ord-101",
  "orders.list.ord-102",
  "orders.list.ord-103",
  "orders.list.ord-104",
  "orders.list.ord-105",
  "orders.list.ord-106",
  "orders.list.ord-107",
  "orders.list.ord-108",
  "orders.list.ord-109",
  "orders.list.ord-110",
] as const;

export type ProductionOrderRow = {
  id: string;
  order_number?: string;
  customer_name?: string;
  customer_phone?: string;
  recipient_name?: string;
  occasion?: string;
  delivery_date?: string;
  delivery_window?: string;
  total?: number;
  status?: string;
  designer?: string;
  driver?: string;
  arrangement_description?: string;
  card_message?: string;
  delivery_address?: string;
  notes?: string;
  payment_status?: string;
};

export function mapProductionOrder(row: ProductionOrderRow, index: number): FloristOrder {
  const occasion = row.occasion || "Floral order";
  const tags: OrderFilterChip[] = [];
  if (/funeral|sympathy/i.test(occasion)) tags.push("funeral");
  if (/wedding/i.test(occasion)) tags.push("wedding");
  if (/birthday/i.test(occasion)) tags.push("birthday");
  if (/anniversary/i.test(occasion)) tags.push("anniversary");
  if (/hospital|get well/i.test(occasion)) tags.push("hospital");

  const status = toPreviewStatus(row.status);
  if (status === "pending") tags.push("pending");
  if (status === "delivered") tags.push("delivered");

  const photoSlot =
    getOrdersPhotoSlotForOrderId(row.id) ?? FALLBACK_SLOTS[index % FALLBACK_SLOTS.length];

  return {
    id: row.id,
    orderNumber: row.order_number || row.id.slice(0, 8),
    customer: row.customer_name || "Customer",
    customerPhone: row.customer_phone || "",
    recipient: row.recipient_name || "",
    occasion,
    occasionTags: tags,
    deliveryDate: row.delivery_date || "",
    deliveryTime: row.delivery_window || "",
    price: `$${Number(row.total || 0).toFixed(2)}`,
    status,
    designer: row.designer || "—",
    driver: row.driver || "—",
    photoId: getOrdersListPhotoId(photoSlot),
    photoSlot,
    recipeName: row.arrangement_description || "Custom arrangement",
    stems: [],
    ribbonColor: "—",
    cardMessage: row.card_message || "",
    deliveryAddress: row.delivery_address || "",
    customerNotes: row.notes || "",
    paymentStatus:
      row.payment_status === "PAID"
        ? "paid"
        : row.payment_status === "PARTIAL"
          ? "deposit"
          : "unpaid",
    designerNotes: row.notes || "",
    checklist: [],
    routeSummary: row.delivery_address || "—",
    eta: row.delivery_window || "—",
    deliveryNotes: row.notes || "",
    deliveryProof: {},
  };
}

export async function fetchProductionOrders(
  accessToken: string,
  apiBase = "/.netlify/functions",
): Promise<FloristOrder[]> {
  const response = await fetch(`${apiBase}/orders`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Orders API failed (${response.status})`);
  }
  const payload = (await response.json()) as { items?: ProductionOrderRow[] };
  return (payload.items || []).map(mapProductionOrder);
}

export async function fetchReactOrdersPreviewEnabled(
  apiBase = "/.netlify/functions",
): Promise<boolean> {
  const response = await fetch(`${apiBase}/production-health`);
  if (!response.ok) return false;
  const payload = (await response.json()) as { feature_flags?: { REACT_ORDERS_PREVIEW?: boolean } };
  return Boolean(payload.feature_flags?.REACT_ORDERS_PREVIEW);
}
