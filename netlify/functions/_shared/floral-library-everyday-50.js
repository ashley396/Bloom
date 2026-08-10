/**
 * Florisyn Everyday Ultra-Realistic Floral Library — batch 1 (50 of 500).
 * Data: public/data/floral-library-everyday-50.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../public/data/floral-library-everyday-50.json"), "utf8")
);

const ULTRA_REALISTIC_IMAGE_STANDARD = "ultra_realistic_professional_floral_photography";

function toLibraryProduct(a) {
  const retail = Number(a.suggested_retail);
  return {
    id: a.id,
    scope: "master",
    source: "florisyn_everyday",
    name: a.name,
    categories: a.categories || ["Everyday"],
    arrangement_type: a.arrangement_type || "bouquet",
    short_description: a.short_description,
    description: a.description,
    suggested_retail: {
      default: retail,
      min: Math.round(retail * 0.9 * 100) / 100,
      max: Math.round(retail * 1.2 * 100) / 100
    },
    suggested_cost: Math.round(retail * 0.42 * 100) / 100,
    primary_image: {
      url: `/assets/floral-library/${a.image}`,
      alt: a.alt || `${a.name} ultra-realistic everyday floral arrangement photograph`,
      hash: `h${a.id}`
    },
    image_license: {
      source: "bloom_owned",
      attribution: "Florisyn Everyday Collection — batch 1",
      review_status: "approved"
    },
    recipe: (a.recipe || []).map((r) => ({ name: r.name, qty: r.qty })),
    publish_status: "published",
    tags: ["everyday", "ultra_realistic", a.style, "florisyn_everyday_batch_1"],
    metadata: {
      image_standard: ULTRA_REALISTIC_IMAGE_STANDARD,
      launch_quality: "everyday_verified",
      replaceable_by_shop: true,
      style: a.style,
      color_palette: a.color_palette,
      container: a.container,
      mechanics: a.mechanics,
      tools: a.tools,
      foliage: a.foliage,
      instructions: a.instructions,
      why_it_works: a.why_it_works,
      batch: catalogJson.batch
    }
  };
}

/** Raw arrangement records (full production detail). */
export const EVERYDAY_FLORAL_ARRANGEMENTS = catalogJson.arrangements;

/** Master catalog products for API + shop copy. */
export function getEverydayFloralLibraryCatalog() {
  return EVERYDAY_FLORAL_ARRANGEMENTS.map(toLibraryProduct);
}

export function getEverydayFloralLibraryById(id) {
  return getEverydayFloralLibraryCatalog().find((p) => p.id === id) || null;
}
