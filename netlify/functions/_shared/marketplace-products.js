/** Product publish workflow and variant helpers for Bloom Wholesale 1.0. */

export const PUBLISH_STATUSES = ["draft", "preview", "published"];

export function normalizePublishStatus(value, fallback = "draft") {
  const status = String(value || fallback).toLowerCase();
  return PUBLISH_STATUSES.includes(status) ? status : fallback;
}

export function canBrowseListing(listing, { previewAllowed = false } = {}) {
  if (!listing || listing.archived_at) return false;
  if (listing.active === false) return false;
  const status = normalizePublishStatus(listing.publish_status, "published");
  if (status === "published") return true;
  if (status === "preview" && previewAllowed) return true;
  return false;
}

export function nextPublishTransition(current, action) {
  const status = normalizePublishStatus(current);
  switch (action) {
    case "to_preview":
      return status === "draft" || status === "preview" ? "preview" : status;
    case "to_draft":
      return "draft";
    case "publish":
      return "published";
    case "unpublish":
      return "draft";
    default:
      return status;
  }
}

export function validateProductVariants(variants = []) {
  if (!Array.isArray(variants)) {
    return { valid: false, errors: ["Variants must be an array."] };
  }
  const errors = [];
  const skus = new Set();
  variants.forEach((variant, index) => {
    const label = `Variant ${index + 1}`;
    if (!String(variant?.name || "").trim()) {
      errors.push(`${label}: name is required.`);
    }
    const price = Number(variant?.price);
    if (Number.isNaN(price) || price < 0) {
      errors.push(`${label}: price must be zero or greater.`);
    }
    const sku = String(variant?.sku || "").trim();
    if (sku) {
      if (skus.has(sku)) errors.push(`${label}: duplicate SKU ${sku}.`);
      skus.add(sku);
    }
  });
  return { valid: errors.length === 0, errors };
}

export function validateProductImages(images = []) {
  if (!Array.isArray(images)) {
    return { valid: false, errors: ["Images must be an array."] };
  }
  const errors = [];
  images.forEach((image, index) => {
    const url = String(image?.url || image || "").trim();
    if (!url) errors.push(`Image ${index + 1}: URL is required.`);
    else if (!/^https?:\/\//i.test(url)) errors.push(`Image ${index + 1}: must be an http(s) URL.`);
  });
  return { valid: errors.length === 0, errors };
}

export function computeListingInventory(listing, variants = []) {
  if (variants.length) {
    return variants.reduce((sum, row) => sum + Number(row.available_quantity || 0), 0);
  }
  return Number(listing?.available_quantity || 0);
}

export function isLowStock(listing, variants = []) {
  const threshold = Number(listing?.low_stock_threshold ?? 5);
  if (variants.length) {
    return variants.some((row) => Number(row.available_quantity ?? 0) <= Number(row.low_stock_threshold ?? threshold));
  }
  return Number(listing?.available_quantity ?? 0) <= threshold;
}

export function buildSellerKpis({ products = [], orders = [], variantsByListing = {} }) {
  const published = products.filter((p) => normalizePublishStatus(p.publish_status, "published") === "published" && p.active && !p.archived_at);
  const drafts = products.filter((p) => normalizePublishStatus(p.publish_status, "draft") === "draft" && !p.archived_at);
  const previews = products.filter((p) => normalizePublishStatus(p.publish_status) === "preview" && !p.archived_at);
  let lowStockCount = 0;
  products.forEach((product) => {
    if (product.archived_at) return;
    const variants = variantsByListing[product.id] || [];
    if (isLowStock(product, variants)) lowStockCount += 1;
  });
  const paidOrders = orders.filter((o) => ["paid", "fulfilled", "completed"].includes(String(o.status || "").toLowerCase()));
  const revenue = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pendingOrders = orders.filter((o) => ["pending", "processing", "submitted"].includes(String(o.status || "").toLowerCase()));
  return {
    product_count: products.filter((p) => !p.archived_at).length,
    published_count: published.length,
    draft_count: drafts.length,
    preview_count: previews.length,
    low_stock_count: lowStockCount,
    order_count: orders.length,
    pending_order_count: pendingOrders.length,
    revenue_total: revenue
  };
}
