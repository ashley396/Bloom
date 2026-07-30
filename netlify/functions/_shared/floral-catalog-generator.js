/**
 * Florisyn — ultra-realistic florist catalog generator (450 arrangements).
 * Everyday · Budget-Friendly · Premium Everyday
 * Production retail designs only — profitable, repeatable, buildable today.
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
  "Soft pastels", "Red and yellow", "White and green", "Coral and sage",
];
const ALL_CONTAINERS = [
  "Clear glass cube", "Cylinder vase", "Mason jar", "Ceramic vase", "Bubble bowl",
  "Compote", "Rectangular glass vase", "Handled basket with liner", "Bud vase cluster",
  "Market wrap (no vase)", "Plastic design dish with foam", "Unglazed pottery pot",
];
const BUDGET_CONTAINERS = [
  "Mason jar", "Cylinder vase", "Market wrap (no vase)", "Plastic design dish with foam",
  "Handled basket with liner", "Unglazed pottery pot",
];
const PREMIUM_CONTAINERS = [
  "Ceramic vase", "Cylinder vase", "Clear glass cube", "Compote", "Bubble bowl",
  "Rectangular glass vase",
];
const GREENS = [
  "Leatherleaf", "Pittosporum", "Salal", "Israeli ruscus", "Tree fern", "Eucalyptus",
  "Myrtle", "Dusty miller", "Bear grass", "Lemon leaf",
];
const BUDGET_GREENS = ["Leatherleaf", "Pittosporum"];
const OCCASIONS = [
  "Everyday", "Birthday", "Anniversary", "Sympathy bouquets", "Get Well",
  "Congratulations", "New Baby", "Love & Romance",
];

const FORBIDDEN_TERMS = /\b(pizza|burger|coffee|cupcake|restaurant order|grocery|sushi|taco|latte|espresso)\b/i;
const VAGUE_RECIPE = /^(seasonal blooms|mixed flowers|greenery|seasonal greenery|misc flowers)$/i;
const FANTASY_FLOWERS = /\b(unicorn|fantasy|dried butterfly|preserved moss ball)\b/i;

const TIER_CONFIG = [
  {
    tier: "Everyday",
    slug: "everyday",
    count: 150,
    baseRetail: 44.99,
    maxStems: 24,
    maxDesignMinutes: 25,
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
    profitNote: "Uses cooler staples with strong everyday turn and predictable stem cost.",
  },
  {
    tier: "Budget-Friendly",
    slug: "budget",
    count: 150,
    baseRetail: 29.99,
    maxStems: 18,
    maxDesignMinutes: 18,
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
    profitNote: "Low stem cost and compact mechanics protect margin on high-volume sales.",
  },
  {
    tier: "Premium Everyday",
    slug: "premium-everyday",
    count: 150,
    baseRetail: 64.99,
    maxStems: 22,
    maxDesignMinutes: 28,
    flowers: [
      { name: "Garden roses", stems: [3, 4, 5, 6, 7] },
      { name: "Ranunculus", stems: [4, 5, 6, 7, 8] },
      { name: "Peonies", stems: [2, 3, 4, 5] },
      { name: "Premium stock", stems: [5, 6, 7, 8] },
      { name: "Premium hydrangea", stems: [1, 2, 3] },
      { name: "Standard roses", stems: [4, 5, 6, 7] },
      { name: "Anemones", stems: [3, 4, 5, 6] },
      { name: "Tulips", stems: [5, 6, 7, 8, 10] },
    ],
    nameRoots: [
      "Boutique", "Elevated", "Signature", "Premium", "Refined", "Soft Luxury",
      "Designer", "Atelier", "Studio", "Curated", "Polished", "Upscale", "Fine",
    ],
    profitNote: "Small counts of premium blooms create upsell value without excess labor.",
  },
];

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

function containersForTier(tier) {
  if (tier.tier === "Budget-Friendly") return BUDGET_CONTAINERS;
  if (tier.tier === "Premium Everyday") return PREMIUM_CONTAINERS;
  return ALL_CONTAINERS;
}

function foliageForTier(tier, index) {
  if (tier.tier === "Budget-Friendly") return pick(BUDGET_GREENS, index);
  return pick(GREENS, index);
}

function mechanicsForContainer(container) {
  if (container.includes("Market wrap")) return "Spiral hand-tie with binding point";
  if (container.includes("Basket") || container.includes("dish")) return "Floral foam brick";
  if (container.includes("Bubble bowl") || container.includes("Compote")) return "Pin frog in low bowl";
  if (container.includes("Bud vase")) return "Hand-tied bouquet wrap";
  return "Tape grid in vase";
}

/** Spread photo IDs — minimize repeats within typical 60-item library page loads. */
function photoIdForIndex(globalIndex) {
  const primeStep = 17;
  const poolIndex =
    (globalIndex * primeStep + Math.floor(globalIndex / PEXELS_FLORAL_POOL.length)) %
    PEXELS_FLORAL_POOL.length;
  return PEXELS_FLORAL_POOL[poolIndex];
}

