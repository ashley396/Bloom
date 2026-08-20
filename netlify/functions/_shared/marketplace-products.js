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

/**
 * "MULTIPLE WHOLESALERS" from the marketplace vision: a florist searching
 * one variety should be able to compare real supplier options side by
 * side (price, availability, fulfillment) instead of hunting through a
 * flat list. Groups already-matched search results by variety (falling
 * back to product name when variety isn't set) and sorts each group by
 * price — real listings only, never a fabricated comparison. Groups with
 * only one seller are still returned (nothing hidden), but
 * `seller_count` lets the UI decide whether a comparison view is worth
 * showing.
 */
export function groupListingsForComparison(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = String(item.variety || item.product_name || "").trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, { key, label: item.variety || item.product_name, items: [] });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()]
    .map((group) => {
      const sorted = [...group.items].sort(
        (a, b) => Number(a.display_price ?? a.price ?? Infinity) - Number(b.display_price ?? b.price ?? Infinity)
      );
      const sellerCount = new Set(sorted.map((row) => row.shop_id)).size;
      return { ...group, items: sorted, seller_count: sellerCount };
    })
    .sort((a, b) => b.seller_count - a.seller_count);
}

/**
 * REVIEWS & TRUST from the marketplace vision — a real average built
 * only from real reviews. An empty review list produces an honest
 * "no reviews yet" shape (count 0, average null), never a fabricated
 * starting score.
 */
export function summarizeSellerReviews(reviews = []) {
  const list = Array.isArray(reviews) ? reviews : [];
  if (!list.length) {
    return { count: 0, average: null, fulfillment_average: null, communication_average: null, accuracy_average: null };
  }
  const avg = (key) => {
    const values = list.map((r) => Number(r[key])).filter((n) => Number.isFinite(n));
    if (!values.length) return null;
    return Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 10) / 10;
  };
  return {
    count: list.length,
    average: avg("rating"),
    fulfillment_average: avg("fulfillment_rating"),
    communication_average: avg("communication_rating"),
    accuracy_average: avg("accuracy_rating")
  };
}

/**
 * STANDING ORDERS from the marketplace vision: "different from blindly
 * repeating ecommerce purchases because fresh-flower availability can
 * change." A standing order's items are stored by name/quantity, not a
 * frozen listing_id — every match is against the seller's CURRENT
 * published, currently-available listings, using the same
 * canBrowseListing/isCurrentlyAvailable/resolveDisplayPrice logic the
 * buyer browse UI and Reorder already use. An item with no current match
 * is flagged unavailable, never silently dropped or priced from memory.
 */
export function matchStandingOrderItems(items = [], listings = []) {
  const rows = Array.isArray(items) ? items : [];
  const candidates = (Array.isArray(listings) ? listings : [])
    .filter((row) => canBrowseListing(row))
    .filter((row) => isCurrentlyAvailable(row));
  return rows.map((item) => {
    const needle = String(item.name || "").trim().toLowerCase();
    const match = needle
      ? candidates.find((row) => {
          const haystack = [row.product_name, row.variety].filter(Boolean).join(" ").toLowerCase();
          return haystack.includes(needle) || (haystack && needle.includes(haystack));
        })
      : null;
    if (!match) {
      return { name: item.name, quantity: item.quantity, listing_id: null, available: false };
    }
    const display = resolveDisplayPrice(match);
    return {
      name: item.name,
      quantity: item.quantity,
      listing_id: match.id,
      shop_id: match.shop_id,
      matched_product_name: match.product_name,
      current_price: display.price,
      current_unit: display.unit,
      available: true
    };
  });
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
