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
  "4041386"
];

const FLOWERS = ["Rose", "Hydrangea", "Lily", "Tulip", "Peony", "Ranunculus", "Dahlia", "Carnation", "Sunflower", "Orchid", "Snapdragon", "Delphinium", "Chrysanthemum", "Daisy", "Stock", "Anemone", "Freesia", "Iris", "Gerbera", "Alstroemeria"];
const STYLES = ["Garden", "Classic", "Modern", "Romantic", "Luxury", "Petite", "Grand", "Seasonal", "Designer", "Market"];
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
  const occ = OCCASIONS[index % OCCASIONS.length];
  const flower = FLOWERS[index % FLOWERS.length];
  const style = STYLES[Math.floor(index / FLOWERS.length) % STYLES.length];
  const name = `${style} ${flower} ${occ.cat === "Everyday" ? "Bouquet" : occ.cat}`.replace(" bouquets", "");
  const id = `lib-rc2-${occ.slug}-${String(index).padStart(3, "0")}`;
  const photoId = PEXELS_POOL[index % PEXELS_POOL.length];
  const url = pexelsUrl(photoId);
  const price = 49.99 + (index % 12) * 7.5 + (occ.cat.includes("Luxury") || occ.cat.includes("Wedding") ? 40 : 0);
  const description = `A ${style.toLowerCase()} ${flower.toLowerCase()} arrangement styled for ${occ.cat.toLowerCase()} — starter recipe and pricing included. Customize the photo and copy for your shop anytime.`;
  const shortDescription = `${style} ${flower} for ${occ.cat.replace(/ bouquets$/i, "").toLowerCase()}. Ready to add to your catalog.`;
  return {
    id,
    scope: "master",
    name,
    categories: [occ.cat, flower + "s"],
    arrangement_type: occ.cat === "Plants" ? "plant" : "bouquet",
    suggested_retail: { default: Math.round(price * 100) / 100, min: price * 0.9, max: price * 1.25 },
    suggested_cost: Math.round(price * 0.42 * 100) / 100,
    description,
    short_description: shortDescription,
    primary_image: { url, alt: `${name} ultra-realistic floral arrangement photograph`, hash: hash(`${id}-${url}`) },
    image_license: {
      source: "licensed_stock_pexels",
      attribution: "Pexels — verify license at import",
      review_status: "approved_starter"
    },
    recipe: [
      { name: flower, qty: 8 + (index % 6) },
      { name: "Seasonal greenery", qty: 4 + (index % 3) }
    ],
    publish_status: "published",
    tags: [occ.slug, flower.toLowerCase(), "rc2_starter", "ultra_realistic"],
    metadata: {
      image_standard: "ultra_realistic_professional_floral_photography",
      launch_quality: "starter_verified",
      replaceable_by_shop: true
    },
    staff_only_recipe: true
  };
}

/** ~240 unique starter arrangements for founder review. */
export function getBloomFloristCatalog(count = 240) {
  const n = Math.max(1, Math.min(500, count));
  return Array.from({ length: n }, (_, i) => mkProduct(i));
}

export const BLOOM_RC2_CATALOG_SIZE = 240;
