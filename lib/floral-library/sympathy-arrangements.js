/**
 * Florisyn Sympathy Floral Library — bundled JSON (Netlify-safe).
 */
import batch from "../../public/data/floral-library-sympathy-10.json" with { type: "json" };
import { toLibraryProduct } from "./library-product-transform.js";

export const SYMPATHY_FLORAL_ARRANGEMENTS = batch.arrangements || [];

export function getSympathyFloralLibraryCatalog() {
  return SYMPATHY_FLORAL_ARRANGEMENTS.map((a) =>
    toLibraryProduct(a, {
      source: "florisyn_sympathy",
      categoryDefault: "Sympathy",
      batchTag: "florisyn_sympathy_batch",
    })
  );
}

export function getSympathyFloralLibraryById(id) {
  return getSympathyFloralLibraryCatalog().find((p) => p.id === id) || null;
}
