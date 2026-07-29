(function (root, factory) {
  const api = factory();
  root.BloomMarketplaceCategories = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MARKETPLACE_CATEGORIES = [
    { slug: 'fresh-flowers', label: 'Fresh Flowers' },
    { slug: 'artificial-florals', label: 'Artificial Florals' },
    { slug: 'greenery', label: 'Greenery' },
    { slug: 'floral-supplies', label: 'Floral Supplies' },
    { slug: 'ribbon', label: 'Ribbon' },
    { slug: 'vases-containers', label: 'Vases & Containers' },
    { slug: 'plants-garden', label: 'Plants & Garden' },
    { slug: 'balloons', label: 'Balloons' },
    { slug: 'gifts', label: 'Gifts' },
    { slug: 'candles', label: 'Candles' },
    { slug: 'chocolates-gourmet', label: 'Chocolates & Gourmet' },
    { slug: 'plush', label: 'Plush' },
    { slug: 'sympathy-gifts', label: 'Sympathy Gifts' },
    { slug: 'boutique-apparel', label: 'Boutique & Apparel' },
    { slug: 'jewelry-accessories', label: 'Jewelry & Accessories' },
    { slug: 'home-decor', label: 'Home Décor' },
    { slug: 'wedding-event', label: 'Wedding & Event' },
    { slug: 'holiday-seasonal', label: 'Holiday & Seasonal' },
    { slug: 'printing-packaging', label: 'Printing & Packaging' },
    { slug: 'delivery-business-supplies', label: 'Delivery & Business Supplies' }
  ];

  const labelBySlug = new Map(MARKETPLACE_CATEGORIES.map((c) => [c.slug, c.label]));
  const slugByLabel = new Map(MARKETPLACE_CATEGORIES.map((c) => [c.label.toLowerCase(), c.slug]));
  const legacy = {
    flowers: 'fresh-flowers',
    'fresh flowers': 'fresh-flowers',
    supplies: 'floral-supplies',
    vases: 'vases-containers',
    plants: 'plants-garden',
    wedding: 'wedding-event'
  };

  function normalizeMarketplaceCategory(value) {
    const raw = String(value || '').trim();
    if (!raw) return { slug: 'fresh-flowers', label: 'Fresh Flowers', legacy: false };
    const lower = raw.toLowerCase();
    if (labelBySlug.has(raw)) return { slug: raw, label: labelBySlug.get(raw), legacy: false };
    if (slugByLabel.has(lower)) {
      const slug = slugByLabel.get(lower);
      return { slug, label: labelBySlug.get(slug), legacy: false };
    }
    if (legacy[lower]) {
      const slug = legacy[lower];
      return { slug, label: labelBySlug.get(slug), legacy: true };
    }
    return { slug: null, label: raw, legacy: true };
  }

  return { MARKETPLACE_CATEGORIES, normalizeMarketplaceCategory };
});
