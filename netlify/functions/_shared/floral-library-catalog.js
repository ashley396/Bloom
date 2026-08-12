/** Bloom RC2 — expanded licensed starter catalog (generated, unique names/images). */

const VASE_IMAGE_POOL = [
  "/assets/floral-library/everyday/ed-02-pink-meadow.jpg",
  "/assets/floral-library/everyday/ed-03-classic-rose-mix.jpg",
  "/assets/floral-library/everyday/ed-04-cheerful-daisy-burst.jpg",
  "/assets/floral-library/everyday/ed-05-everyday-hydrangea-pop.jpg",
  "/assets/floral-library/everyday/ed-14-lavender-breeze.jpg",
  "/assets/floral-library/everyday/ed-17-rose-mum-harmony.jpg",
  "/assets/floral-library/everyday/ed-18-alstroemeria-joy.jpg",
  "/assets/floral-library/everyday/ed-19-sunflower-smile.jpg",
  "/assets/floral-library/everyday/ed-20-gentle-pastels.jpg",
  "/assets/floral-library/everyday/ed-25-sweet-simple.jpg",
  "/assets/floral-library/everyday/ed-27-soft-spring-mix.jpg",
  "/assets/floral-library/everyday/ed-32-hydrangea-trio.jpg",
  "/assets/floral-library/everyday/ed-37-classic-cylinder-mix.jpg",
  "/assets/floral-library/everyday/ed-39-soft-neutral-mix.jpg",
  "/assets/floral-library/everyday/ed-40-pink-petal-jar.jpg",
  "/assets/floral-library/everyday/ed-41-golden-glow.jpg",
  "/assets/floral-library/everyday/ed-42-everyday-blush.jpg",
  "/assets/floral-library/everyday/ed-44-rose-trio.jpg",
  "/assets/floral-library/everyday/ed-45-hydrangea-accent.jpg",
  "/assets/floral-library/everyday/ed-47-bright-tabletop.jpg",
  "/assets/floral-library/everyday/ed-50-everyday-florist-favorite.jpg",
  "/assets/floral-library/everyday/ed-53-white-meadow-vase.jpg",
  "/assets/floral-library/everyday/ed-54-everyday-citrus-mix.jpg",
  "/assets/floral-library/everyday/ed-59-neutral-rose-vase.jpg",
  "/assets/floral-library/everyday/ed-67-calm-white-garden.jpg",
  "/assets/floral-library/everyday/ed-69-hydrangea-daisy-mix.jpg",
  "/assets/floral-library/everyday/ed-70-everyday-rustic-cylinder.jpg",
  "/assets/floral-library/everyday/ed-71-modern-neutral-jar.jpg",
  "/assets/floral-library/everyday/ed-76-gentle-white-trio.jpg",
  "/assets/floral-library/everyday/ed-84-bright-daily-cylinder.jpg",
  "/assets/floral-library/everyday/ed-85-pink-white-everyday.jpg",
  "/assets/floral-library/everyday/ed-97-soft-pastel-jar.jpg"
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
  const url = VASE_IMAGE_POOL[index % VASE_IMAGE_POOL.length];
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
      source: "bloom_owned",
      attribution: "Florisyn vetted vase-arrangement starter asset",
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

/** Starter arrangements are capped to the vetted vase-arrangement pool so bad subjects never appear. */
export function getBloomFloristCatalog(count = 240) {
  const n = Math.max(1, Math.min(VASE_IMAGE_POOL.length, count));
  return Array.from({ length: n }, (_, i) => mkProduct(i));
}

export const BLOOM_RC2_CATALOG_SIZE = VASE_IMAGE_POOL.length;
