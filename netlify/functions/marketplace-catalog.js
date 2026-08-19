import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { normalizeMarketplaceCategory, MARKETPLACE_CATEGORIES } from "./_shared/marketplace-categories.js";
import { canBrowseListing, resolveDisplayPrice, isCurrentlyAvailable, availabilityStatusLabel } from "./_shared/marketplace-products.js";
import { matchRecipeToInventory } from "../../lib/floral-library/recipe-intelligence.js";
import { shopDateStr } from "./_shared/shop-time.js";

const LISTINGS = "marketplace_listings";
const IMAGES = "marketplace_listing_images";
const FAVORITES = "marketplace_favorites";
const SELLER_PROFILES = "marketplace_seller_profiles";
const ORDERS = "marketplace_wholesale_orders";
const INVENTORY = "inventory";

const RECEIVABLE_ORDER_STATUSES = ["paid", "fulfilled", "completed"];

// The full wholesaler storefront profile a buyer sees (Marketplace vision:
// WHOLESALER STOREFRONTS) — location, delivery/pickup, ordering policy,
// contact, and which of the seller's own listings they've chosen to
// feature. Kept as one constant so the two places a buyer can reach a
// seller profile (a listing's detail panel, and the storefront view
// itself) never silently drift out of sync.
const SELLER_PROFILE_FIELDS =
  "shop_id, display_name, bio, website, verified_at, minimum_order_amount, " +
  "location_city, location_state, location_country, delivery_area, delivery_radius_miles, " +
  "pickup_available, pickup_address, pickup_hours, ordering_policy, order_deadline_note, " +
  "contact_email, contact_phone, featured_listing_ids";

function isMissingTableError(error) {
  if (!error) return false;
  const message = String(error.message || error.details || "").toLowerCase();
  const code = String(error.code || "");
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("could not find the table");
}

function sanitizeListing(row) {
  if (!row) return null;
  const category = normalizeMarketplaceCategory(row.category_slug || row.category);
  const display = resolveDisplayPrice(row);
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
    low_stock: Number(row.available_quantity ?? 0) <= Number(row.low_stock_threshold ?? 5),
    // Floral-specific wholesale attributes (Marketplace vision phase 1).
    variety: row.variety || "",
    color: row.color || "",
    stem_length_in: row.stem_length_in ?? null,
    grade: row.grade || "",
    grower_name: row.grower_name || "",
    origin: row.origin || "",
    stems_per_bunch: row.stems_per_bunch ?? null,
    bunches_per_box: row.bunches_per_box ?? null,
    case_quantity: row.case_quantity ?? null,
    display_price: display.price,
    display_price_unit: display.unit,
    unit_prices: [
      row.price_per_stem != null ? { unit: "stem", price: Number(row.price_per_stem) } : null,
      row.price_per_bunch != null ? { unit: "bunch", price: Number(row.price_per_bunch) } : null,
      row.price_per_box != null ? { unit: "box", price: Number(row.price_per_box) } : null,
      row.price_per_case != null ? { unit: "case", price: Number(row.price_per_case) } : null
    ].filter(Boolean),
    availability_status: row.availability_status || "available_now",
    availability_label: availabilityStatusLabel(row.availability_status),
    currently_available: isCurrentlyAvailable(row),
    available_from: row.available_from || null,
    available_until: row.available_until || null,
    seasonal_months: row.seasonal_months || null,
    lead_time_days: row.lead_time_days ?? null,
    delivery_region: row.delivery_region || "",
    pickup_city: row.pickup_city || "",
    pickup_state: row.pickup_state || "",
    substitution_note: row.substitution_note || ""
  };
}

/**
 * The florist's own wholesale purchase history — this is the read side of
 * the "bring what you just bought into your Florisyn inventory with
 * minimal manual entry" ecosystem hook from the marketplace vision.
 * Scoped to orders this user actually placed (buyer_user_id), matching
 * the "marketplace wholesale orders buyer read" RLS policy.
 */
