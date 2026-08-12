/** Bloom Floral Library — master catalog architecture (RC1). */

import { getEverydayFloralLibraryCatalog, EVERYDAY_FLORAL_ARRANGEMENTS } from "./floral-library-everyday-50.js";
import { isPublicVaseArrangement } from "../../../lib/floral-library/csv-standard.js";

export { EVERYDAY_FLORAL_ARRANGEMENTS, getEverydayFloralLibraryCatalog };

export const LIBRARY_CATEGORIES = [
  "Everyday",
  "Birthday",
  "Anniversary",
  "Romance",
  "Thank You",
  "Get Well",
  "New Baby",
  "Congratulations",
  "Sympathy bouquets",
  "Funeral",
  "Wedding",
  "Plants",
  "Hydrangeas",
  "Luxury arrangements",
  "Valentine's Day",
  "Mother's Day",
  "Christmas"
];

export const IMAGE_LICENSE_SOURCES = ["bloom_owned", "licensed_stock_pexels", "shop_upload", "generated_tracked", "supplier_approved"];

export function validateLibraryProduct(p = {}) {
  const errors = [];
  if (!p.id) errors.push("Missing product id.");
  if (!p.name) errors.push("Missing name.");
  if (!p.primary_image?.url) errors.push("Missing primary image.");
  const license = p.image_license || {};
  if (!license.source) errors.push("Missing image license source.");
  if (license.source && !IMAGE_LICENSE_SOURCES.includes(license.source)) errors.push("Invalid license source.");
  if (license.source === "licensed_stock_pexels" && !license.attribution) {
    errors.push("Stock images require attribution.");
  }
  return { valid: errors.length === 0, errors };
}

export function detectDuplicateImageHash(products, hash) {
  if (!hash) return [];
  return products.filter((p) => p.primary_image?.hash === hash).map((p) => p.id);
}

export function copyLibraryItemToShop(master, { shopId, overrides = {} } = {}) {
  if (!master?.id) throw new Error("Master library item required.");
  const copyId = `shop-${shopId}-${master.id}-${Date.now()}`;
  return {
    id: copyId,
    shop_id: shopId,
    master_library_id: master.id,
    name: overrides.name ?? master.name,
    description: overrides.description ?? master.description,
    short_description: overrides.short_description ?? master.short_description,
    primary_image: structuredClone(master.primary_image),
    images: structuredClone(master.images || []),
    recipe: structuredClone(master.recipe || []),
    categories: [...(master.categories || [])],
    retail_price: overrides.retail_price ?? master.suggested_retail?.default ?? null,
    cost: overrides.cost ?? master.suggested_cost ?? null,
    publish_status: overrides.publish_status ?? "draft",
    sync: {
      available_online: overrides.available_online ?? true,
      available_pos: overrides.available_pos ?? true,
      featured: false,
      seasonal: false,
      pickup_eligible: true,
      delivery_eligible: true,
      allow_substitutions: true,
      show_price_online: true,
      out_of_stock_behavior: "hide"
    },
    metadata: { copied_from_master: master.id, copied_at: new Date().toISOString() }
  };
}

export function assertMasterLibraryImmutable(editTarget) {
  if (editTarget?.scope === "master") {
    return { allowed: false, error: "Master library records are read-only for shop users." };
  }
  return { allowed: true };
}

export function applyProductSyncToggle(product, key, value) {
  const sync = { ...(product.sync || {}), [key]: value };
  return { ...product, sync };
}

export function productVisibleOnPublicSite(product, { publishedOnly = true } = {}) {
  if (!product?.sync?.available_online) return false;
  if (publishedOnly && product.publish_status !== "published") return false;
  if (product.sync?.out_of_stock_behavior === "hide" && product.inventory?.available === 0) return false;
  return true;
}

const ULTRA_REALISTIC_IMAGE_STANDARD = "ultra_realistic_professional_floral_photography";

/** @deprecated Legacy signature set — replaced by Everyday batch 1 (50). */
export function getFlorisynSignatureCatalog() {
  return getEverydayFloralLibraryCatalog();
}

/** Public starter catalog — verified everyday vase arrangements only. */
export function getPublicFloralLibraryCatalog() {
  return getEverydayFloralLibraryCatalog().filter(isPublicVaseArrangement);
}

/** @deprecated Legacy starters removed from public catalog — admin import only. */
export const STARTER_FLORAL_LIBRARY = [];

function mk(id, name, category, price, description, licenseSource, url, recipe) {
  return {
    id,
    scope: "master",
    name,
    categories: [category],
    arrangement_type: "bouquet",
    suggested_retail: { default: price, min: price * 0.9, max: price * 1.2 },
    suggested_cost: Math.round(price * 0.42 * 100) / 100,
    description,
    short_description: description.slice(0, 120),
    primary_image: { url, alt: `${name} ultra-realistic floral arrangement photograph`, hash: simpleHash(url) },
    image_license: {
      source: licenseSource,
      attribution: licenseSource === "licensed_stock_pexels" ? "Pexels — verify license at import" : "Florisyn starter asset",
      review_status: "approved_starter"
    },
    recipe: recipe.map(([n, q]) => ({ name: n, qty: q })),
    publish_status: "published",
    tags: [category.toLowerCase(), "ultra_realistic"],
    metadata: {
      image_standard: ULTRA_REALISTIC_IMAGE_STANDARD,
      launch_quality: "starter_verified",
      replaceable_by_shop: true
    }
  };
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
  return `h${h.toString(16)}`;
}

export function libraryImportManifestRow(row) {
  const product = {
    id: row.product_id || row.id,
    name: row.product_name || row.name,
    primary_image: { url: row.image_url, alt: row.alt_text || row.product_name },
    image_license: { source: row.license_source, attribution: row.attribution, review_status: row.review_status || "pending" }
  };
  return validateLibraryProduct(product);
}
