/** Bloom RC2 — expanded licensed starter catalog (generated, unique names/images). */

const PEXELS_POOL = [
  "931177",
  "1070850",
  "2111192",
  "169193",
  "931168",
  "462402",
  "1308881",
  "931167",
  "459335",
  "931162",
  "54200",
  "736230",
  "2873966",
  "568027",
  "931154",
  "931159",
  "1457812",
  "931165",
  "931166",
  "4041381",
  "568026",
  "931153",
  "1121334",
  "931160",
  "931161",
  "931163",
  "931164",
  "931169",
  "931170",
  "931171",
  "568028",
  "568029",
  "4041392",
  "2873967",
  "1457813",
  "4041382",
  "4041383",
  "4041384",
  "4041385",
  "4041386",
  "6641321",
  "12246243",
  "15583008",
  "28871336",
  "14438233",
  "8793489",
  "6913088",
  "28871333",
  "31788089",
  "37023405",
  "35556908",
  "35348905",
  "30248284",
  "37222812",
  "31792526",
  "16812533",
  "7185245",
  "28571066",
  "7875459",
  "33617307",
  "269220",
  "34463054",
  "35990366",
  "35042836",
  "36745140",
  "15733233",
  "11814563",
  "8112797",
  "2879819",
  "6757651"
];

const EVERYDAY_RECIPES = [
  ["Garden Hydrangea", [["Blue Hydrangea", 3], ["White Roses", 6], ["Seeded Eucalyptus", 5], ["Italian Ruscus", 4]]],
  ["Blush Rose", [["Blush Roses", 10], ["Waxflower", 4], ["Silver Dollar Eucalyptus", 5], ["Limonium", 3]]],
  ["Sunflower Meadow", [["Sunflowers", 5], ["Yellow Roses", 6], ["Solidago", 4], ["Leatherleaf", 5]]],
  ["Peony Blush", [["Pink Peonies", 6], ["Cream Roses", 7], ["Dusty Miller", 4], ["Eucalyptus", 5]]],
  ["Tulip Bowl", [["Tulips", 15], ["Hyacinth", 4], ["Bear Grass", 8], ["Moss", 1]]],
  ["Lily Garden", [["Pink Lilies", 5], ["White Stock", 5], ["Alstroemeria", 7], ["Salal", 5]]],
  ["Dahlia Glow", [["Dahlias", 7], ["Spray Roses", 6], ["Hypericum", 4], ["Ruscus", 5]]],
  ["Ranunculus Charm", [["Ranunculus", 10], ["Sweet Pea", 6], ["Mini Carnations", 6], ["Eucalyptus", 4]]],
  ["Freesia Morning", [["Freesia", 12], ["White Roses", 5], ["Green Trick Dianthus", 4], ["Pittosporum", 5]]],
  ["Gerbera Cheer", [["Gerbera Daisies", 8], ["Button Mums", 6], ["Roses", 5], ["Leatherleaf", 5]]],
  ["Orchid Accent", [["Cymbidium Orchids", 5], ["Roses", 7], ["Hydrangea", 2], ["Aspidistra", 4]]],
  ["Stock & Snap", [["Snapdragons", 7], ["Stock", 6], ["Carnations", 7], ["Eucalyptus", 5]]],
  ["Alstroemeria Fresh", [["Alstroemeria", 12], ["Spray Roses", 6], ["Monte Casino", 5], ["Salal", 5]]],
  ["Iris Garden", [["Iris", 9], ["White Roses", 5], ["Delphinium", 5], ["Leatherleaf", 5]]],
  ["Daisy Basket", [["Daisies", 12], ["Yellow Roses", 5], ["Solidago", 4], ["Tree Fern", 5]]],
  ["Anemone Pop", [["Anemones", 9], ["Ranunculus", 7], ["Spray Roses", 5], ["Italian Ruscus", 5]]],
  ["Carnation Cloud", [["Carnations", 14], ["Mini Carnations", 8], ["Baby's Breath", 4], ["Leatherleaf", 5]]],
  ["Chrysanthemum Market", [["Chrysanthemums", 10], ["Roses", 6], ["Statice", 4], ["Salal", 5]]],
  ["Delphinium Sky", [["Delphinium", 7], ["White Roses", 6], ["Hydrangea", 2], ["Eucalyptus", 4]]],
  ["Rosemary Garden", [["Garden Roses", 8], ["Lisianthus", 6], ["Waxflower", 4], ["Rosemary", 5]]]
];

