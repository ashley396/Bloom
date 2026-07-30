/** Florisyn — licensed starter floral catalog (450 ultra-realistic florist arrangements). */

import {
  generateFloristCatalog,
  FLORIST_CATALOG_SIZE,
  FLORIST_CATALOG_TIERS,
} from "./floral-catalog-generator.js";

let cachedCatalog = null;

function getCachedCatalog() {
  if (!cachedCatalog) cachedCatalog = generateFloristCatalog(FLORIST_CATALOG_SIZE);
  return cachedCatalog;
}

/** @param {number} [count] Max arrangements to return (default full catalog). */
export function getBloomFloristCatalog(count = FLORIST_CATALOG_SIZE) {
  const catalog = getCachedCatalog();
  const n = Math.max(1, Math.min(FLORIST_CATALOG_SIZE, count));
  return catalog.slice(0, n);
}

export const BLOOM_RC2_CATALOG_SIZE = FLORIST_CATALOG_SIZE;
export { FLORIST_CATALOG_TIERS };
