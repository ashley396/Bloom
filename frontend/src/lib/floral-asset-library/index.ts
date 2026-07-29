/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FLORISYN FLORAL ASSET LIBRARY — PERMANENT FRAMEWORK (FROZEN)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * All Florisyn UI photography flows through this module. Do not redesign this
 * architecture; extend it by adding catalog IDs and per-page assignment maps.
 *
 * Rules (non-negotiable):
 * 1. Consume assets only via `FloralAssetId` + `resolveFloralAssetSrc()` or `PhotoAsset photoId`.
 * 2. Never hardcode public asset URL paths in pages, components, or sample data.
 * 3. Never repeat the same catalog ID on one page render (use `PagePhotoRegistry`).
 * 4. Never use fallback chains that duplicate another card’s image (`PhotoAsset` → empty state).
 * 5. New pages: add `floral-asset-library/pages/<route>.ts` assignment maps + wrap with `PagePhotoRegistry`.
 *
 * Visual polish and new screens must inherit this library — never bypass it.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export {
  type FloristryPhotoCategory as FloralAssetCategory,
  type FloristryPhotoId as FloralAssetId,
  type FloristryPhotoRecord as FloralAssetRecord,
  FLORISTRY_PHOTO_LIBRARY as FLORAL_ASSET_CATALOG,
  getFloristryPhotoRecord as getFloralAssetRecord,
  getFloristryPhotoSrc as resolveFloralAssetSrc,
  assertUniquePhotoAssignments as assertUniquePagePhotoAssignments,
} from "../floristry-photo-library";

export {
  type TodayPhotoSlotId,
  TODAY_PHOTO_ASSIGNMENTS,
  collectTodayPhotoAssignmentEntries,
  getTodayPhotoId,
  validateTodayPhotoAssignments,
} from "./pages/today";

export {
  type OrdersPhotoSlotId,
  ORDERS_PHOTO_ASSIGNMENTS,
  collectOrdersListPhotoAssignmentEntries,
  getOrdersListPhotoId,
  getOrdersPhotoSlotForOrderId,
  validateOrdersPhotoAssignments,
} from "./pages/orders";

/** Single-image shop surfaces only — not for multi-card pages. */
export const FLORAL_ASSET_SHOP_DEFAULT_ID = "workspace-luxury-shop" as const;

export {
  PagePhotoRegistry,
  usePagePhotoRegistry,
} from "../../components/media/page-photo-registry";

export { PhotoAsset, type PhotoAssetProps } from "../../components/media/PhotoAsset";

export { DEFAULT_SHOP_PHOTO } from "../../components/media/PhotoAsset";
