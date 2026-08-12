/**
 * Shared Floral Library product transform (Everyday + Sympathy batches).
 */
import {
  arrangementToCsvRow,
  hasValidVase,
  isBlockedImageSubject,
  shouldHideFromPublicLibrary,
  stemCount,
} from "./csv-standard.js";

const ULTRA_REALISTIC_IMAGE_STANDARD = "ultra_realistic_professional_floral_photography";

export function libraryImageUrl(a, contentHash) {
  const base = `/assets/floral-library/${a.image}`;
  return contentHash ? `${base}?v=${contentHash}` : base;
}

export function resolveNeedsReplacement(a) {
  if (a.approved_placeholder && a.needs_image_replacement) return false;
  if (a.needs_image_replacement) return true;
  if (shouldHideFromPublicLibrary(a)) return true;
  if (!hasValidVase(a)) return true;
  if (isBlockedImageSubject(a)) return true;
  if (a.vase_arrangement_verified === false) return true;
  return false;
}

export function toLibraryProduct(a, { source, categoryDefault, batchTag }) {
  const retail = Number(a.suggested_retail);
  const batch = a.batch ?? 1;
  const needsReplacement = resolveNeedsReplacement(a);
  const verifiedPhoto = !needsReplacement;
  const isPlaceholder = Boolean(a.approved_placeholder && a.needs_image_replacement);
  const contentHash = a.content_sha256 ? String(a.content_sha256).slice(0, 16) : `h${a.id}`;
  const imageUrl = libraryImageUrl(a, contentHash);
  const licenseSource = a.image_license?.source || "bloom_owned";
  const csv = arrangementToCsvRow(a);
  const category = (a.categories || [categoryDefault])[0];
  return {
    id: a.id,
    scope: "master",
    source,
    name: a.name,
    sku: csv.SKU,
    categories: a.categories || [categoryDefault],
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
      attribution: `Florisyn ${category} Collection`,
      review_status: isPlaceholder ? "approved_placeholder" : "approved",
    },
    recipe: (a.recipe || []).map((r) => ({ name: r.name, qty: r.qty })),
    publish_status: "published",
    tags: verifiedPhoto
      ? [categoryDefault.toLowerCase(), "ultra_realistic", "vase_arrangement", a.style, batchTag]
      : [categoryDefault.toLowerCase(), "needs_photo", a.style, batchTag],
    csv,
    metadata: {
      image_standard: verifiedPhoto ? ULTRA_REALISTIC_IMAGE_STANDARD : null,
      launch_quality: isPlaceholder ? "sympathy_placeholder" : needsReplacement ? "needs_photo_replacement" : `${categoryDefault.toLowerCase()}_verified`,
      replaceable_by_shop: true,
      needs_image_replacement: Boolean(a.needs_image_replacement),
      approved_placeholder: Boolean(a.approved_placeholder),
      vase_arrangement_verified: a.vase_arrangement_verified !== false,
      image_verified: verifiedPhoto || isPlaceholder,
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
