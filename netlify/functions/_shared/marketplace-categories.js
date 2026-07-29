/** Buyer-facing marketplace categories with legacy alias normalization. */

export const MARKETPLACE_CATEGORIES = [
  { slug: "fresh-flowers", label: "Fresh Flowers" },
  { slug: "artificial-florals", label: "Artificial Florals" },
  { slug: "greenery", label: "Greenery" },
  { slug: "floral-supplies", label: "Floral Supplies" },
  { slug: "ribbon", label: "Ribbon" },
  { slug: "vases-containers", label: "Vases & Containers" },
  { slug: "plants-garden", label: "Plants & Garden" },
  { slug: "balloons", label: "Balloons" },
  { slug: "gifts", label: "Gifts" },
  { slug: "candles", label: "Candles" },
  { slug: "chocolates-gourmet", label: "Chocolates & Gourmet" },
  { slug: "plush", label: "Plush" },
  { slug: "sympathy-gifts", label: "Sympathy Gifts" },
  { slug: "boutique-apparel", label: "Boutique & Apparel" },
  { slug: "jewelry-accessories", label: "Jewelry & Accessories" },
  { slug: "home-decor", label: "Home Décor" },
  { slug: "wedding-event", label: "Wedding & Event" },
  { slug: "holiday-seasonal", label: "Holiday & Seasonal" },
  { slug: "printing-packaging", label: "Printing & Packaging" },
  { slug: "delivery-business-supplies", label: "Delivery & Business Supplies" }
];

const LABEL_BY_SLUG = new Map(MARKETPLACE_CATEGORIES.map((c) => [c.slug, c.label]));
const SLUG_BY_LABEL = new Map(
  MARKETPLACE_CATEGORIES.map((c) => [c.label.toLowerCase(), c.slug])
);

const LEGACY_CATEGORY_ALIASES = {
  flowers: "fresh-flowers",
  "fresh flowers": "fresh-flowers",
  "artificial flowers": "artificial-florals",
  supplies: "floral-supplies",
  "floral supply": "floral-supplies",
  vases: "vases-containers",
  containers: "vases-containers",
  plants: "plants-garden",
  gourmet: "chocolates-gourmet",
  food: "chocolates-gourmet",
  apparel: "boutique-apparel",
  clothing: "boutique-apparel",
  wedding: "wedding-event",
  event: "wedding-event",
  packaging: "printing-packaging",
  delivery: "delivery-business-supplies"
};

export function normalizeMarketplaceCategory(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return { slug: "fresh-flowers", label: "Fresh Flowers", legacy: false };
  }
  const lower = raw.toLowerCase();
  if (LABEL_BY_SLUG.has(raw)) {
    return { slug: raw, label: LABEL_BY_SLUG.get(raw), legacy: false };
  }
  if (SLUG_BY_LABEL.has(lower)) {
    const slug = SLUG_BY_LABEL.get(lower);
    return { slug, label: LABEL_BY_SLUG.get(slug), legacy: false };
  }
  if (LEGACY_CATEGORY_ALIASES[lower]) {
    const slug = LEGACY_CATEGORY_ALIASES[lower];
    return { slug, label: LABEL_BY_SLUG.get(slug), labelRaw: raw, legacy: true };
  }
  return { slug: null, label: raw, legacy: true };
}

export function marketplaceCategoryLabels() {
  return MARKETPLACE_CATEGORIES.map((c) => c.label);
}
