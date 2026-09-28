/**
 * Phase A-1 / A-1c (2026-09-28): the ONE reader of a shop's online products.
 * Every public storefront surface (site JSON, sitemap, web checkout's cart
 * reconciliation) AND Website Studio's publish checklist go through this, so
 * "what the checklist counts" can never drift from "what customers can buy".
 *
 * A legacy `products` row is public only when ALL of:
 *   - available_online = true   (the column is NOT NULL DEFAULT false — the
 *                                 old code tested a non-existent `show_online`
 *                                 column, so every product read as public)
 *   - active <> false           (inactive → "draft" → hidden by
 *                                 productVisibleOnPublicSite)
 *   - deleted_at IS NULL        (soft-deleted rows were never excluded)
 *   - shop_id = this shop       (query-scoped; never trust the caller)
 */

import { filterPublicProducts, mergeCatalogProducts } from "./bloom-storefront-core.js";

function missingTable(e) {
  // 42P01 from Postgres; PGRST205 is how newer PostgREST reports an unknown table.
  return e?.code === "42P01" || e?.code === "PGRST205";
}

export function legacyProductIsPublic(p) {
  return Boolean(p) && p.available_online === true && p.active !== false && p.deleted_at == null;
}

export async function loadPublicProducts(client, shopId) {
  const legacy = [];
  try {
    const { data, error } = await client
      .from("products")
      .select("*")
      .eq("shop_id", shopId)
      .is("deleted_at", null);
    if (error) throw error;
    (data || []).forEach((p) => {
      // Defensive re-check in code: the query already excludes deleted rows
      // and scopes the shop, but the visibility contract is enforced here
      // too so a looser query can never widen what the storefront exposes.
      if (String(p.shop_id) !== String(shopId) || p.deleted_at != null) return;
      legacy.push({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        image_url: p.image_url,
        categories: p.category ? [p.category] : [],
        // A-1c: products.taxable (NOT NULL DEFAULT true) drives web-order tax.
        taxable: p.taxable !== false,
        publish_status: p.active === false ? "draft" : "published",
        sync: { available_online: legacyProductIsPublic(p), show_price_online: true }
      });
    });
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
  let catalog = [];
  try {
    const { data, error } = await client.from("bloom_shop_catalog_products").select("*").eq("shop_id", shopId);
    if (error) throw error;
    catalog = data || [];
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
  return mergeCatalogProducts(catalog, legacy);
}

/** Exactly the products a customer can see and buy on the shop's storefront. */
export async function loadStorefrontVisibleProducts(client, shopId, filters) {
  return filterPublicProducts(await loadPublicProducts(client, shopId), filters);
}
