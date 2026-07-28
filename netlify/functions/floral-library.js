import { json, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { STARTER_FLORAL_LIBRARY, copyLibraryItemToShop, validateLibraryProduct } from "./_shared/floral-library-core.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const action = event.queryStringParameters?.action || "starter";
    if (action === "starter" && event.httpMethod === "GET") {
      return json(200, { products: STARTER_FLORAL_LIBRARY, note: "Starter collection — expand via import manifest." });
    }

    if (event.httpMethod === "POST") {
      const ctx = await currentUser(event);
      const body = JSON.parse(event.body || "{}");
      if (body.action === "add_to_shop") {
        const master = STARTER_FLORAL_LIBRARY.find((p) => p.id === body.master_id);
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
