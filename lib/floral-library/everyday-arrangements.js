/**
 * Florisyn Everyday Ultra-Realistic Floral Library — bundled JSON (Netlify-safe).
 * Do not use fs + fileURLToPath(import.meta.url) here; esbuild breaks __dirname in functions.
 */
import batch1 from "../../public/data/floral-library-everyday-50.json" with { type: "json" };
import batch2 from "../../public/data/floral-library-everyday-batch-2.json" with { type: "json" };

const ULTRA_REALISTIC_IMAGE_STANDARD = "ultra_realistic_professional_floral_photography";

const PEXELS_IMAGE_FALLBACKS_BY_ID = Object.freeze({
  "ed-02-pink-meadow": "1070850",
  "ed-03-classic-rose-mix": "2111192",
  "ed-04-cheerful-daisy-burst": "169193",
  "ed-07-rustic-mason-jar-mix": "1308881",
  "ed-09-simple-whites": "459335",
  "ed-11-morning-cheer": "54200",
  "ed-12-fresh-start": "736230",
  "ed-13-daily-delight": "2873966",
});

function mergeArrangements() {
  const merged = [...(batch1.arrangements || []), ...(batch2.arrangements || [])];
  const ids = merged.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate floral library arrangement ids across batches");
  }
  return merged;
}

function pexelsImageUrl(photoId) {
  const id = String(photoId || "").trim();
  if (!id) return "";
  return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
}

function resolvedPexelsPhotoId(a) {
  return a.pexels_photo_id || PEXELS_IMAGE_FALLBACKS_BY_ID[a.id] || null;
}

function visibleImageUrl(a) {
  if (a.image_url) return a.image_url;
  const photoId = resolvedPexelsPhotoId(a);
  if (photoId && !a.needs_image_replacement) return pexelsImageUrl(photoId);
  return `/assets/floral-library/${a.image}`;
}

function toLibraryProduct(a) {
  const retail = Number(a.suggested_retail);
  const batch = a.batch ?? 1;
  const needsReplacement = Boolean(a.needs_image_replacement);
  const verifiedPhoto = !needsReplacement;
  const imageUrl = visibleImageUrl(a);
  const pexelsPhotoId = resolvedPexelsPhotoId(a);
  const contentHash = a.content_sha256 ? String(a.content_sha256).slice(0, 16) : `h${a.id}`;
  const licenseSource = a.image_license?.source || (pexelsPhotoId ? "licensed_stock_pexels" : "bloom_owned");
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
      max: Math.round(retail * 1.2 * 100) / 100,
    },
    suggested_cost: Math.round(retail * 0.42 * 100) / 100,
    primary_image: {
      url: imageUrl,
      alt: a.alt || (verifiedPhoto
        ? `${a.name} everyday floral arrangement photograph`
        : `${a.name} — photo replacement pending`),
      hash: contentHash,
    },
    image_license: a.image_license || {
      source: licenseSource,
      attribution: pexelsPhotoId
        ? `Pexels — verified vase/bouquet arrangement (photo ${pexelsPhotoId})`
        : `Florisyn Everyday Collection — batch ${batch}`,
      review_status: "approved",
    },
    recipe: (a.recipe || []).map((r) => ({ name: r.name, qty: r.qty })),
    publish_status: "published",
    tags: verifiedPhoto
      ? ["everyday", "ultra_realistic", a.style, `florisyn_everyday_batch_${batch}`]
      : ["everyday", "needs_photo", a.style, `florisyn_everyday_batch_${batch}`],
    metadata: {
      image_standard: verifiedPhoto ? ULTRA_REALISTIC_IMAGE_STANDARD : null,
      launch_quality: needsReplacement ? "needs_photo_replacement" : "everyday_verified",
      replaceable_by_shop: true,
      needs_image_replacement: needsReplacement,
      pexels_photo_id: pexelsPhotoId,
      style: a.style,
      color_palette: a.color_palette,
      container: a.container,
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
