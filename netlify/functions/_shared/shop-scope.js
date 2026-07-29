/** Tenant isolation helpers for shop-scoped mutations (Phase 2A A2). */

export function requireRowShopId(row, shopId, label = "Record") {
  if (!row) return;
  const rowShop = row.shop_id != null ? String(row.shop_id) : "";
  if (rowShop && String(shopId) !== rowShop) {
    const error = new Error(`${label} does not belong to this shop.`);
    error.statusCode = 403;
    throw error;
  }
}