const STYLES = ["Garden", "Classic", "Modern", "Romantic", "Petite", "Grand", "Seasonal", "Designer", "Market", "Everyday"];
const OCCASIONS = [
  { cat: "Everyday", slug: "everyday" },
  { cat: "Birthday", slug: "birthday" },
  { cat: "Anniversary", slug: "anniversary" },
  { cat: "Romance", slug: "romance" },
  { cat: "Wedding", slug: "wedding" },
  { cat: "Sympathy bouquets", slug: "sympathy" },
  { cat: "Funeral", slug: "funeral" },
  { cat: "Get Well", slug: "get-well" },
  { cat: "Congratulations", slug: "congratulations" },
  { cat: "Luxury arrangements", slug: "luxury" },
  { cat: "Plants", slug: "plants" },
  { cat: "Valentine's Day", slug: "valentine" },
  { cat: "Mother's Day", slug: "mothers-day" },
  { cat: "Christmas", slug: "christmas" }
];

function pexelsUrl(id) {
  return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
  return `h${h.toString(16)}`;
}

function mkProduct(index) {
  const firstVisiblePage = index < 60;
  const occ = firstVisiblePage ? OCCASIONS[0] : OCCASIONS[index % OCCASIONS.length];
  const recipeTemplate = EVERYDAY_RECIPES[index % EVERYDAY_RECIPES.length];
  const style = STYLES[Math.floor(index / EVERYDAY_RECIPES.length) % STYLES.length];
  const baseName = firstVisiblePage
    ? `${style} ${recipeTemplate[0]} Arrangement`
    : `${style} ${recipeTemplate[0]} ${occ.cat === "Everyday" ? "Arrangement" : occ.cat}`.replace(" bouquets", "");
  const name = `${baseName} ${index + 1}`;
  const id = `lib-rc2-${occ.slug}-${String(index).padStart(3, "0")}`;
  const photoId = PEXELS_POOL[index % PEXELS_POOL.length];
  const url = pexelsUrl(photoId);
  const price = 49.99 + (index % 12) * 7.5 + (occ.cat.includes("Luxury") || occ.cat.includes("Wedding") ? 40 : 0);
  const description = `An ultra-realistic ${style.toLowerCase()} everyday floral arrangement with florist-ready recipe guidance and licensed starter photography; replace with your own shop work anytime.`;
  return {
    id,
    scope: "master",
    name,
    categories: [occ.cat, recipeTemplate[0]],
    arrangement_type: occ.cat === "Plants" ? "plant" : "bouquet",
    suggested_retail: { default: Math.round(price * 100) / 100, min: price * 0.9, max: price * 1.25 },
    suggested_cost: Math.round(price * 0.42 * 100) / 100,
    description,
    short_description: description.slice(0, 120),
    primary_image: { url, alt: `${name} ultra-realistic everyday floral arrangement photograph`, hash: hash(`${id}-${url}`) },
    image_license: {
      source: "licensed_stock_pexels",
      attribution: "Pexels — verify license at import",
      review_status: "approved_starter"
    },
    recipe: recipeTemplate[1].map(([name, qty]) => ({ name, qty })),
    publish_status: "published",
    tags: [occ.slug, recipeTemplate[0].toLowerCase(), "everyday_arrangement", "rc2_starter", "ultra_realistic"],
    metadata: {
      image_standard: "ultra_realistic_professional_floral_photography",
      launch_quality: "starter_verified",
      replaceable_by_shop: true
    },
    staff_only_recipe: true
  };
}

/** Starter arrangements are capped to the verified unique photo pool so the library never repeats pictures. */
export function getBloomFloristCatalog(count = 240) {
  const n = Math.max(1, Math.min(PEXELS_POOL.length, count));
  return Array.from({ length: n }, (_, i) => mkProduct(i));
}

export const BLOOM_RC2_CATALOG_SIZE = PEXELS_POOL.length;
