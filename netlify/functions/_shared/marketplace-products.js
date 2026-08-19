/** Product publish workflow and variant helpers for Bloom Wholesale 1.0. */

export const PUBLISH_STATUSES = ["draft", "preview", "published"];

/**
 * Florisyn Wholesale Marketplace: floral-specific product data model.
 *
 * Fresh flowers are not permanently-available inventory sold at one flat
 * price — a listing may be sold per stem, per bunch, per box, or per case,
 * and its availability is genuinely time-bound (seasonal, preorder,
 * limited). These helpers are the single source of truth for that
 * vocabulary so the seller form, buyer search, and any future Lily/recipe
 * integration all agree on the same states instead of drifting.
 */
export const AVAILABILITY_STATUSES = [
  "available_now",
  "scheduled",
  "seasonal",
  "preorder",
  "limited",
  "sold_out"
];

export const AVAILABILITY_STATUS_LABELS = {
  available_now: "Available now",
  scheduled: "Available on a date",
  seasonal: "Seasonal",
  preorder: "Preorder",
  limited: "Limited quantity",
  sold_out: "Sold out"
};

export function normalizeAvailabilityStatus(value, fallback = "available_now") {
  const status = String(value || fallback).toLowerCase();
  return AVAILABILITY_STATUSES.includes(status) ? status : fallback;
}

export function availabilityStatusLabel(value) {
  return AVAILABILITY_STATUS_LABELS[normalizeAvailabilityStatus(value)] || "Available now";
}

/** Pack-size price ladder, most-specific unit first, in the order a florist actually buys. */
const PRICE_UNIT_LADDER = [
  { field: "price_per_stem", unit: "stem" },
  { field: "price_per_bunch", unit: "bunch" },
  { field: "price_per_box", unit: "box" },
  { field: "price_per_case", unit: "case" }
];

function isPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/**
 * A wholesale flower listing can carry several simultaneous per-unit
 * prices (per stem AND per bunch AND per case). Buyers need one clear
 * headline price/unit pair to display; every set price stays available
 * underneath for the detail view. Falls back to the generic price/unit
 * columns when no floral-specific price is set, so existing listings
 * created before this data model keep displaying exactly as before.
 */
export function resolveDisplayPrice(listing = {}) {
  for (const { field, unit } of PRICE_UNIT_LADDER) {
    if (isPositiveNumber(listing[field])) {
      return { price: Number(listing[field]), unit, source: field };
    }
  }
  return { price: listing.price ?? null, unit: listing.unit || "each", source: "price" };
}

/** Every per-unit price actually set on the listing, for the full spec sheet. */
export function allUnitPrices(listing = {}) {
  return PRICE_UNIT_LADDER.filter(({ field }) => isPositiveNumber(listing[field])).map(({ field, unit }) => ({
    unit,
    price: Number(listing[field])
  }));
}

/** 1-12 calendar months; invalid/out-of-range entries are dropped rather than silently kept. */
export function normalizeSeasonalMonths(value) {
  const list = Array.isArray(value) ? value : [];
  const months = list
    .map((m) => Number(m))
    .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  return [...new Set(months)].sort((a, b) => a - b);
}

/**
 * True only when the listing's own dates say it's buyable right now.
 * A "seasonal"/"scheduled" listing with no dates set is never assumed
 * available — that would be inventing availability the seller didn't
 * actually state.
 */
export function isCurrentlyAvailable(listing = {}, now = new Date()) {
  const status = normalizeAvailabilityStatus(listing.availability_status);
  if (status === "sold_out") return false;
  if (status === "available_now" || status === "limited") return true;
  const today = now instanceof Date ? now : new Date(now);
  if (listing.available_from && today < new Date(listing.available_from)) return false;
  if (listing.available_until && today > new Date(listing.available_until)) return false;
  if (status === "seasonal") {
    const months = normalizeSeasonalMonths(listing.seasonal_months);
    if (months.length && !months.includes(today.getMonth() + 1)) return false;
  }
  if (status === "preorder" || status === "scheduled") {
    // Preorder/scheduled listings are real and browsable, just not
    // shippable today — availability_status itself communicates that,
    // there's nothing further to derive here.
    return true;
  }
  return true;
}

export function validateFloralAttributes(attrs = {}) {
  const errors = [];
  if (attrs.stem_length_in != null && attrs.stem_length_in !== "" && !(Number(attrs.stem_length_in) > 0)) {
    errors.push("Stem length must be a positive number.");
  }
  for (const field of ["stems_per_bunch", "bunches_per_box", "case_quantity", "lead_time_days"]) {
    if (attrs[field] != null && attrs[field] !== "" && !(Number(attrs[field]) > 0)) {
      errors.push(`${field.replace(/_/g, " ")} must be a positive number.`);
    }
  }
  for (const { field } of PRICE_UNIT_LADDER) {
    if (attrs[field] != null && attrs[field] !== "" && Number(attrs[field]) < 0) {
      errors.push(`${field.replace(/_/g, " ")} cannot be negative.`);
    }
  }
  if (attrs.availability_status && !AVAILABILITY_STATUSES.includes(String(attrs.availability_status).toLowerCase())) {
    errors.push(`availability_status must be one of: ${AVAILABILITY_STATUSES.join(", ")}.`);
  }
  if (
    attrs.available_from
    && attrs.available_until
    && new Date(attrs.available_until) < new Date(attrs.available_from)
  ) {
    errors.push("Available-until date cannot be before available-from date.");
  }
  return { valid: errors.length === 0, errors };
}

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
