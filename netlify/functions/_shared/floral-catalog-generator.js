/**
 * Florisyn — ultra-realistic florist catalog generator (450 arrangements).
 * Everyday · Budget-Friendly · Premium Everyday
 * Florist-specific only — no food, restaurant ordering, or generic SaaS demo content.
 */

const PEXELS_FLORAL_POOL = [
  "931177", "1070850", "2111192", "169193", "931168", "462402", "1308881", "931167",
  "459335", "931162", "54200", "736230", "2873966", "568027", "931154", "931159",
  "1457812", "931165", "931166", "4041381", "568026", "931153", "1121334", "931160",
  "931161", "931163", "931164", "931169", "931170", "931171", "568028", "568029",
  "4041392", "2873967", "1457813", "4041382", "4041383", "4041384", "4041385", "4041386",
  "7296680", "1181395", "792942", "2783946", "1024960", "568030", "568031", "568032",
  "568033", "568034", "568035", "568036", "568037", "568038", "568039", "568040",
  "2873968", "2873969", "2873970", "1457814", "1457815", "1457816", "1457817", "1457818",
  "1121335", "1121336", "1121337", "1121338", "1121339", "736231", "736232", "736233",
  "736234", "736735", "459336", "459337", "459338", "459339", "459340", "169194",
  "169195", "169196", "169197", "169198", "2111193", "2111194", "2111195", "2111196",
  "1070851", "1070852", "1070853", "1070854", "1070855", "54201", "54202", "54203",
  "54204", "54205", "4041387", "4041388", "4041389", "4041390", "4041391", "4041393",
  "4041394", "4041395", "4041396", "4041397", "4041398", "4041399", "4041400", "931172",
  "931173", "931174", "931175", "931176", "931178", "931179", "931180", "568041",
  "568042", "568043", "568044", "568045", "2873971", "2873972", "2873973", "1457819",
  "1457820", "1121340", "1121341", "1121342", "736236", "736237", "459341", "459342",
  "2111197", "2111198", "1070856", "1070857", "54206", "54207", "4041401", "4041402",
  "4041403", "4041404", "568046", "568047", "568048", "568049", "2873974", "2873975",
  "1457821", "1457822", "736238", "736239", "459343", "459344", "169199", "169200",
  "931181", "931182", "931183", "931184", "931185", "931186", "931187", "931188",
  "568050", "568051", "568052", "568053", "4041405", "4041406", "4041407", "4041408",
  "2873976", "2873977", "2873978", "1457823", "1121343", "1121344", "736240", "736241",
  "459345", "459346", "2111199", "2111200", "1070858", "1070859", "54208", "54209",
  "4041409", "4041410", "568054", "568055", "568056", "568057", "2873979", "2873980",
];

const STYLES = ["simple", "modern", "cheerful", "compact", "rustic", "classic", "feminine", "garden", "market-fresh"];
const PALETTES = [
  "Blush and white", "Red and green", "Yellow and white", "Purple and lavender",
  "Peach and cream", "Blue and white", "Pink and ivory", "Warm autumn tones",
  "Soft pastels", "Bold primary colors", "White and green", "Coral and sage",
];
const CONTAINERS = [
  "Clear glass cube", "Cylinder vase", "Mason jar", "Ceramic vase", "Bubble bowl",
  "Compote", "Rectangular glass vase", "Handled basket with liner", "Bud vase cluster",
  "Market wrap (no vase)", "Plastic design dish with foam", "Unglazed pottery pot",
];
const MECHANICS = [
  "Tape grid in vase", "Chicken wire ball", "Floral foam brick", "Hand-tied bouquet wrap",
  "Spiral hand-tie with binding point", "Foam-free tape grid", "Pin frog in low bowl",
];
const GREENS = [
  "Leatherleaf", "Pittosporum", "Salal", "Israeli ruscus", "Tree fern", "Eucalyptus",
  "Myrtle", "Dusty miller", "Bear grass", "Lemon leaf",
];
const OCCASIONS = [
  "Everyday", "Birthday", "Anniversary", "Sympathy bouquets", "Get Well",
  "Congratulations", "New Baby", "Love & Romance",
];