function buildRecipe(primary, secondary, primaryStems, secondaryStems, foliageName, greeneryStems) {
  const recipe = [{ name: primary.name, qty: primaryStems }];
  if (secondary && secondary.name !== primary.name && secondaryStems > 0) {
    recipe.push({ name: secondary.name, qty: secondaryStems });
  }
  if (greeneryStems > 0) recipe.push({ name: foliageName, qty: greeneryStems });
  return recipe;
}

function trimRecipeToMaxStems(recipe, maxStems) {
  let total = recipe.reduce((s, r) => s + r.qty, 0);
  if (total <= maxStems) return recipe;
  const trimmed = recipe.map((r) => ({ ...r }));
  while (total > maxStems && trimmed.length) {
    const idx = trimmed.findIndex((r) => r.qty > 1 && !/leatherleaf|pittosporum|salal|ruscus|fern|eucalyptus|myrtle|grass|leaf/i.test(r.name));
    const target = idx >= 0 ? idx : 0;
    trimmed[target].qty -= 1;
    total -= 1;
  }
  return trimmed;
}

function buildInstructions({ container, mechanics, primary, primaryStems, foliage, greeneryStems, handTied }) {
  const steps = [
    "Sanitize the bench, bucket, and tools; fill a clean bucket with water and commercial floral preservative.",
    `Prep the ${container.toLowerCase()} using ${mechanics.toLowerCase()}.`,
    `Condition ${primaryStems} stems of ${primary.name.toLowerCase()} — re-cut at a 45° angle and remove foliage below the waterline.`,
  ];
  if (greeneryStems > 0) {
    steps.push(`Insert ${greeneryStems} stems of ${foliage.toLowerCase()} to establish the outer frame.`);
  }
  steps.push(
    `Place ${primary.name.toLowerCase()} at varied heights; keep the silhouette rounded and retail-ready.`,
    handTied
      ? "Secure with bind wire, wrap the stems, and finish with sleeve and care card."
      : "Check water level, clean stray foliage, and stage for cooler or delivery."
  );
  return steps;
}

function buildWhyItWorks(tier, occasion) {
  return [
    `Profitability: ${tier.profitNote}`,
    `Simplicity: Designed for ${tier.maxDesignMinutes} minutes or less at the design bench with standard shop mechanics.`,
    `Customer appeal: A clear ${occasion.toLowerCase()} gift that reads polished in photos and on the sales floor.`,
  ].join(" ");
}

function buildDescription(product) {
  const recipeLine = product.recipe.map((r) => `${r.qty} ${r.name}`).join(", ");
  const steps = product.instructions.map((s, i) => `${i + 1}. ${s}`).join(" ");
  return [
    `${product.name} — ${product.design_style} ${product.catalog_tier.toLowerCase()} arrangement in ${product.color_palette.toLowerCase()}.`,
    `Container: ${product.container}. Mechanics: ${product.mechanics}. Foliage: ${product.foliage}.`,
    `Recipe: ${recipeLine}.`,
    `Build: ${steps}`,
    product.why_it_works,
  ].join(" ");
}

