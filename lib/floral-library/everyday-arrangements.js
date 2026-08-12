/**
 * Florisyn Everyday Ultra-Realistic Floral Library — bundled JSON (Netlify-safe).
 * Do not use fs + fileURLToPath(import.meta.url) here; esbuild breaks __dirname in functions.
 */
import batch1 from "../../public/data/floral-library-everyday-50.json" with { type: "json" };
import batch2 from "../../public/data/floral-library-everyday-batch-2.json" with { type: "json" };
import { toLibraryProduct } from "./library-product-transform.js";

function mergeArrangements() {
  const merged = [...(batch1.arrangements || []), ...(batch2.arrangements || [])];
  const ids = merged.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate floral library arrangement ids across batches");
  }
  return merged;
}

/** Raw arrangement records (full production detail, all batches). */
export const EVERYDAY_FLORAL_ARRANGEMENTS = mergeArrangements();

/** Master catalog products for API + shop copy. */
export function getEverydayFloralLibraryCatalog() {
  return EVERYDAY_FLORAL_ARRANGEMENTS.map((a) =>
    toLibraryProduct(a, {
      source: "florisyn_everyday",
      categoryDefault: "Everyday",
      batchTag: `florisyn_everyday_batch_${a.batch ?? 1}`,
    })
  );
}

export function getEverydayFloralLibraryById(id) {
  return getEverydayFloralLibraryCatalog().find((p) => p.id === id) || null;
}