const TIER_CONFIG = [
  {
    tier: "Everyday",
    slug: "everyday",
    count: 150,
    baseRetail: 44.99,
    flowers: [
      { name: "Standard roses", stems: [5, 6, 7, 8, 9, 10, 12] },
      { name: "Carnations", stems: [6, 8, 10, 12, 14] },
      { name: "Gerbera daisies", stems: [3, 4, 5, 6, 7] },
      { name: "Chrysanthemums", stems: [4, 5, 6, 7, 8] },
      { name: "Alstroemeria", stems: [5, 6, 7, 8, 10] },
      { name: "Lilies", stems: [2, 3, 4, 5] },
      { name: "Sunflowers", stems: [2, 3, 4, 5] },
      { name: "Hydrangea", stems: [1, 2, 3] },
      { name: "Stock", stems: [4, 5, 6, 7, 8] },
      { name: "Snapdragons", stems: [4, 5, 6, 7] },
      { name: "Baby's breath", stems: [3, 4, 5, 6] },
      { name: "Mini carnations", stems: [6, 8, 10, 12] },
    ],
    nameRoots: [
      "Market", "Classic", "Fresh", "Sunny", "Garden", "Cheerful", "Daily", "Shop",
      "Hand-Tied", "Walk-In", "Counter", "Cooler", "Designer", "Simple", "Bright",
    ],
    why: "Fast to build at the bench, uses cooler staples, and sells steadily for walk-in and phone orders.",
  },
  {
    tier: "Budget-Friendly",
    slug: "budget",
    count: 150,
    baseRetail: 29.99,
    flowers: [
      { name: "Carnations", stems: [8, 10, 12, 14, 16] },
      { name: "Daisy poms", stems: [4, 5, 6, 7, 8] },
      { name: "Chrysanthemums", stems: [5, 6, 7, 8, 10] },
      { name: "Alstroemeria", stems: [4, 5, 6, 7, 8] },
      { name: "Baby's breath", stems: [2, 3, 4, 5] },
      { name: "Mini carnations", stems: [6, 8, 10] },
      { name: "Statice", stems: [3, 4, 5] },
      { name: "Solidago", stems: [2, 3, 4] },
    ],
    nameRoots: [
      "Value", "Economy", "Compact", "Petite", "Smart", "Everyday Value", "Quick",
      "Budget", "Simple", "Small", "Starter", "Express", "Cooler Special", "Basic",
    ],
    why: "Low stem cost and quick production protect margin while still looking full and gift-ready.",
  },
  {
    tier: "Premium Everyday",
    slug: "premium-everyday",
    count: 150,
    baseRetail: 64.99,
    flowers: [
      { name: "Garden roses", stems: [3, 4, 5, 6, 7] },
      { name: "Ranunculus", stems: [4, 5, 6, 7, 8] },
      { name: "Peonies", stems: [2, 3, 4, 5] },
      { name: "Premium stock", stems: [5, 6, 7, 8] },
      { name: "Hydrangea", stems: [1, 2, 3] },
      { name: "Standard roses", stems: [4, 5, 6, 7] },
      { name: "Anemones", stems: [3, 4, 5, 6] },
      { name: "Tulip", stems: [5, 6, 7, 8, 10] },
    ],
    nameRoots: [
      "Boutique", "Elevated", "Signature", "Premium", "Refined", "Soft Luxury",
      "Designer", "Atelier", "Studio", "Curated", "Polished", "Upscale", "Fine",
    ],
    why: "A slightly elevated look using small counts of premium blooms while staying practical for daily production.",
  },
];

const FORBIDDEN_TERMS = /\b(pizza|burger|coffee|cupcake|restaurant order|grocery|sushi|taco|latte|espresso)\b/i;

