/** Bloom RC2 — website starter catalog seed (does not overwrite existing products). */

import { getBloomFloristCatalog } from "./floral-library-catalog.js";
import { copyLibraryItemToShop } from "./floral-library-core.js";

export function buildWebsiteCatalogSeeds(shopId, { maxItems = 48 } = {}) {
  const catalog = getBloomFloristCatalog(maxItems);
  return catalog.map((master) =>
    copyLibraryItemToShop(master, {
      shopId,
      overrides: {
        publish_status: "published",
        available_online: true
      }
    })
  );
}

export function shouldSeedWebsiteCatalog(existingCount) {
  return Number(existingCount || 0) === 0;
}
