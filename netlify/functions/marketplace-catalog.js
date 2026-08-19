import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { normalizeMarketplaceCategory, MARKETPLACE_CATEGORIES } from "./_shared/marketplace-categories.js";
import { canBrowseListing, resolveDisplayPrice, isCurrentlyAvailable, availabilityStatusLabel, groupListingsForComparison, summarizeSellerReviews, matchStandingOrderItems } from "./_shared/marketplace-products.js";
import { matchRecipeToInventory } from "../../lib/floral-library/recipe-intelligence.js";
import { shopDateStr, weekdayLabel } from "./_shared/shop-time.js";
import { notifyMarketplaceUser } from "./_shared/marketplace-notifications.js";
import { loadVerifiedSellerShopIds } from "./_shared/marketplace-verification.js";

const LISTINGS = "marketplace_listings";
const IMAGES = "marketplace_listing_images";
const FAVORITES = "marketplace_favorites";
const SELLER_PROFILES = "marketplace_seller_profiles";
const ORDERS = "marketplace_wholesale_orders";
const INVENTORY = "inventory";
const NOTIFICATIONS = "marketplace_notifications";
const REVIEWS = "marketplace_seller_reviews";
const REVIEWABLE_ORDER_STATUSES = ["paid", "fulfilled", "completed"];
const STANDING_ORDERS = "marketplace_standing_orders";
const WEEKDAY_CODES = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };

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

  const orderIds = (orders || []).map((o) => o.id);
  let reviewedOrderIds = new Set();
  if (orderIds.length) {
    const { data: reviewed } = await client.from(REVIEWS).select("order_id").eq("buyer_user_id", user.id).in("order_id", orderIds);
    reviewedOrderIds = new Set((reviewed || []).map((r) => r.order_id));
  }

  const enriched = (orders || []).map((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const canReceive = RECEIVABLE_ORDER_STATUSES.includes(order.status) && !order.inventory_synced_at;
    const preview = canReceive ? matchRecipeToInventory(items, shopInventory) : null;
    return {
      ...order,
      seller_display_name: sellerNames[order.seller_shop_id] || null,
      can_receive: canReceive,
      inventory_preview: preview ? preview.recipe : null,
      can_review: REVIEWABLE_ORDER_STATUSES.includes(order.status) && !reviewedOrderIds.has(order.id),
      can_request_refund: RECEIVABLE_ORDER_STATUSES.includes(order.status) && !order.refund_requested_at
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

/**
 * "Reorder" never resubmits the old order blindly — fresh flowers make
 * that unsafe. Every line item is re-checked against the listing's
 * CURRENT price, active state, and availability_status; a listing that
 * was archived, deactivated, or gone seasonal since the original
 * purchase is flagged, never silently re-added at last time's price.
 */
async function reorderPreview(client, user, orderId) {
  const { data: order, error: orderError } = await client.from(ORDERS).select("id, buyer_user_id, items").eq("id", orderId).maybeSingle();
  if (orderError) throw orderError;
  if (!order || order.buyer_user_id !== user.id) {
    const error = new Error("Order not found.");
    error.statusCode = 404;
    throw error;
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const listingIds = [...new Set(items.map((i) => i.listing_id).filter(Boolean))];
  let listingsById = {};
  let verifiedShopIds = new Set();
  if (listingIds.length) {
    const { data: listings, error: listingsError } = await client.from(LISTINGS).select("*").in("id", listingIds);
    if (listingsError) throw listingsError;
    listingsById = Object.fromEntries((listings || []).map((row) => [row.id, sanitizeListing(row)]));
    // Reordering is a continuation of a real past purchase, but the
    // seller could have lost verification since then — a lapsed or
    // suspended seller must not be silently reorderable, same real
    // gate the buyer catalog itself applies.
    verifiedShopIds = await loadVerifiedSellerShopIds((listings || []).map((row) => row.shop_id));
  }

  const preview = items.map((item) => {
    const current = item.listing_id ? listingsById[item.listing_id] : null;
    const stillAvailable = Boolean(current) && current.active && current.currently_available && verifiedShopIds.has(current.shop_id);
    return {
      listing_id: item.listing_id || null,
      name: item.name,
      quantity: item.quantity,
      original_unit_price: item.unit_price,
      current_price: current?.display_price ?? current?.price ?? null,
      current_unit: current?.display_price_unit || current?.unit || item.unit || "each",
      availability_status: current?.availability_status || null,
      price_changed: current ? Number(current.display_price ?? current.price) !== Number(item.unit_price) : null,
      available: stillAvailable
    };
  });

  return { order_id: orderId, items: preview };
}

/**
 * Rating a seller is only possible from a real, paid order with them —
 * seller_shop_id and buyer identity are both derived from that order
 * server-side, never taken from the client. The unique constraint on
 * order_id (one review per order, ever) is the backstop; this check
 * gives a real 409 instead of a raw constraint-violation error.
 */
async function submitSellerReview(client, user, shopId, body) {
  const rating = Number(body.rating);
  if (!body.order_id || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    const error = new Error("A valid order_id and a rating from 1-5 are required.");
    error.statusCode = 400;
    throw error;
  }

  const { data: order, error: orderError } = await client.from(ORDERS).select("id, buyer_user_id, seller_shop_id, status").eq("id", body.order_id).maybeSingle();
  if (orderError) throw orderError;
  if (!order || order.buyer_user_id !== user.id) {
    const error = new Error("Order not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!REVIEWABLE_ORDER_STATUSES.includes(order.status)) {
    const error = new Error("This order hasn't been paid yet — nothing to review.");
    error.statusCode = 409;
    throw error;
  }

  const { data: existingReview } = await client.from(REVIEWS).select("id").eq("order_id", order.id).maybeSingle();
  if (existingReview) {
    const error = new Error("You've already reviewed this order.");
    error.statusCode = 409;
    throw error;
  }

  const subRating = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };

  const { data, error } = await client
    .from(REVIEWS)
    .insert({
      order_id: order.id,
      seller_shop_id: order.seller_shop_id,
      buyer_user_id: user.id,
      buyer_shop_id: shopId || null,
      rating,
      fulfillment_rating: subRating(body.fulfillment_rating),
      communication_rating: subRating(body.communication_rating),
      accuracy_rating: subRating(body.accuracy_rating),
      comment: String(body.comment || "").trim().slice(0, 2000) || null
    })
    .select("*")
    .single();
  if (error) throw error;
  return { review: data };
}

/**
 * A structured, tracked "please look into this" signal from buyer to
 * seller — never a refund itself. Actual refund execution stays on
 * Stripe's own Connect Express dashboard (stripe-connect.js's existing
 * login-link action), which already handles the application-fee math
 * correctly; this endpoint only records the request and notifies the
 * seller so nothing silently sits unresolved.
 */
async function submitRefundRequest(client, user, body) {
  if (!body.order_id || !String(body.reason || "").trim()) {
    const error = new Error("order_id and a reason are required.");
    error.statusCode = 400;
    throw error;
  }
  const { data: order, error: orderError } = await client
    .from(ORDERS)
    .select("id, buyer_user_id, seller_shop_id, status, refund_requested_at")
    .eq("id", body.order_id)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order || order.buyer_user_id !== user.id) {
    const error = new Error("Order not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!RECEIVABLE_ORDER_STATUSES.includes(order.status)) {
    const error = new Error("This order hasn't been paid yet — nothing to refund.");
    error.statusCode = 409;
    throw error;
  }
  if (order.refund_requested_at) {
    const error = new Error("A refund has already been requested for this order.");
    error.statusCode = 409;
    throw error;
  }

  const reason = String(body.reason).trim().slice(0, 2000);
  const { data, error } = await client
    .from(ORDERS)
    .update({ refund_requested_at: new Date().toISOString(), refund_requested_reason: reason })
    .eq("id", order.id)
    .select("*")
    .single();
  if (error) throw error;

  const { data: seller } = await client.from("shops").select("owner_user_id").eq("id", order.seller_shop_id).maybeSingle();
  if (seller?.owner_user_id) {
    await notifyMarketplaceUser(
      seller.owner_user_id,
      "refund_requested",
      `A florist requested a refund on an order: "${reason}"`,
      { orderId: order.id }
    );
  }

  return { order: data };
}

/**
 * A buyer's recurring want-lists, each with a live "is this due today,
 * and what would it cost right now" check — never a stored price, never
 * an automatic cart/charge. shopDateStr()/weekdayLabel() give the shop's
 * own local weekday, not the server's UTC one (the exact bug class an
 * earlier audit this session found and fixed elsewhere).
 */
async function loadStandingOrders(client, user, shopId) {
  const { data: standingOrders, error } = await client
    .from(STANDING_ORDERS)
    .select("*")
    .eq("buyer_user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const { data: shopRow } = shopId ? await client.from("shops").select("timezone").eq("id", shopId).maybeSingle() : { data: null };
  const todayCode = WEEKDAY_CODES[weekdayLabel(shopDateStr(shopRow?.timezone))] || null;

  const sellerIds = [...new Set((standingOrders || []).map((s) => s.seller_shop_id).filter(Boolean))];
  let sellerNames = {};
  if (sellerIds.length) {
    const { data: sellers } = await client.from(SELLER_PROFILES).select("shop_id, display_name").in("shop_id", sellerIds);
    sellerNames = Object.fromEntries((sellers || []).map((s) => [s.shop_id, s.display_name]));
  }
  // A standing order is a continuation of a relationship with a specific
  // seller — but that seller can lose verification after the standing
  // order was set up. Computed once for every seller referenced, not
  // just the ones due today, so the list is honest even before the next
  // due date.
  const verifiedShopIds = await loadVerifiedSellerShopIds(sellerIds);

  const enriched = [];
  for (const row of standingOrders || []) {
    const sellerVerified = verifiedShopIds.has(row.seller_shop_id);
    const dueToday = row.active && row.cadence_weekday === todayCode;
    let preview = null;
    if (dueToday && sellerVerified) {
      const { data: listings } = await client.from(LISTINGS).select("*").eq("shop_id", row.seller_shop_id);
      preview = matchStandingOrderItems(row.items, listings || []);
    }
    enriched.push({
      ...row,
      seller_display_name: sellerNames[row.seller_shop_id] || null,
      seller_verified: sellerVerified,
      due_today: dueToday,
      preview
    });
  }
  return { standing_orders: enriched };
}

async function saveStandingOrder(client, user, shopId, body) {
  const items = Array.isArray(body.items) ? body.items.filter((i) => String(i?.name || "").trim() && Number(i?.quantity) > 0) : [];
  if (!body.seller_shop_id || !String(body.label || "").trim() || !items.length) {
    const error = new Error("A seller, a label, and at least one real item with a quantity are required.");
    error.statusCode = 400;
    throw error;
  }
  if (!Object.values(WEEKDAY_CODES).includes(body.cadence_weekday)) {
    const error = new Error("cadence_weekday must be one of sun/mon/tue/wed/thu/fri/sat.");
    error.statusCode = 400;
    throw error;
  }
  const payload = {
    buyer_shop_id: shopId,
    buyer_user_id: user.id,
    seller_shop_id: body.seller_shop_id,
    label: String(body.label).trim().slice(0, 200),
    cadence_weekday: body.cadence_weekday,
    items: items.map((i) => ({ name: String(i.name).trim().slice(0, 200), quantity: Number(i.quantity) })),
    active: body.active !== false,
    updated_at: new Date().toISOString()
  };
  let query;
  if (body.id) {
    const { data: existing } = await client.from(STANDING_ORDERS).select("id, buyer_user_id").eq("id", body.id).maybeSingle();
    if (!existing || existing.buyer_user_id !== user.id) {
      const error = new Error("Standing order not found.");
      error.statusCode = 404;
      throw error;
    }
    query = client.from(STANDING_ORDERS).update(payload).eq("id", body.id).select("*").single();
  } else {
    query = client.from(STANDING_ORDERS).insert(payload).select("*").single();
  }
  const { data, error } = await query;
  if (error) throw error;
  return { standing_order: data };
}

async function deleteStandingOrder(client, user, body) {
  if (!body.id) {
    const error = new Error("id is required.");
    error.statusCode = 400;
    throw error;
  }
  const { error } = await client.from(STANDING_ORDERS).delete().eq("id", body.id).eq("buyer_user_id", user.id);
  if (error) throw error;
  return { ok: true };
}

// SUPPLIER VERIFICATION: loadVerifiedSellerShopIds() now lives in
// _shared/marketplace-verification.js so every consumer — this file,
// and Lily's marketplace-sourcing search — can import the one shared
// check directly instead of a _shared module reaching into a sibling
// netlify/functions/*.js file. Re-exported here so existing imports of
// it from marketplace-catalog.js keep working unchanged.
export { loadVerifiedSellerShopIds };

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

      if (params.resource === "reorder-preview") {
        if (!params.order_id) return json(400, { error: "order_id is required." });
        return json(200, await reorderPreview(client, user, params.order_id));
      }

      if (params.resource === "seller-reviews") {
        if (!params.shopId) return json(400, { error: "shopId is required." });
        const { data: reviews, error: reviewsError } = await client
          .from(REVIEWS)
          .select("*")
          .eq("seller_shop_id", params.shopId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (reviewsError) throw reviewsError;
        return json(200, { reviews: reviews || [], summary: summarizeSellerReviews(reviews || []) });
      }

      if (params.resource === "standing-orders") {
        return json(200, await loadStandingOrders(client, user, shopId));
      }

      if (params.resource === "notifications") {
        const { data: notes, error: notesError } = await client
          .from(NOTIFICATIONS)
          .select("*")
          .eq("recipient_user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (notesError) throw notesError;
        return json(200, {
          notifications: notes || [],
          unread_count: (notes || []).filter((n) => !n.read_at).length
        });
      }

      let query = client
        .from(LISTINGS)
        .select("*")
        .eq("active", true)
        .is("archived_at", null)
        .order("created_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      const verifiedShopIds = await loadVerifiedSellerShopIds((data || []).map((row) => row.shop_id));
      let items = (data || [])
        .map(sanitizeListing)
        .filter((row) => canBrowseListing(row, { previewAllowed: false }))
        .filter((row) => verifiedShopIds.has(row.shop_id));

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
        // The raw-data fallback below exists so a direct link to a
        // listing still works even if it doesn't match the current
        // search/filter terms — but it must still pass the same real
        // gates (browsable, verified seller) as the main list, or a
        // guessed/bookmarked URL would bypass seller verification entirely.
        const fallbackRow = (data || []).find((row) => row.id === params.listingId);
        const fallbackListing =
          fallbackRow && canBrowseListing(fallbackRow, { previewAllowed: false }) && verifiedShopIds.has(fallbackRow.shop_id)
            ? sanitizeListing(fallbackRow)
            : null;
        const listing = items.find((item) => item.id === params.listingId) || fallbackListing;
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
        const { data: sellerReviews } = await client.from(REVIEWS).select("rating").eq("seller_shop_id", params.shopId);
        return json(200, {
          items: storefrontItems,
          seller,
          verified_seller: Boolean(seller?.verified_at),
          featured,
          reviews_summary: summarizeSellerReviews(sellerReviews || [])
        });
      }

      // Cross-supplier comparison (Marketplace vision: MULTIPLE
      // WHOLESALERS) — only worth computing when the buyer is actually
      // searching for something specific; an unfiltered full-catalog
      // browse has no single "compared item" to group around.
      const hasActiveSearch = Boolean(q || varietyFilter);
      const compare = hasActiveSearch
        ? groupListingsForComparison(items).filter((group) => group.seller_count > 1)
        : [];

      return json(200, { items, favorites, compare });
    }

    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      if (body.action === "save_standing_order") {
        return json(200, await saveStandingOrder(client, user, shopId, body));
      }
      if (body.action === "delete_standing_order") {
        return json(200, await deleteStandingOrder(client, user, body));
      }
      if (body.action === "request_refund") {
        return json(200, await submitRefundRequest(client, user, body));
      }
      if (body.action === "submit_review") {
        return json(201, await submitSellerReview(client, user, shopId, body));
      }
      if (body.action === "mark_notifications_read") {
        const query = client.from(NOTIFICATIONS).update({ read_at: new Date().toISOString() }).eq("recipient_user_id", user.id).is("read_at", null);
        const { error } = body.id ? await query.eq("id", body.id) : await query;
        if (error) throw error;
        return json(200, { ok: true });
      }
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
