/**
 * Florisyn Everyday Ultra-Realistic Floral Library — bundled JSON (Netlify-safe).
 * Do not use fs + fileURLToPath(import.meta.url) here; esbuild breaks __dirname in functions.
 */
import batch1 from "../../public/data/floral-library-everyday-50.json" with { type: "json" };
import batch2 from "../../public/data/floral-library-everyday-batch-2.json" with { type: "json" };
import {
  arrangementToCsvRow,
  hasValidVase,
  isBlockedImageSubject,
  shouldHideFromPublicLibrary,
  stemCount,
} from "./csv-standard.js";

const ULTRA_REALISTIC_IMAGE_STANDARD = "ultra_realistic_professional_floral_photography";

function mergeArrangements() {
  const merged = [...(batch1.arrangements || []), ...(batch2.arrangements || [])];
  const ids = merged.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate floral library arrangement ids across batches");
  }
  return merged;
}

function libraryImageUrl(a, contentHash) {
  const base = `/assets/floral-library/${a.image}`;
  return contentHash ? `${base}?v=${contentHash}` : base;
}

function resolveNeedsReplacement(a) {
  if (a.needs_image_replacement) return true;
  if (shouldHideFromPublicLibrary(a)) return true;
  if (!hasValidVase(a)) return true;
  if (isBlockedImageSubject(a)) return true;
  if (a.vase_arrangement_verified === false) return true;
  return false;
}

function toLibraryProduct(a) {
  const retail = Number(a.suggested_retail);
  const batch = a.batch ?? 1;
  const needsReplacement = resolveNeedsReplacement(a);
  const verifiedPhoto = !needsReplacement;
  const contentHash = a.content_sha256 ? String(a.content_sha256).slice(0, 16) : `h${a.id}`;
  const imageUrl = libraryImageUrl(a, contentHash);
  const licenseSource = a.image_license?.source || "bloom_owned";
  const csv = arrangementToCsvRow(a);
  return {
    id: a.id,
    scope: "master",
    source: "florisyn_everyday",
    name: a.name,
    sku: csv.SKU,
    categories: a.categories || ["Everyday"],
    occasion: csv.Occasion,
    arrangement_type: a.arrangement_type || "vase_arrangement",
    short_description: a.short_description,
    description: a.description,
    suggested_retail: {
      default: retail,
      min: Math.round(retail * 0.9 * 100) / 100,
      max: Math.round(retail * 1.2 * 100) / 100,
    },
    suggested_cost: Math.round(retail * 0.42 * 100) / 100,
    primary_image: {
      url: imageUrl,
      alt: a.alt || (verifiedPhoto
        ? `${a.name} ultra-realistic vase arrangement product photograph`
        : `${a.name} — photo replacement pending`),
      hash: contentHash,
    },
    image_license: a.image_license || {
      source: licenseSource,
      attribution: `Florisyn Everyday Collection — batch ${batch}`,
      review_status: "approved",
    },
    recipe: (a.recipe || []).map((r) => ({ name: r.name, qty: r.qty })),
    publish_status: "published",
    tags: verifiedPhoto
      ? ["everyday", "ultra_realistic", "vase_arrangement", a.style, `florisyn_everyday_batch_${batch}`]
      : ["everyday", "needs_photo", a.style, `florisyn_everyday_batch_${batch}`],
    csv,
    metadata: {
      image_standard: verifiedPhoto ? ULTRA_REALISTIC_IMAGE_STANDARD : null,
      launch_quality: needsReplacement ? "needs_photo_replacement" : "everyday_verified",
      replaceable_by_shop: true,
      needs_image_replacement: needsReplacement,
      vase_arrangement_verified: verifiedPhoto,
      image_verified: verifiedPhoto,
      pexels_photo_id: a.pexels_photo_id || null,
      sku: csv.SKU,
      style: a.style,
      color_palette: a.color_palette,
      palette: a.color_palette,
      container: a.container,
      vase: a.container,
      stem_count: stemCount(a.recipe),
      occasion: csv.Occasion,
      visual_notes: csv["Visual Notes"],
      image_prompt: csv["Image Prompt"],
      flowers_recipe: csv["Flowers / recipe"],
      mechanics: a.mechanics,
      tools: a.tools,
      foliage: a.foliage,
      instructions: a.instructions,
      why_it_works: a.why_it_works,
      batch,
    },
  };
}

/** Raw arrangement records (full production detail, all batches). */
export const EVERYDAY_FLORAL_ARRANGEMENTS = mergeArrangements();

/** Master catalog products for API + shop copy. */
export function getEverydayFloralLibraryCatalog() {
  return EVERYDAY_FLORAL_ARRANGEMENTS.map(toLibraryProduct);
}

export function getEverydayFloralLibraryById(id) {
  return getEverydayFloralLibraryCatalog().find((p) => p.id === id) || null;
}
