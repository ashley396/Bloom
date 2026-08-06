/** Bloom Floral Library — master catalog architecture (RC1). */

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

/** Starter collection — clearly labeled; expand via import manifest. */
export const STARTER_FLORAL_LIBRARY = [
  mk("lib-hydrangea-blue", "Blue Hydrangea Garden", "Hydrangeas", 89.99, "Blue and white hydrangeas with eucalyptus.", "licensed_stock_pexels", "https://images.pexels.com/photos/931177/pexels-photo-931177.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Blue Hydrangea", 4], ["Eucalyptus", 5]]),
  mk("lib-rose-red", "Classic Red Rose Romance", "Romance", 99.99, "Twelve premium red roses with soft filler.", "licensed_stock_pexels", "https://images.pexels.com/photos/1070850/pexels-photo-1070850.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Red Roses", 12], ["Baby's Breath", 3]]),
  mk("lib-sunflower-bday", "Sunny Birthday Celebration", "Birthday", 79.99, "Sunflowers and seasonal bright blooms.", "licensed_stock_pexels", "https://images.pexels.com/photos/2111192/pexels-photo-2111192.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Sunflowers", 5], ["Yellow Roses", 6]]),
  mk("lib-sympathy-white", "Peaceful White Sympathy", "Sympathy bouquets", 124.99, "White lilies and roses for comfort.", "licensed_stock_pexels", "https://images.pexels.com/photos/169193/pexels-photo-169193.jpeg?auto=compress&cs=tinysrgb&w=1000", [["White Lilies", 5], ["White Roses", 8]]),
  mk("lib-wedding-bridal", "Romantic Bridal Bouquet", "Wedding", 159.99, "Soft roses, hydrangea, and eucalyptus.", "licensed_stock_pexels", "https://images.pexels.com/photos/931168/pexels-photo-931168.jpeg?auto=compress&cs=tinysrgb&w=1000", [["White Roses", 12], ["Hydrangea", 3]]),
  mk("lib-lily-mixed", "Stargazer Lily Garden", "Everyday", 84.99, "Pink lilies with garden greenery.", "bloom_owned", "/assets/floral-library/garden-harmony.jpg", [["Stargazer Lilies", 5], ["Leatherleaf", 4]]),
  mk("lib-carnation-mix", "Carnation Celebration", "Congratulations", 69.99, "Colorful carnations for milestones.", "licensed_stock_pexels", "https://images.pexels.com/photos/462402/pexels-photo-462402.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Carnations", 12], ["Greenery", 5]]),
  mk("lib-snapdragon", "Snapdragon Meadow", "Everyday", 74.99, "Vertical snapdragons with stock.", "licensed_stock_pexels", "https://images.pexels.com/photos/1308881/pexels-photo-1308881.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Snapdragons", 8], ["Stock", 5]]),
  mk("lib-delphinium", "Delphinium Sky", "Everyday", 92.99, "Blue delphinium with white accent blooms.", "licensed_stock_pexels", "https://images.pexels.com/photos/931167/pexels-photo-931167.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Delphinium", 7], ["White Roses", 4]]),
  mk("lib-orchid", "Modern Orchid Gift", "Plants", 84.99, "Phalaenopsis orchid in ceramic pot.", "licensed_stock_pexels", "https://images.pexels.com/photos/459335/pexels-photo-459335.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Orchid Plant", 1], ["Ceramic Pot", 1]]),
  mk("lib-tulip-spring", "Spring Tulip Bowl", "Everyday", 64.99, "Seasonal tulips in soft pastels.", "licensed_stock_pexels", "https://images.pexels.com/photos/931162/pexels-photo-931162.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Tulips", 15], ["Moss", 1]]),
  mk("lib-daisy-cheer", "Daisy Cheer", "Get Well", 59.99, "Cheerful daisies and yellow accents.", "licensed_stock_pexels", "https://images.pexels.com/photos/54200/pexels-photo-54200.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Daisies", 10], ["Solidago", 4]]),
  mk("lib-chrysanthemum", "Autumn Mum Basket", "Sympathy bouquets", 89.99, "Mums with fall greenery.", "licensed_stock_pexels", "https://images.pexels.com/photos/736230/pexels-photo-736230.jpeg?auto=compress&cs=tinysrgb&w=1000", [["Chrysanthemums", 12], ["Leatherleaf", 6]]),
  mk("lib-greenery-bundle", "Designer Greenery Bundle", "Everyday", 34.99, "Eucalyptus, ruscus, and leatherleaf.", "bloom_owned", "/assets/floral-library/garden-harmony.jpg", [["Eucalyptus", 8], ["Italian Ruscus", 6]]),
  mk("lib-luxury-garden", "Luxury Garden Harmony", "Luxury arrangements", 124.99, "Premium mixed garden design.", "bloom_owned", "/assets/floral-library/garden-harmony.jpg", [["Hydrangea", 2], ["Roses", 8], ["Seasonal blooms", 10]])
];

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
    primary_image: { url, alt: `${name} floral arrangement`, hash: simpleHash(url) },
    image_license: {
      source: licenseSource,
      attribution: licenseSource === "licensed_stock_pexels" ? "Pexels — verify license at import" : "Florisyn starter asset",
      review_status: "approved_starter"
    },
    recipe: recipe.map(([n, q]) => ({ name: n, qty: q })),
    publish_status: "published",
    tags: [category.toLowerCase()]
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
