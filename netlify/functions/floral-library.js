import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser, fail, admin as createServiceRoleClient } from "./_shared/supabase.js";
import { getEverydayFloralLibraryCatalog, copyLibraryItemToShop, validateLibraryProduct, getPublicFloralLibraryCatalog } from "./_shared/floral-library-core.js";
import { getBloomFloristCatalog, BLOOM_RC2_CATALOG_SIZE } from "./_shared/floral-library-catalog.js";
import { fetchAdminLibraryPhotos } from "./_shared/platform-library-photos.js";

/** Test seam — production uses bound real dependencies via exported `handler`. */
export function createFloralLibraryHandler(deps = {}) {
  return async function handler(event) {
    const ready = preflight(event);
    if (ready) return ready;

    try {
      const action = event.queryStringParameters?.action || "starter";
      if (action === "starter" && event.httpMethod === "GET") {
        const staticCatalog = getPublicFloralLibraryCatalog();
        // Real photos a platform admin added from the admin console
        // (see admin-photo-manager.js) sit alongside the static catalog —
        // additive only, never able to hide or replace it. Degrades to []
        // on any failure, so an admin-content hiccup can't take down the
        // whole Floral Library.
        let adminItems = [];
        try {
          const buildServerClient = deps.createServerClient || createServiceRoleClient;
          adminItems = await fetchAdminLibraryPhotos(buildServerClient(), "floral_library");
        } catch {
          adminItems = [];
        }
        const catalog = [...adminItems, ...staticCatalog];
        return json(200, {
          products: catalog,
          count: catalog.length,
          note: "Florisyn Ultra-Realistic Collection — Everyday plus Funeral, Sympathy, Wedding, Birthday, Congratulations, Get Well, Hydrangeas, Love & Romance, New Baby, and Plants."
        });
      }

      if (action === "expanded" && event.httpMethod === "GET") {
        const catalog = getBloomFloristCatalog(BLOOM_RC2_CATALOG_SIZE);
        return json(200, { products: catalog, count: catalog.length, note: "Expanded licensed starter grid for admin review." });
      }

      if (event.httpMethod === "POST") {
        const ctx = await currentUser(event);
        const body = bodyOf(event);
        if (body.action === "add_to_shop") {
          let master =
            getPublicFloralLibraryCatalog().find((p) => p.id === body.master_id) ||
            getEverydayFloralLibraryCatalog().find((p) => p.id === body.master_id);
          if (!master && String(body.master_id || "").startsWith("admin-")) {
            const buildServerClient = deps.createServerClient || createServiceRoleClient;
            const adminItems = await fetchAdminLibraryPhotos(buildServerClient(), "floral_library");
            master = adminItems.find((p) => p.id === body.master_id);
          }
          if (!master) return json(404, { error: "Library item not found." });
          const copy = copyLibraryItemToShop(master, { shopId: ctx.shopId, overrides: body.overrides });
          return json(201, { product: copy });
        }
      }

      return methodNotAllowed();
    } catch (error) {
      return fail(error);
    }
  };
}

export const handler = createFloralLibraryHandler();
