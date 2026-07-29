import type { FloristryPhotoId } from "../../floristry-photo-library";
import { assertUniquePhotoAssignments } from "../../floristry-photo-library";

/** One catalog ID per visible list thumbnail on `/orders`. */
export type OrdersPhotoSlotId =
  | "orders.list.ord-101"
  | "orders.list.ord-102"
  | "orders.list.ord-103"
  | "orders.list.ord-104"
  | "orders.list.ord-105"
  | "orders.list.ord-106"
  | "orders.list.ord-107"
  | "orders.list.ord-108"
  | "orders.list.ord-109"
  | "orders.list.ord-110"
  | "orders.detail.hero";

/**
 * Selected-order hero uses the same catalog ID as the order; only one `PhotoAsset`
 * mounts at a time (detail hero OR list thumb — never both for the same ID).
 */
export const ORDERS_PHOTO_ASSIGNMENTS: Record<
  Exclude<OrdersPhotoSlotId, "orders.detail.hero">,
  FloristryPhotoId
> = {
  "orders.list.ord-101": "sympathy-funeral-spray",
  "orders.list.ord-102": "sympathy-lilies",
  "orders.list.ord-103": "wedding-bridal-bouquet",
  "orders.list.ord-104": "roses-red-bouquet",
  "orders.list.ord-105": "everyday-birthday-pastel",
  "orders.list.ord-106": "centerpiece-table",
  "orders.list.ord-107": "mixed-everyday-bouquet",
  "orders.list.ord-108": "hydrangea-blue",
  "orders.list.ord-109": "seasonal-tulips",
  "orders.list.ord-110": "orchid-elegant",
};

export function getOrdersListPhotoId(
  slot: Exclude<OrdersPhotoSlotId, "orders.detail.hero">,
): FloristryPhotoId {
  return ORDERS_PHOTO_ASSIGNMENTS[slot];
}

export function getOrdersPhotoSlotForOrderId(orderId: string): Exclude<
  OrdersPhotoSlotId,
  "orders.detail.hero"
> | null {
  const key = `orders.list.${orderId}` as Exclude<
    OrdersPhotoSlotId,
    "orders.detail.hero"
  >;
  return key in ORDERS_PHOTO_ASSIGNMENTS ? key : null;
}

export function collectOrdersListPhotoAssignmentEntries(): ReadonlyArray<{
  slot: string;
  photoId: FloristryPhotoId;
}> {
  return Object.entries(ORDERS_PHOTO_ASSIGNMENTS).map(([slot, photoId]) => ({
    slot,
    photoId,
  }));
}

export function validateOrdersPhotoAssignments(pageLabel = "/orders"): void {
  assertUniquePhotoAssignments(collectOrdersListPhotoAssignmentEntries(), pageLabel);
}

validateOrdersPhotoAssignments();