function pexelsUrl(id) {
  return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
  return `h${h.toString(16)}`;
}

function pick(arr, index) {
  return arr[index % arr.length];
}

function pickStems(flower, index) {
  return flower.stems[index % flower.stems.length];
}

/** Spread photo IDs — minimize repeats within typical 60-item library page loads. */
function photoIdForIndex(globalIndex) {
  const primeStep = 17;
  const poolIndex = (globalIndex * primeStep + Math.floor(globalIndex / PEXELS_FLORAL_POOL.length)) % PEXELS_FLORAL_POOL.length;
  return PEXELS_FLORAL_POOL[poolIndex];
}

function buildRecipe(primary, secondary, primaryStems, secondaryStems, greeneryStems) {
  const recipe = [{ name: primary.name, qty: primaryStems }];
  if (secondary && secondaryStems > 0) recipe.push({ name: secondary.name, qty: secondaryStems });
  if (greeneryStems > 0) recipe.push({ name: pick(GREENS, primaryStems), qty: greeneryStems });
  return recipe;
}

function buildInstructions({ container, mechanics, primary, primaryStems, greenery, greeneryStems }) {
  return [
    `Prep ${container.toLowerCase()} and ${mechanics.toLowerCase()}.`,
    `Condition ${primary.name.toLowerCase()} and cut stems at an angle.`,
    `Place ${greeneryStems} stems of ${greenery.toLowerCase()} to frame the container.`,
    `Insert ${primaryStems} ${primary.name.toLowerCase()} at varied heights for a natural silhouette.`,
    `Fill gaps, check water level, and finish with a clean sleeve or bow if hand-tied.`,
  ];
}

function buildDescription(product) {
  const recipeLine = product.recipe.map((r) => `${r.qty} ${r.name}`).join(", ");
  const steps = product.instructions.map((s, i) => `${i + 1}. ${s}`).join(" ");
  return [
    `${product.name} — ${product.style} ${product.catalog_tier.toLowerCase()} design in ${product.color_palette.toLowerCase()}.`,
    `Container: ${product.container}. Mechanics: ${product.mechanics}.`,
    `Recipe: ${recipeLine}. Foliage: ${product.foliage}.`,
    `Build: ${steps}`,
    product.why_it_works,
  ].join(" ");
}

