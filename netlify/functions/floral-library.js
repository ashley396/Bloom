import { json, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { STARTER_FLORAL_LIBRARY, copyLibraryItemToShop, validateLibraryProduct } from "./_shared/floral-library-core.js";
import { getBloomFloristCatalog, BLOOM_RC2_CATALOG_SIZE } from "./_shared/floral-library-catalog.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const action = event.queryStringParameters?.action || "starter";
    if (action === "starter" && event.httpMethod === "GET") {
      const catalog = getBloomFloristCatalog(BLOOM_RC2_CATALOG_SIZE);
      return json(200, {
        products: catalog,
        count: catalog.length,
        note: "Bloom RC2 starter catalog — licensed stock; replace with your photography over time."
      });
    }

    if (event.httpMethod === "POST") {
      const ctx = await currentUser(event);
      const body = JSON.parse(event.body || "{}");
      if (body.action === "add_to_shop") {
        const master = getBloomFloristCatalog(BLOOM_RC2_CATALOG_SIZE).find((p) => p.id === body.master_id) || STARTER_FLORAL_LIBRARY.find((p) => p.id === body.master_id);
        if (!master) return json(404, { error: "Library item not found." });
        const copy = copyLibraryItemToShop(master, { shopId: ctx.shopId, overrides: body.overrides });
        return json(201, { product: copy });
      }
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
