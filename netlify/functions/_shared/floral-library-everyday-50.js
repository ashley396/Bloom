/**
 * Florisyn Everyday Ultra-Realistic Floral Library — merged batches (50 + 50 = 100 toward 500).
 * Data: public/data/floral-library-everyday-50.json + floral-library-everyday-batch-2.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../../../public/data");

const BATCH_FILES = [
  "floral-library-everyday-50.json",
  "floral-library-everyday-batch-2.json"
];

const ULTRA_REALISTIC_IMAGE_STANDARD = "ultra_realistic_professional_floral_photography";

function loadAllArrangements() {
  const merged = [];
  for (const file of BATCH_FILES) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) continue;
    const json = JSON.parse(fs.readFileSync(full, "utf8"));
    merged.push(...(json.arrangements || []));
  }
  const ids = merged.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate floral library arrangement ids across batches");
  }
  return merged;
}

function toLibraryProduct(a) {
  const retail = Number(a.suggested_retail);
  const batch = a.batch ?? 1;
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
      attribution: `Florisyn Everyday Collection — batch ${batch}`,
      review_status: "approved"
    },
    recipe: (a.recipe || []).map((r) => ({ name: r.name, qty: r.qty })),
    publish_status: "published",
    tags: ["everyday", "ultra_realistic", a.style, `florisyn_everyday_batch_${batch}`],
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
      batch
    }
  };
}

/** Raw arrangement records (full production detail, all batches). */
export const EVERYDAY_FLORAL_ARRANGEMENTS = loadAllArrangements();

/** Master catalog products for API + shop copy. */
export function getEverydayFloralLibraryCatalog() {
  return EVERYDAY_FLORAL_ARRANGEMENTS.map(toLibraryProduct);
}

export function getEverydayFloralLibraryById(id) {
  return getEverydayFloralLibraryCatalog().find((p) => p.id === id) || null;
}