function mkArrangement(globalIndex, tierIndex, tier, localIndex) {
  const primary = pick(tier.flowers, localIndex * 3 + tierIndex);
  const secondary = pick(tier.flowers, localIndex * 5 + tierIndex + 2);
  const style = pick(STYLES, globalIndex);
  const palette = pick(PALETTES, globalIndex + localIndex);
  const container = pick(CONTAINERS, globalIndex + tierIndex);
  const mechanics = pick(MECHANICS, localIndex + tierIndex);
  const foliage = pick(GREENS, globalIndex);
  const occasion = pick(OCCASIONS, globalIndex);
  const nameRoot = pick(tier.nameRoots, localIndex);
  const primaryStems = pickStems(primary, globalIndex);
  const secondaryStems =
    tier.tier === "Budget-Friendly"
      ? Math.max(2, Math.floor(primaryStems / 3))
      : Math.max(3, Math.floor(primaryStems / 2));
  const greeneryStems = tier.tier === "Budget-Friendly" ? 3 + (localIndex % 3) : 4 + (localIndex % 4);
  const primaryShort = primary.name
    .replace(/^Standard |^Premium |^Garden |^Mini /, "")
    .replace(/s$/, "")
    .trim();
  const occasionLabel =
    occasion === "Everyday" ? "Bouquet" : occasion.replace(/ bouquets$/, "");
  let name = `${nameRoot} ${style.charAt(0).toUpperCase() + style.slice(1)} ${primaryShort} ${occasionLabel}`;
  if (localIndex % 3 === 0 && tier.tier === "Budget-Friendly") {
    name = `${nameRoot} ${primaryShort} ${container.split(" ")[0]} ${occasionLabel}`;
  } else if (localIndex % 5 === 0) {
    name = `${nameRoot} ${primaryShort} ${palette.split(" ")[0]} ${occasionLabel}`;
  }
  const id = `lib-flor-${tier.slug}-${String(localIndex + 1).padStart(3, "0")}`;
  const photoId = photoIdForIndex(globalIndex);
  const url = pexelsUrl(photoId);
  const retail =
    tier.baseRetail +
    (localIndex % 9) * 4.5 +
    (tier.tier === "Premium Everyday" ? 12 : 0) +
    (occasion.includes("Sympathy") || occasion.includes("Anniversary") ? 8 : 0);
  const recipe = buildRecipe(primary, secondary, primaryStems, secondaryStems, greeneryStems);
  const instructions = buildInstructions({
    container,
    mechanics,
    primary,
    primaryStems,
    greenery: foliage,
    greeneryStems,
  });
  const product = {
    id,
    scope: "master",
    name,
    catalog_tier: tier.tier,
    style,
    color_palette: palette,
    container,
    mechanics,
    foliage,
    categories: [tier.tier, occasion, primary.name.replace(/Standard |Premium /, "") + "s"],
    arrangement_type: occasion.includes("Sympathy") || occasion.includes("Funeral") ? "tribute" : "bouquet",
    suggested_retail: {
      default: Math.round(retail * 100) / 100,
      min: Math.round(retail * 0.88 * 100) / 100,
      max: Math.round(retail * 1.22 * 100) / 100,
    },
    suggested_cost: Math.round(retail * (tier.tier === "Budget-Friendly" ? 0.38 : 0.42) * 100) / 100,
    recipe,
    instructions,
    why_it_works: tier.why,
    publish_status: "published",
    tags: [tier.slug, primary.name.toLowerCase().replace(/\s+/g, "-"), style, "florist-realistic"],
    staff_only_recipe: true,
    primary_image: {
      url,
      alt: `${name} — fresh florist arrangement`,
      hash: hash(`${id}-${photoId}`),
    },
    image_license: {
      source: "licensed_stock_pexels",
      attribution: "Pexels — licensed floral photography; replace with your shop photos",
      review_status: "approved_starter",
    },
  };
  product.description = buildDescription(product);
  product.short_description = product.description.slice(0, 140);
  return product;
}

/** Generate full 450-arrangement florist catalog. */
export function generateFloristCatalog(total = 450) {
  const expected = TIER_CONFIG.reduce((s, t) => s + t.count, 0);
  if (total !== expected) {
    throw new Error(`Florist catalog expects ${expected} arrangements (${TIER_CONFIG.map((t) => `${t.count} ${t.tier}`).join(", ")}).`);
  }

  const items = [];
  let globalIndex = 0;
  for (let tierIndex = 0; tierIndex < TIER_CONFIG.length; tierIndex++) {
    const tier = TIER_CONFIG[tierIndex];
    for (let i = 0; i < tier.count; i++) {
      items.push(mkArrangement(globalIndex, tierIndex, tier, i));
      globalIndex++;
    }
  }

  const names = new Set();
  for (const item of items) {
    let uniqueName = item.name;
    let n = 2;
    while (names.has(uniqueName)) {
      uniqueName = `${item.name} ${n}`;
      n++;
    }
    item.name = uniqueName;
    names.add(uniqueName);
  }

  if (names.size !== items.length) {
    throw new Error("Duplicate arrangement names detected in florist catalog.");
  }

  for (const item of items) {
    const blob = `${item.name} ${item.description} ${item.categories.join(" ")}`;
    if (FORBIDDEN_TERMS.test(blob)) {
      throw new Error(`Forbidden non-floral term in catalog item: ${item.id}`);
    }
  }

  return items;
}

export const FLORIST_CATALOG_SIZE = 450;
export const FLORIST_CATALOG_TIERS = TIER_CONFIG.map((t) => ({ tier: t.tier, count: t.count }));