function mkArrangement(globalIndex, tierIndex, tier, localIndex) {
  const primary = pick(tier.flowers, localIndex * 3 + tierIndex);
  const secondary = pick(tier.flowers, localIndex * 5 + tierIndex + 2);
  const designStyle = pick(STYLES, globalIndex);
  const palette = pick(PALETTES, globalIndex + localIndex);
  const container = pick(containersForTier(tier), globalIndex + tierIndex);
  const mechanics = mechanicsForContainer(container);
  const foliage = foliageForTier(tier, globalIndex);
  const occasion = pick(OCCASIONS, globalIndex);
  const nameRoot = pick(tier.nameRoots, localIndex);
  let primaryStems = pickStems(primary, globalIndex);
  let secondaryStems =
    tier.tier === "Budget-Friendly"
      ? Math.max(2, Math.floor(primaryStems / 3))
      : Math.max(3, Math.floor(primaryStems / 2));
  let greeneryStems = tier.tier === "Budget-Friendly" ? 3 + (localIndex % 2) : 4 + (localIndex % 3);
  const primaryShort = primary.name
    .replace(/^Standard |^Premium |^Garden |^Mini /, "")
    .replace(/s$/, "")
    .trim();
  const occasionLabel = occasion === "Everyday" ? "Bouquet" : occasion.replace(/ bouquets$/, "");
  let name = `${nameRoot} ${designStyle.charAt(0).toUpperCase() + designStyle.slice(1)} ${primaryShort} ${occasionLabel}`;
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
  let recipe = buildRecipe(primary, secondary, primaryStems, secondaryStems, foliage, greeneryStems);
  recipe = trimRecipeToMaxStems(recipe, tier.maxStems);
  const handTied = container.includes("Market wrap") || mechanics.includes("hand-tie");
  const instructions = buildInstructions({
    container,
    mechanics,
    primary,
    primaryStems: recipe.find((r) => r.name === primary.name)?.qty || primaryStems,
    foliage,
    greeneryStems: recipe.find((r) => r.name === foliage)?.qty || greeneryStems,
    handTied,
  });
  const product = {
    id,
    scope: "master",
    name,
    catalog_tier: tier.tier,
    design_style: designStyle,
    style: designStyle,
    color_palette: palette,
    container,
    mechanics,
    foliage,
    categories: [tier.tier, occasion, primaryShort + "s"],
    arrangement_type: occasion.includes("Sympathy") ? "tribute" : "bouquet",
    estimated_design_minutes: Math.min(tier.maxDesignMinutes, 10 + recipe.reduce((s, r) => s + r.qty, 0)),
    suggested_retail: {
      default: Math.round(retail * 100) / 100,
      min: Math.round(retail * 0.88 * 100) / 100,
      max: Math.round(retail * 1.22 * 100) / 100,
    },
    suggested_cost: Math.round(retail * (tier.tier === "Budget-Friendly" ? 0.38 : 0.42) * 100) / 100,
    recipe,
    instructions,
    why_it_works: buildWhyItWorks(tier, occasion),
    publish_status: "published",
    tags: [tier.slug, primary.name.toLowerCase().replace(/\s+/g, "-"), designStyle, "florist-realistic"],
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
  product.short_description = `${product.name}. ${product.catalog_tier} · ${product.color_palette}. ${product.recipe.map((r) => `${r.qty} ${r.name}`).join(", ")}.`;
  return product;
}

export function validateFloristCatalogQuality(items) {
  const errors = [];
  for (const item of items) {
    const blob = `${item.name} ${item.description} ${item.recipe.map((r) => r.name).join(" ")}`;
    if (FORBIDDEN_TERMS.test(blob)) errors.push(`${item.id}: forbidden non-floral term`);
    if (FANTASY_FLOWERS.test(blob)) errors.push(`${item.id}: fantasy content`);
    for (const row of item.recipe) {
      if (VAGUE_RECIPE.test(row.name)) errors.push(`${item.id}: vague recipe line "${row.name}"`);
      if (row.qty <= 0 || row.qty > 20) errors.push(`${item.id}: unrealistic stem count for ${row.name}`);
    }
    if (!item.design_style || !item.color_palette || !item.instructions?.length) {
      errors.push(`${item.id}: missing required production fields`);
    }
  }
  return errors;
}

/** Generate full 450-arrangement florist catalog. */
export function generateFloristCatalog(total = 450) {
  const expected = TIER_CONFIG.reduce((s, t) => s + t.count, 0);
  if (total !== expected) {
    throw new Error(
      `Florist catalog expects ${expected} arrangements (${TIER_CONFIG.map((t) => `${t.count} ${t.tier}`).join(", ")}).`,
    );
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

  const qualityErrors = validateFloristCatalogQuality(items);
  if (qualityErrors.length) {
    throw new Error(`Catalog quality check failed: ${qualityErrors.slice(0, 3).join("; ")}`);
  }

  return items;
}

export const FLORIST_CATALOG_SIZE = 450;
export const FLORIST_CATALOG_TIERS = TIER_CONFIG.map((t) => ({ tier: t.tier, count: t.count }));