async function loadBuyerOrders(client, user, shopId) {
  const { data: orders, error } = await client
    .from(ORDERS)
    .select("*")
    .eq("buyer_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const sellerIds = [...new Set((orders || []).map((o) => o.seller_shop_id).filter(Boolean))];
  let sellerNames = {};
  if (sellerIds.length) {
    const { data: sellers } = await client
      .from(SELLER_PROFILES)
      .select("shop_id, display_name")
      .in("shop_id", sellerIds);
    sellerNames = Object.fromEntries((sellers || []).map((s) => [s.shop_id, s.display_name]));
  }

  let shopInventory = [];
  if (shopId) {
    const { data: inv } = await client.from(INVENTORY).select("id, name, cost").eq("shop_id", shopId).is("deleted_at", null);
    shopInventory = inv || [];
  }

  const enriched = (orders || []).map((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const canReceive = RECEIVABLE_ORDER_STATUSES.includes(order.status) && !order.inventory_synced_at;
    const preview = canReceive ? matchRecipeToInventory(items, shopInventory) : null;
    return {
      ...order,
      seller_display_name: sellerNames[order.seller_shop_id] || null,
      can_receive: canReceive,
      inventory_preview: preview ? preview.recipe : null
    };
  });

  return { orders: enriched };
}

/**
 * A florist explicitly confirming "yes, bring what I bought into my
 * inventory" — never automatic, and never re-appliable once synced.
 * Reuses the same name-match-against-shop-inventory logic Community
 * Step 67 uses for recipe imports, rather than a second parallel matcher.
 */
async function receiveOrderIntoInventory(client, user, shopId, orderId) {
  if (!shopId) {
    const error = new Error("A shop is required to receive a wholesale order into inventory.");
    error.statusCode = 400;
    throw error;
  }
  const { data: order, error: orderError } = await client.from(ORDERS).select("*").eq("id", orderId).maybeSingle();
  if (orderError) throw orderError;
  if (!order || order.buyer_user_id !== user.id) {
    const error = new Error("Order not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!RECEIVABLE_ORDER_STATUSES.includes(order.status)) {
    const error = new Error("This order hasn't been paid yet — nothing to receive.");
    error.statusCode = 409;
    throw error;
  }
  if (order.inventory_synced_at) {
    const error = new Error("This order was already added to inventory.");
    error.statusCode = 409;
    throw error;
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const { data: inv, error: invError } = await client.from(INVENTORY).select("id, name, quantity, cost").eq("shop_id", shopId).is("deleted_at", null);
  if (invError) throw invError;

  let sellerName = null;
  if (order.seller_shop_id) {
    const { data: seller } = await client.from(SELLER_PROFILES).select("display_name").eq("shop_id", order.seller_shop_id).maybeSingle();
    sellerName = seller?.display_name || null;
  }

  const { recipe: matched } = matchRecipeToInventory(items, inv || []);
  const invById = new Map((inv || []).map((row) => [row.id, row]));
  const { data: shopRow } = await client.from("shops").select("timezone").eq("id", shopId).maybeSingle();
  const today = shopDateStr(shopRow?.timezone);
  let matchedCount = 0;
  let createdCount = 0;

  for (const row of matched) {
    const receivedQty = Math.max(0, Number(row.qty ?? row.quantity ?? 0));
    if (!receivedQty) continue;
    if (row.matched && row.matched_inventory_id) {
      const existing = invById.get(row.matched_inventory_id);
      const { error: updateError } = await client
        .from(INVENTORY)
        .update({ quantity: Number(existing?.quantity || 0) + receivedQty })
        .eq("id", row.matched_inventory_id)
        .eq("shop_id", shopId);
      if (updateError) throw updateError;
      matchedCount += 1;
    } else {
      const { error: insertError } = await client.from(INVENTORY).insert({
        shop_id: shopId,
        name: row.name,
        category: "Flowers",
        quantity: receivedQty,
        unit: row.unit || "each",
        cost: Number(row.unit_price ?? row.price ?? 0),
        supplier: sellerName,
        received_at: today
      });
      if (insertError) throw insertError;
      createdCount += 1;
    }
  }

  const now = new Date().toISOString();
  const { error: orderUpdateError } = await client
    .from(ORDERS)
    .update({ inventory_synced_at: now, received_at: order.received_at || now })
    .eq("id", orderId);
  if (orderUpdateError) throw orderUpdateError;

  return { order_id: orderId, matched_count: matchedCount, created_count: createdCount };
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const { client, user, shopId } = await currentUser(event);
    const params = event.queryStringParameters || {};

    if (event.httpMethod === "GET") {
      if (params.resource === "categories") {
        return json(200, { categories: MARKETPLACE_CATEGORIES });
      }

      if (params.resource === "my-orders") {
        return json(200, await loadBuyerOrders(client, user, shopId));
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
          [item.product_name, item.supplier_name, item.category, item.description, item.variety, item.color, item.grower_name, item.origin]
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
      }

      const varietyFilter = String(params.variety || "").trim().toLowerCase();
      if (varietyFilter) {
        items = items.filter((item) => item.variety?.toLowerCase().includes(varietyFilter));
      }

      const colorFilter = String(params.color || "").trim().toLowerCase();
      if (colorFilter) {
        items = items.filter((item) => item.color?.toLowerCase() === colorFilter);
      }

      const growerFilter = String(params.grower || "").trim().toLowerCase();
      if (growerFilter) {
        items = items.filter((item) => item.grower_name?.toLowerCase().includes(growerFilter));
      }

      const originFilter = String(params.origin || "").trim().toLowerCase();
      if (originFilter) {
        items = items.filter((item) => item.origin?.toLowerCase().includes(originFilter));
      }

      const availabilityFilter = String(params.availability || "").trim().toLowerCase();
      if (availabilityFilter) {
        items = items.filter((item) => item.availability_status === availabilityFilter);
      }

      if (params.availableOnly === "true") {
        items = items.filter((item) => item.currently_available);
      }

      const minStemLength = params.minStemLength != null && params.minStemLength !== "" ? Number(params.minStemLength) : null;
      if (minStemLength != null && !Number.isNaN(minStemLength)) {
        items = items.filter((item) => Number(item.stem_length_in) >= minStemLength);
      }

      // A florist searching "flowers for Friday" means available by that
      // date — a listing scheduled to start after it, or that has already
      // stopped, is not a real answer.
      const byDate = params.byDate ? new Date(params.byDate) : null;
      if (byDate && !Number.isNaN(byDate.getTime())) {
        items = items.filter((item) => {
          if (item.available_from && new Date(item.available_from) > byDate) return false;
          if (item.available_until && new Date(item.available_until) < byDate) return false;
          return true;
        });
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
            .select(SELLER_PROFILE_FIELDS)
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
          .select(SELLER_PROFILE_FIELDS)
          .eq("shop_id", params.shopId)
          .maybeSingle();
        if (!sellerResult.error) seller = sellerResult.data;
        const featuredIds = seller?.featured_listing_ids || [];
        const featured = featuredIds.length
          ? featuredIds.map((id) => storefrontItems.find((item) => item.id === id)).filter(Boolean)
          : [];
        return json(200, {
          items: storefrontItems,
          seller,
          verified_seller: Boolean(seller?.verified_at),
          featured
        });
      }

      return json(200, { items, favorites });
    }

    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      if (body.action === "receive_order") {
        if (!body.order_id) return json(400, { error: "order_id is required." });
        const result = await receiveOrderIntoInventory(client, user, shopId, body.order_id);
        return json(200, result);
      }
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
