import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { normalizeMarketplaceCategory, MARKETPLACE_CATEGORIES } from "./_shared/marketplace-categories.js";
import { canBrowseListing } from "./_shared/marketplace-products.js";

const LISTINGS = "marketplace_listings";
const IMAGES = "marketplace_listing_images";
const FAVORITES = "marketplace_favorites";
const SELLER_PROFILES = "marketplace_seller_profiles";

function isMissingTableError(error) {
  if (!error) return false;
  const message = String(error.message || error.details || "").toLowerCase();
  const code = String(error.code || "");
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("could not find the table");
}

function sanitizeListing(row) {
  if (!row) return null;
  const category = normalizeMarketplaceCategory(row.category_slug || row.category);
  return {
    id: row.id,
    shop_id: row.shop_id,
    supplier_name: row.supplier_name,
    product_name: row.product_name,
    category: category.label,
    category_slug: category.slug,
    category_legacy: category.legacy,
    unit: row.unit,
    price: row.price,
    minimum_quantity: row.minimum_quantity,
    available_quantity: row.available_quantity,
    image_url: row.image_url,
    description: row.description || "",
    delivery_notes: row.delivery_notes,
    allows_shipping: row.allows_shipping !== false,
    allows_local_pickup: Boolean(row.allows_local_pickup),
    active: row.active !== false,
    low_stock: Number(row.available_quantity ?? 0) <= Number(row.low_stock_threshold ?? 5)
  };
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const { client, user } = await currentUser(event);
    const params = event.queryStringParameters || {};

    if (event.httpMethod === "GET") {
      if (params.resource === "categories") {
        return json(200, { categories: MARKETPLACE_CATEGORIES });
      }

      let query = client
        .from(LISTINGS)
        .select("*")
        .eq("active", true)
        .is("archived_at", null)
        .order("created_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      let items = (data || []).map(sanitizeListing).filter((row) => canBrowseListing(row, { previewAllowed: false }));

      const q = String(params.q || "").trim().toLowerCase();
      if (q) {
        items = items.filter((item) =>
          [item.product_name, item.supplier_name, item.category, item.description]
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
      }

      const categoryFilter = params.category || "";
      if (categoryFilter) {
        const normalized = normalizeMarketplaceCategory(categoryFilter);
        items = items.filter((item) =>
          item.category_slug === normalized.slug || item.category?.toLowerCase() === String(categoryFilter).toLowerCase()
        );
      }

      const sellerFilter = params.seller || "";
      if (sellerFilter) {
        items = items.filter(
          (item) =>
            item.shop_id === sellerFilter
            || item.supplier_name?.toLowerCase().includes(sellerFilter.toLowerCase())
        );
      }

      const minPrice = params.minPrice != null && params.minPrice !== "" ? Number(params.minPrice) : null;
      const maxPrice = params.maxPrice != null && params.maxPrice !== "" ? Number(params.maxPrice) : null;
      if (minPrice != null && !Number.isNaN(minPrice)) {
        items = items.filter((item) => Number(item.price) >= minPrice);
      }
      if (maxPrice != null && !Number.isNaN(maxPrice)) {
        items = items.filter((item) => Number(item.price) <= maxPrice);
      }

      if (params.inStock === "true") {
        items = items.filter((item) => Number(item.available_quantity ?? 0) > 0);
      }

      if (params.shipping === "shipping") {
        items = items.filter((item) => item.allows_shipping);
      }
      if (params.shipping === "pickup") {
        items = items.filter((item) => item.allows_local_pickup);
      }

      let favorites = [];
      try {
        const favResult = await client.from(FAVORITES).select("listing_id").eq("user_id", user.id);
        if (!favResult.error) favorites = (favResult.data || []).map((row) => row.listing_id);
      } catch {
        favorites = [];
      }

      items = items.map((item) => ({ ...item, favorited: favorites.includes(item.id) }));

      if (params.listingId) {
        const listing = items.find((item) => item.id === params.listingId) || sanitizeListing((data || []).find((row) => row.id === params.listingId));
        const related = listing
          ? items
            .filter((item) => item.id !== listing.id && (item.category_slug === listing.category_slug || item.shop_id === listing.shop_id))
            .slice(0, 6)
          : [];
        let seller = null;
        let gallery = [];
        if (listing?.shop_id) {
          const sellerResult = await client
            .from(SELLER_PROFILES)
            .select("shop_id, display_name, bio, website, verified_at, minimum_order_amount")
            .eq("shop_id", listing.shop_id)
            .maybeSingle();
          if (!sellerResult.error && sellerResult.data) {
            seller = sellerResult.data;
          }
          try {
            const imageResult = await client
              .from(IMAGES)
              .select("url, alt_text, sort_order")
              .eq("listing_id", listing.id)
              .order("sort_order", { ascending: true });
            if (!imageResult.error) gallery = imageResult.data || [];
          } catch {
            gallery = [];
          }
        }
        return json(200, { listing: { ...listing, images: gallery.length ? gallery : (listing.image_url ? [{ url: listing.image_url }] : []) }, related, seller, verified_seller: Boolean(seller?.verified_at) });
      }

      if (params.shopId) {
        const storefrontItems = items.filter((item) => item.shop_id === params.shopId);
        let seller = null;
        const sellerResult = await client
          .from(SELLER_PROFILES)
          .select("shop_id, display_name, bio, website, verified_at, minimum_order_amount")
          .eq("shop_id", params.shopId)
          .maybeSingle();
        if (!sellerResult.error) seller = sellerResult.data;
        return json(200, {
          items: storefrontItems,
          seller,
          verified_seller: Boolean(seller?.verified_at)
        });
      }

      return json(200, { items, favorites });
    }

    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      if (body.action === "favorite") {
        if (!body.listing_id) {
          return json(400, { error: "listing_id is required." });
        }
        const { data: listing, error: listingError } = await client
          .from(LISTINGS)
          .select("id, shop_id")
          .eq("id", body.listing_id)
          .maybeSingle();
        if (listingError) throw listingError;
        if (!listing) return json(404, { error: "Listing not found." });

        if (body.toggle === false) {
          await client.from(FAVORITES).delete().eq("user_id", user.id).eq("listing_id", body.listing_id);
          return json(200, { favorited: false });
        }

        const { error } = await client.from(FAVORITES).upsert(
          { user_id: user.id, listing_id: body.listing_id },
          { onConflict: "user_id,listing_id" }
        );
        if (error) {
          if (isMissingTableError(error)) {
            return json(503, { error: "Favorites are not available until the marketplace milestone migration is applied." });
          }
          throw error;
        }
        return json(200, { favorited: true });
      }
      return json(400, { error: "Unsupported action." });
    }

    return methodNotAllowed();
  } catch (error) {
    if (isMissingTableError(error)) {
      return json(503, { error: "Marketplace catalog features require the marketplace milestone migration." });
    }
    return fail(error);
  }
}
