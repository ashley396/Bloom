/** Bloom RC1.1 — admin floral library import & quality (pure). */

import {
  validateLibraryProduct,
  detectDuplicateImageHash,
  assertMasterLibraryImmutable,
  STARTER_FLORAL_LIBRARY,
  LIBRARY_CATEGORIES,
  IMAGE_LICENSE_SOURCES
} from "./floral-library-core.js";

export { assertMasterLibraryImmutable, IMAGE_LICENSE_SOURCES, LIBRARY_CATEGORIES };

export function parseImportManifest(rows = []) {
  const report = {
    valid: [],
    invalid: [],
    duplicate_names: [],
    duplicate_images: [],
    missing_fields: [],
    invalid_license: []
  };
  const seenNames = new Map();
  const catalog = [...STARTER_FLORAL_LIBRARY];
  for (const row of rows) {
    const product = manifestRowToProduct(row);
    const validation = validateLibraryProduct(product);
    if (!validation.valid) {
      report.invalid.push({ row, errors: validation.errors });
      if (validation.errors.some((e) => /license/i.test(e))) report.invalid_license.push(row);
      report.missing_fields.push({ id: row.product_id || row.id, errors: validation.errors });
      continue;
    }
    const nameKey = String(product.name || "").toLowerCase();
    if (seenNames.has(nameKey)) report.duplicate_names.push({ name: product.name, ids: [seenNames.get(nameKey), product.id] });
    else seenNames.set(nameKey, product.id);
    const dupes = detectDuplicateImageHash(catalog, product.primary_image?.hash);
    if (dupes.length) report.duplicate_images.push({ id: product.id, hash: product.primary_image?.hash, matches: dupes });
    report.valid.push(product);
  }
  return report;
}

function manifestRowToProduct(row) {
  return {
    id: row.product_id || row.id,
    name: row.product_name || row.name,
    categories: row.categories ? String(row.categories).split("|").map((s) => s.trim()) : [row.category].filter(Boolean),
    description: row.description,
    short_description: row.short_description,
    primary_image: {
      url: row.image_url,
      alt: row.alt_text || row.product_name,
      hash: row.image_hash || simpleHash(row.image_url)
    },
    image_license: {
      source: row.license_source,
      attribution: row.attribution,
      review_status: row.review_status || "pending"
    },
    recipe: parseRecipe(row.recipe),
    suggested_retail: { default: Number(row.retail_price || row.price || 0) },
    seo_title: row.seo_title,
    seo_description: row.seo_description
  };
}

function parseRecipe(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(";")
    .map((part) => {
      const [name, qty] = part.split(":").map((s) => s.trim());
      return name ? { name, qty: Number(qty || 1) } : null;
    })
    .filter(Boolean);
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
  return `h${h.toString(16)}`;
}

export function dryRunImport(rows) {
  const report = parseImportManifest(rows);
  return { dry_run: true, ...report, counts: { valid: report.valid.length, invalid: report.invalid.length } };
}

export function approveImportBatch(batch, { approveIds = [], rejectIds = [] } = {}) {
  const approved = batch.manifest.filter((r) => approveIds.includes(r.product_id || r.id));
  const rejected = batch.manifest.filter((r) => rejectIds.includes(r.product_id || r.id));
  const pending = batch.manifest.filter((r) => !approveIds.includes(r.product_id || r.id) && !rejectIds.includes(r.product_id || r.id));
  return {
    status: pending.length ? "partial" : approved.length ? "approved" : "rejected",
    approved,
    rejected,
    pending,
    audit: { at: new Date().toISOString(), approved: approved.length, rejected: rejected.length }
  };
}

export function duplicateReviewQueue(items = [], catalog = STARTER_FLORAL_LIBRARY) {
  return items.map((item) => ({
    id: item.id || item.batch_id,
    incoming: item.incoming_image,
    existing: item.existing_image,
    hash: item.hash,
    reason: item.reason || "hash_match",
    products: detectDuplicateImageHash(catalog, item.hash),
    license: item.license,
    status: item.status || "pending"
  }));
}

export function duplicateReviewAction(queueItem, action, note = "") {
  const allowed = ["confirm_duplicate", "acceptable_alternate", "replace_image", "reject", "return_correction", "approve_note"];
  if (!allowed.includes(action)) return { ok: false, error: "Unknown review action." };
  return {
    ok: true,
    item: { ...queueItem, status: action, review_note: note, reviewed_at: new Date().toISOString() },
    audit: { action, note, at: new Date().toISOString() }
  };
}

export function libraryQualityDashboard(products = STARTER_FLORAL_LIBRARY) {
  const stats = {
    total: products.length,
    approved: 0,
    draft: 0,
    needs_review: 0,
    rejected: 0,
    missing_recipe: 0,
    missing_alt: 0,
    missing_seo: 0,
    missing_license: 0,
    suspected_duplicate_image: 0,
    categories: new Set(),
    flower_types: new Set()
  };
  const hashes = new Map();
  for (const p of products) {
    const rs = p.image_license?.review_status || p.review_status || "approved_starter";
    if (rs === "approved" || rs === "approved_starter") stats.approved += 1;
    else if (rs === "rejected") stats.rejected += 1;
    else if (rs === "pending") stats.needs_review += 1;
    else stats.draft += 1;
    if (!p.recipe?.length) stats.missing_recipe += 1;
    if (!p.primary_image?.alt) stats.missing_alt += 1;
    if (!p.seo_title && !p.seo_description) stats.missing_seo += 1;
    if (!p.image_license?.source) stats.missing_license += 1;
    (p.categories || []).forEach((c) => stats.categories.add(c));
    (p.recipe || []).forEach((r) => stats.flower_types.add(r.name));
    const h = p.primary_image?.hash;
    if (h) {
      if (hashes.has(h)) stats.suspected_duplicate_image += 1;
      else hashes.set(h, p.id);
    }
  }
  return {
    ...stats,
    category_coverage: stats.categories.size,
    flower_type_coverage: stats.flower_types.size,
    seasonal_coverage: [...stats.categories].filter((c) => /valentine|christmas|easter|mother|thanksgiving/i.test(c)).length
  };
}

export function lilyLibrarySuggestionRequiresApproval() {
  return { requiresApproval: true, canWriteMaster: false };
}

export function parseCsvImport(text) {
  const lines = String(text || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}
