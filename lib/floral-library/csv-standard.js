/**
 * Florisyn Floral Library CSV standard (Everyday vase arrangements).
 * Required columns: SKU, Name, Style, Category, Occasion, Vase, Stem Count,
 * Flowers / recipe, Palette, Visual Notes, Image Prompt, Price.
 */

export const FLORAL_LIBRARY_CSV_COLUMNS = [
  "SKU",
  "Name",
  "Style",
  "Category",
  "Occasion",
  "Vase",
  "Stem Count",
  "Flowers / recipe",
  "Palette",
  "Visual Notes",
  "Image Prompt",
  "Price",
];

const BLOCKED_IMAGE =
  /pexels|computer|gaming|landscape|waterfall|person|model|portrait|single-stem|single-rose|hand-tie(?! in jar)|no-vase|loose.?stem|flat.?lay|market.?stall|cake|food subject|winter portrait|cut stems on paper/i;
const NO_VASE = /no vase|hand-tie wrap|wrap \(no|without vase|no container/i;
const VASE_PATTERN = /vase|jar|cube|cylinder|ceramic|pot|urn|compote|bubble bowl|hat.?box/i;
export const APPROVED_SYMPATHY_PLACEHOLDER = "/assets/floral-library/sympathy/approved-vase-placeholder.jpg";

export function stemCount(recipe) {
  return (recipe || []).reduce((s, r) => s + Number(r.qty || 0), 0);
}

export function flowersRecipe(recipe) {
  return (recipe || []).map((r) => `${r.qty} ${r.name}`).join("; ");
}

export function buildImagePrompt(a) {
  const vase = a.container || "glass vase";
  const palette = a.color_palette || "";
  const style = a.style || "everyday";
  return `Ultra-realistic professional product photograph of ${a.name}, finished ${style} floral arrangement in ${vase}, ${palette} palette, centered composition, clean white studio background, completed vase arrangement, no people, no landscapes, no computers, no tools, no loose stems only, no hand-tie without vase`;
}

export function arrangementToCsvRow(a) {
  return {
    SKU: a.sku || String(a.id || "").toUpperCase(),
    Name: a.name,
    Style: a.style,
    Category: (a.categories || ["Everyday"])[0],
    Occasion: a.occasion || (a.categories || ["Everyday"])[0],
    Vase: a.container,
    "Stem Count": stemCount(a.recipe),
    "Flowers / recipe": flowersRecipe(a.recipe),
    Palette: a.color_palette,
    "Visual Notes": a.visual_notes || a.why_it_works || "",
    "Image Prompt": a.image_prompt || buildImagePrompt(a),
    Price: a.suggested_retail,
  };
}

export function hasValidVase(a) {
  const vase = String(a?.container || a?.metadata?.container || "").trim();
  if (!vase) return false;
  if (NO_VASE.test(vase)) return false;
  return VASE_PATTERN.test(vase);
}

export function isBlockedImageSubject(a, url = "") {
  const u = String(url || a?.image || a?.primary_image?.url || "");
  const alt = String(a?.alt || a?.primary_image?.alt || "");
  const subj = String(a?.image_subject || "");
  if (BLOCKED_IMAGE.test(u) || BLOCKED_IMAGE.test(alt)) return true;
  if (subj && subj !== "floral_arrangement") return true;
  return false;
}

export function shouldHideFromPublicLibrary(a) {
  if (a?.needs_image_replacement) return true;
  if (!hasValidVase(a)) return true;
  if (isBlockedImageSubject(a)) return true;
  if (a?.vase_arrangement_verified === false) return true;
  return false;
}

export function hasApprovedPlaceholderImage(product) {
  const url = String(product?.primary_image?.url || product?.image || "");
  return (
    product?.metadata?.approved_placeholder === true &&
    url.includes("approved-vase-placeholder")
  );
}

export function isSympathyCategory(product) {
  return (product?.categories || []).includes("Sympathy");
}

export function isPublicSympathyArrangement(product) {
  if (!isSympathyCategory(product)) return false;
  if (!product?.metadata?.vase_arrangement_verified) return false;
  if (!hasValidVase({ container: product.metadata?.container })) return false;
  if (NO_VASE.test(String(product.metadata?.vase || product.metadata?.container || ""))) return false;
  if (isBlockedImageSubject(product)) return false;
  if (product.metadata?.needs_image_replacement && !product.metadata?.approved_placeholder) return false;
  if (product.metadata?.image_verified === false && !product.metadata?.approved_placeholder) return false;
  if (hasApprovedPlaceholderImage(product)) return true;
  return !product.metadata?.needs_image_replacement;
}

export function isPublicFloralLibraryProduct(product) {
  if (isSympathyCategory(product)) return isPublicSympathyArrangement(product);
  return isPublicVaseArrangement(product);
}

export function isPublicVaseArrangement(product) {
  if (!product?.metadata?.vase_arrangement_verified) return false;
  if (product.metadata?.needs_image_replacement) return false;
  if (product.metadata?.launch_quality === "needs_photo_replacement") return false;
  if (product.metadata?.image_verified === false) return false;
  if (!hasValidVase({ container: product.metadata?.container })) return false;
  return true;
}

export function validateCsvStandardArrangement(a) {
  const errors = [];
  const row = arrangementToCsvRow(a);
  for (const col of FLORAL_LIBRARY_CSV_COLUMNS) {
    const val = row[col];
    if (val === "" || val == null || (col === "Stem Count" && Number(val) <= 0)) {
      errors.push(`Missing ${col}`);
    }
  }
  if (!hasValidVase(a)) errors.push("Missing or invalid Vase");
  if (NO_VASE.test(String(a.container || ""))) errors.push('Vase must not say "no vase"');
  if (isBlockedImageSubject(a)) errors.push("Image not vase-arrangement verified");
  return { valid: errors.length === 0, errors, row };
}
