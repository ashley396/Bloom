import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { normalizeMarketplaceCategory } from "./_shared/marketplace-categories.js";
import { parseMarketplaceCsv, marketplaceCsvTemplate } from "./_shared/marketplace-csv.js";
import {
  buildSellerKpis,
  computeListingInventory,
  isLowStock,
  nextPublishTransition,
  normalizePublishStatus,
  validateProductImages,
  validateProductVariants,
  normalizeAvailabilityStatus,
  normalizeSeasonalMonths,
  validateFloralAttributes,
  isCurrentlyAvailable
} from "./_shared/marketplace-products.js";
import { sanitizeApplicationRecord, TABLE as VERIFICATION_TABLE } from "./_shared/marketplace-verification.js";
import { normalizePromoCode } from "./_shared/marketplace-promotions.js";
import { writeShopAudit } from "./_shared/production.js";
import { notifyMarketplaceUser, notifyFavoritersBackInStock } from "./_shared/marketplace-notifications.js";
import { requireMarketplaceSellerPlan } from "./_shared/marketplace-plan-gate.js";

const LISTINGS = "marketplace_listings";
const IMAGES = "marketplace_listing_images";
const VARIANTS = "marketplace_listing_variants";
const SELLER_PROFILES = "marketplace_seller_profiles";
const SELLER_CATEGORIES = "marketplace_seller_categories";
const PROMOTIONS = "marketplace_promotions";
const TIERS = "marketplace_pricing_tiers";
const CUSTOMERS = "marketplace_wholesale_customers";
const ORDERS = "marketplace_wholesale_orders";

const LISTING_FIELDS = [
  "supplier_name",
  "product_name",
  "category",
  "category_slug",
  "unit",
  "price",
  "minimum_quantity",
  "available_quantity",
  "image_url",
  "description",
  "delivery_notes",
  "active",
  "sku",
  "low_stock_threshold",
  "allows_shipping",
  "allows_local_pickup",
  "publish_status",
  // Floral-specific wholesale attributes (Marketplace vision phase 1).
  "variety",
  "color",
  "stem_length_in",
  "grade",
  "grower_name",
  "origin",
  "stems_per_bunch",
  "bunches_per_box",
  "case_quantity",
  "price_per_stem",
  "price_per_bunch",
  "price_per_box",
  "price_per_case",
  "availability_status",
  "available_from",
  "available_until",
  "seasonal_months",
  "lead_time_days",
  "delivery_region",
  "pickup_city",
  "pickup_state",
  "substitution_note"
];

function isMissingTableError(error) {
  if (!error) return false;
  const message = String(error.message || error.details || "").toLowerCase();
  const code = String(error.code || "");
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("could not find the table");
}

function assertListingOwnership(row, shopId) {
  if (!row || row.shop_id !== shopId) {
    const error = new Error("You do not have access to this listing.");
    error.statusCode = 403;
    throw error;
  }
}

function buildListingPayload(body, shopId) {
  const payload = { shop_id: shopId };
  for (const field of LISTING_FIELDS) {
    if (field in body) payload[field] = body[field];
  }
  if (body.publish_status !== undefined) {
    payload.publish_status = normalizePublishStatus(body.publish_status);
  }
  if (body.availability_status !== undefined) {
    payload.availability_status = normalizeAvailabilityStatus(body.availability_status);
  }
  if (body.seasonal_months !== undefined) {
    payload.seasonal_months = normalizeSeasonalMonths(body.seasonal_months);
  }
  // Empty-string dates/numbers from a form should clear the column, not
  // get sent to Postgres as "" and fail the numeric/date cast.
  for (const field of [
    "stem_length_in", "stems_per_bunch", "bunches_per_box", "case_quantity",
    "price_per_stem", "price_per_bunch", "price_per_box", "price_per_case",
    "lead_time_days", "available_from", "available_until"
  ]) {
    if (payload[field] === "") payload[field] = null;
  }
  if (body.category && !body.category_slug) {
    const normalized = normalizeMarketplaceCategory(body.category);
    payload.category = normalized.label;
    if (normalized.slug) payload.category_slug = normalized.slug;
  }
  if (body.category_slug) {
    const normalized = normalizeMarketplaceCategory(body.category_slug);
    payload.category_slug = normalized.slug || body.category_slug;
    payload.category = normalized.label;
  }
  return payload;
}

async function loadVerificationStatus(client, userId) {
  const { data, error } = await client
    .from(VERIFICATION_TABLE)
    .select("id, status, profile_data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { status: "unknown", sanitized: null };
    throw error;
  }
  if (!data) return { status: "not_started", sanitized: null };
  const sanitized = await sanitizeApplicationRecord(client, data);
  return { status: data.status, sanitized };
}

async function loadVariantsByListing(client, shopId, listingIds) {
  if (!listingIds.length) return {};
  try {
    const { data, error } = await client.from(VARIANTS).select("*").eq("shop_id", shopId).in("listing_id", listingIds);
    if (error) throw error;
    const map = {};
    (data || []).forEach((row) => {
      map[row.listing_id] = map[row.listing_id] || [];
      map[row.listing_id].push(row);
    });
    return map;
  } catch (error) {
    if (isMissingTableError(error)) return {};
    throw error;
  }
}

async function loadImagesByListing(client, shopId, listingIds) {
  if (!listingIds.length) return {};
  try {
    const { data, error } = await client
      .from(IMAGES)
      .select("*")
      .eq("shop_id", shopId)
      .in("listing_id", listingIds)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const map = {};
    (data || []).forEach((row) => {
      map[row.listing_id] = map[row.listing_id] || [];
      map[row.listing_id].push(row);
    });
    return map;
  } catch (error) {
    if (isMissingTableError(error)) return {};
    throw error;
  }
}

async function replaceListingImages(client, shopId, listingId, images = []) {
  const validation = validateProductImages(images);
  if (!validation.valid) {
    const error = new Error(validation.errors.join(" "));
    error.statusCode = 400;
    throw error;
  }
  await client.from(IMAGES).delete().eq("listing_id", listingId).eq("shop_id", shopId);
  if (!images.length) return [];
  const rows = images.map((image, index) => ({
    listing_id: listingId,
    shop_id: shopId,
    url: String(image.url || image).trim(),
    alt_text: image.alt_text || image.alt || null,
    sort_order: Number(image.sort_order ?? index)
  }));
  const { data, error } = await client.from(IMAGES).insert(rows).select("*");
  if (error) throw error;
  return data || [];
}

async function replaceListingVariants(client, shopId, listingId, variants = []) {
  const validation = validateProductVariants(variants);
  if (!validation.valid) {
    const error = new Error(validation.errors.join(" "));
    error.statusCode = 400;
    throw error;
  }
  await client.from(VARIANTS).delete().eq("listing_id", listingId).eq("shop_id", shopId);
  if (!variants.length) return [];
  const rows = variants.map((variant) => ({
    listing_id: listingId,
    shop_id: shopId,
    sku: variant.sku || null,
    name: variant.name,
    price: variant.price,
    available_quantity: variant.available_quantity ?? 0,
    low_stock_threshold: variant.low_stock_threshold ?? 5,
    attributes: variant.attributes && typeof variant.attributes === "object" ? variant.attributes : {},
    active: variant.active !== false
  }));
  const { data, error } = await client.from(VARIANTS).insert(rows).select("*");
  if (error) throw error;
  return data || [];
}

function enrichProduct(listing, images = [], variants = []) {
  const inventory = computeListingInventory(listing, variants);
  return {
    ...listing,
    images,
    variants,
    inventory_total: inventory,
    low_stock: isLowStock(listing, variants)
  };
}

async function loadDashboard(client, shopId, userId) {
  const { data: listings, error: listingsError } = await client
    .from(LISTINGS)
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });
  if (listingsError) throw listingsError;

  const listingIds = (listings || []).map((row) => row.id);
  const variantsByListing = await loadVariantsByListing(client, shopId, listingIds);
  const imagesByListing = await loadImagesByListing(client, shopId, listingIds);

  let orders = [];
  try {
    const orderResult = await client.from(ORDERS).select("*").eq("seller_shop_id", shopId).order("created_at", { ascending: false }).limit(100);
    if (!orderResult.error) orders = orderResult.data || [];
  } catch {
    orders = [];
  }

  const kpis = buildSellerKpis({ products: listings || [], orders, variantsByListing });

  const products = (listings || []).map((listing) =>
    enrichProduct(listing, imagesByListing[listing.id] || [], variantsByListing[listing.id] || [])
  );

  const bestSellers = [...products]
    .filter((row) => !row.archived_at && normalizePublishStatus(row.publish_status, "published") === "published")
    .sort((a, b) => Number(b.inventory_total || 0) - Number(a.inventory_total || 0))
    .slice(0, 5);

  const lowStock = products.filter((row) => !row.archived_at && row.low_stock);

  let profile = null;
  let categories = [];
  let promotions = [];
  let pricingTiers = [];
  let customers = [];

  try {
    const profileResult = await client.from(SELLER_PROFILES).select("*").eq("shop_id", shopId).maybeSingle();
    if (!profileResult.error) profile = profileResult.data;
    const categoriesResult = await client.from(SELLER_CATEGORIES).select("category_slug").eq("shop_id", shopId);
    if (!categoriesResult.error) categories = (categoriesResult.data || []).map((row) => row.category_slug);
    const promoResult = await client.from(PROMOTIONS).select("id, code, percent_off, active, description, starts_at, ends_at").eq("shop_id", shopId);
    if (!promoResult.error) promotions = promoResult.data || [];
    const tierResult = await client.from(TIERS).select("id, name, min_quantity, discount_percent, active").eq("shop_id", shopId);
    if (!tierResult.error) pricingTiers = tierResult.data || [];
    const customerResult = await client.from(CUSTOMERS).select("*").eq("seller_shop_id", shopId).order("company_name");
    if (!customerResult.error) customers = customerResult.data || [];
  } catch {
    // Optional tables until migrations are applied.
  }

  const verification = await loadVerificationStatus(client, userId);

  return {
    profile,
    verification_status: verification.status,
    verification: verification.sanitized,
    products,
    orders,
    customers,
    kpis,
    stats: {
      product_count: kpis.product_count,
      low_stock_count: kpis.low_stock_count,
      revenue_estimate: kpis.revenue_total,
      order_count: kpis.order_count
    },
    best_sellers: bestSellers,
    low_stock: lowStock,
    categories,
    promotions,
    pricing_tiers: pricingTiers
  };
}

async function saveProduct(client, shopId, body) {
  const images = Array.isArray(body.images) ? body.images : [];
  const variants = Array.isArray(body.variants) ? body.variants : [];
  const floralValidation = validateFloralAttributes(body);
  if (!floralValidation.valid) {
    const error = new Error(floralValidation.errors.join(" "));
    error.statusCode = 400;
    throw error;
  }
  const publishStatus = normalizePublishStatus(body.publish_status, "draft");
  const payload = buildListingPayload({ ...body, publish_status: publishStatus }, shopId);
  if (!payload.image_url && images[0]?.url) payload.image_url = images[0].url;
  if (variants.length && !payload.sku && variants[0]?.sku) payload.sku = variants[0].sku;
  payload.available_quantity = computeListingInventory(payload, variants);

  let listing;
  let wasAvailable = null;
  if (body.id) {
    const { data: existing, error: existingError } = await client.from(LISTINGS).select("*").eq("id", body.id).maybeSingle();
    if (existingError) throw existingError;
    assertListingOwnership(existing, shopId);
    wasAvailable = existing.active !== false && isCurrentlyAvailable(existing);
    delete payload.shop_id;
    const { data, error } = await client.from(LISTINGS).update(payload).eq("id", body.id).eq("shop_id", shopId).select("*").single();
    if (error) throw error;
    listing = data;
  } else {
    const { data, error } = await client.from(LISTINGS).insert(payload).select("*").single();
    if (error) throw error;
    listing = data;
  }

  const savedImages = await replaceListingImages(client, shopId, listing.id, images);
  const savedVariants = await replaceListingVariants(client, shopId, listing.id, variants);

  // "A saved flower is back in stock" (Marketplace vision: NOTIFICATIONS)
  // — only fires on a real false->true transition, never on every save.
  if (wasAvailable === false) {
    const nowAvailable = listing.active !== false && isCurrentlyAvailable(listing);
    if (nowAvailable) {
      await notifyFavoritersBackInStock(client, listing.id, `${listing.product_name} is back in stock.`);
    }
  }

  return enrichProduct(listing, savedImages, savedVariants);
}

async function transitionPublish(client, shopId, listingId, action, userId = null) {
  const { data: listing, error } = await client.from(LISTINGS).select("*").eq("id", listingId).maybeSingle();
  if (error) throw error;
  assertListingOwnership(listing, shopId);
  const nextStatus = nextPublishTransition(listing.publish_status, action);
  const updates = {
    publish_status: nextStatus,
    preview_updated_at: nextStatus === "preview" ? new Date().toISOString() : listing.preview_updated_at,
    published_at: nextStatus === "published" ? new Date().toISOString() : listing.published_at,
    active: nextStatus === "published" ? true : listing.active
  };
  const { data, error: updateError } = await client
    .from(LISTINGS)
    .update(updates)
    .eq("id", listingId)
    .eq("shop_id", shopId)
    .select("*")
    .single();
  if (updateError) throw updateError;
  await writeShopAudit(client, {
    shopId,
    userId,
    eventType: "wholesale_publish",
    entityType: "marketplace_listing",
    entityId: listingId,
    metadata: { from: listing.publish_status, to: nextStatus, action }
  });
  return data;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const context = await currentUser(event);
    const { client, user, shopId } = context;
    await requireMarketplaceSellerPlan(client, shopId);
    const params = event.queryStringParameters || {};
    const body = event.httpMethod === "GET" ? {} : bodyOf(event);

    if (event.httpMethod === "GET") {
      if (params.resource === "csv-template") {
        return json(200, { csv: marketplaceCsvTemplate() });
      }
      if (params.product_id) {
        const { data: listing, error } = await client.from(LISTINGS).select("*").eq("id", params.product_id).maybeSingle();
        if (error) throw error;
        assertListingOwnership(listing, shopId);
        const images = (await loadImagesByListing(client, shopId, [listing.id]))[listing.id] || [];
        const variants = (await loadVariantsByListing(client, shopId, [listing.id]))[listing.id] || [];
        return json(200, { product: enrichProduct(listing, images, variants) });
      }
      const dashboard = await loadDashboard(client, shopId, user.id);
      return json(200, dashboard);
    }

    if (event.httpMethod === "POST") {
      if (body.action === "validate-csv") {
        const parsed = parseMarketplaceCsv(body.csv || "");
        return json(200, parsed);
      }

      if (body.action === "import-csv") {
        const parsed = parseMarketplaceCsv(body.csv || "");
        if (!parsed.valid) return json(400, { error: parsed.errors.join(" ") });
        const inserted = [];
        for (const row of parsed.rows) {
          const product = await saveProduct(client, shopId, {
            product_name: row.product_name,
            supplier_name: row.supplier_name || body.supplier_name || "Seller",
            category: row.category || "Fresh Flowers",
            unit: row.unit || "each",
            price: row.price,
            sku: row.sku || "",
            minimum_quantity: row.minimum_quantity || 1,
            available_quantity: row.available_quantity || 0,
            description: row.description || "",
            image_url: row.image_url || "",
            delivery_notes: row.delivery_notes || "",
            allows_shipping: row.allows_shipping !== "false",
            allows_local_pickup: row.allows_local_pickup === "true",
            publish_status: row.publish_status || "draft",
            images: row.image_url ? [{ url: row.image_url }] : []
          });
          inserted.push(product);
        }
        return json(201, { imported: inserted.length, items: inserted });
      }

      if (body.action === "save-product") {
        const product = await saveProduct(client, shopId, body);
        return json(200, { product });
      }

      if (body.action === "publish" && body.id) {
        const listing = await transitionPublish(client, shopId, body.id, body.transition || "publish", user.id);
        return json(200, { item: listing });
      }

      if (body.action === "archive" && body.id) {
        const { data: existing, error: existingError } = await client.from(LISTINGS).select("id, shop_id").eq("id", body.id).maybeSingle();
        if (existingError) throw existingError;
        assertListingOwnership(existing, shopId);
        const { data, error } = await client
          .from(LISTINGS)
          .update({ archived_at: new Date().toISOString(), active: false, publish_status: "draft" })
          .eq("id", body.id)
          .eq("shop_id", shopId)
          .select("*")
          .single();
        if (error) throw error;
        return json(200, { item: data });
      }

      if (body.action === "save-tier") {
        const row = {
          shop_id: shopId,
          name: body.name,
          min_quantity: body.min_quantity ?? 1,
          discount_percent: body.discount_percent ?? 0,
          active: body.active !== false
        };
        const query = body.id
          ? client.from(TIERS).update(row).eq("id", body.id).eq("shop_id", shopId)
          : client.from(TIERS).insert(row);
        const { data, error } = await query.select("*").single();
        if (error) throw error;
        return json(200, { pricing_tier: data });
      }

      if (body.action === "save-promotion") {
        // MARKETPLACE SPECIALS: marketplace_promotions has existed since
        // the greenfield baseline but this is the first action that ever
        // let a seller actually create one — previously a dormant table,
        // read-only, and always empty. Code is normalized (trim+uppercase)
        // here at the one point of entry so buyer checkout's lookup and
        // this save both compare the same real form, never a
        // case-mismatch that silently fails to redeem.
        const code = normalizePromoCode(body.code);
        if (!code) {
          const error = new Error("A promo code is required.");
          error.statusCode = 400;
          throw error;
        }
        const percentOff = Number(body.percent_off);
        if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) {
          const error = new Error("percent_off must be a real number greater than 0 and no more than 100.");
          error.statusCode = 400;
          throw error;
        }
        const startsAt = body.starts_at ? new Date(body.starts_at).toISOString() : null;
        const endsAt = body.ends_at ? new Date(body.ends_at).toISOString() : null;
        if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
          const error = new Error("A special can't end before it starts.");
          error.statusCode = 400;
          throw error;
        }
        const row = {
          shop_id: shopId,
          code,
          description: body.description || null,
          percent_off: percentOff,
          active: body.active !== false,
          starts_at: startsAt,
          ends_at: endsAt
        };
        // (shop_id, code) is unique — an id-less save upserts on that key
        // so re-submitting the same code edits the existing special
        // instead of erroring on the constraint or silently creating a
        // duplicate.
        const query = body.id
          ? client.from(PROMOTIONS).update(row).eq("id", body.id).eq("shop_id", shopId)
          : client.from(PROMOTIONS).upsert(row, { onConflict: "shop_id,code" });
        const { data, error } = await query.select("*").single();
        if (error) throw error;
        return json(200, { promotion: data });
      }

      if (body.action === "toggle-promotion" && body.id) {
        // A dedicated action for the one-click deactivate/reactivate, not
        // a partial save-promotion — save-promotion's row is a full
        // replace (code/percent_off/description/dates all required or
        // nulled), so routing a toggle through it would silently wipe
        // whatever the seller wasn't re-submitting.
        const { data, error } = await client
          .from(PROMOTIONS)
          .update({ active: body.active !== false })
          .eq("id", body.id)
          .eq("shop_id", shopId)
          .select("*")
          .single();
        if (error) throw error;
        return json(200, { promotion: data });
      }

      if (body.action === "save-customer") {
        const row = {
          seller_shop_id: shopId,
          company_name: body.company_name,
          contact_name: body.contact_name || null,
          email: body.email || null,
          phone: body.phone || null,
          notes: body.notes || null,
          updated_at: new Date().toISOString()
        };
        const query = body.id
          ? client.from(CUSTOMERS).update(row).eq("id", body.id).eq("seller_shop_id", shopId)
          : client.from(CUSTOMERS).insert(row);
        const { data, error } = await query.select("*").single();
        if (error) throw error;
        return json(200, { customer: data });
      }

      if (body.action === "update-order" && body.id) {
        const { data: existing, error: existingError } = await client.from(ORDERS).select("id, seller_shop_id, buyer_user_id, status").eq("id", body.id).maybeSingle();
        if (existingError) throw existingError;
        if (!existing || existing.seller_shop_id !== shopId) {
          return json(403, { error: "You do not have access to this order." });
        }
        const { data, error } = await client
          .from(ORDERS)
          .update({ status: body.status, notes: body.notes ?? undefined, updated_at: new Date().toISOString() })
          .eq("id", body.id)
          .eq("seller_shop_id", shopId)
          .select("*")
          .single();
        if (error) throw error;

        if (existing.buyer_user_id && body.status && body.status !== existing.status) {
          const { data: sellerProfile } = await client.from(SELLER_PROFILES).select("display_name").eq("shop_id", shopId).maybeSingle();
          const sellerName = sellerProfile?.display_name || "Your wholesale supplier";
          await notifyMarketplaceUser(
            existing.buyer_user_id,
            "order_status_changed",
            `${sellerName} updated your order to "${body.status}."`,
            { orderId: body.id }
          );
        }

        return json(200, { order: data });
      }

      const payload = buildListingPayload(body, shopId);
      payload.publish_status = normalizePublishStatus(body.publish_status, "draft");
      const { data, error } = await client.from(LISTINGS).insert(payload).select("*").single();
      if (error) throw error;
      return json(201, { item: data });
    }

    if (event.httpMethod === "PATCH") {
      if (body.action === "save-product" || body.images || body.variants) {
        const product = await saveProduct(client, shopId, body);
        return json(200, { product });
      }
      if (!body.id) return json(400, { error: "Missing id" });
      const { data: existing, error: existingError } = await client.from(LISTINGS).select("id, shop_id").eq("id", body.id).maybeSingle();
      if (existingError) throw existingError;
      assertListingOwnership(existing, shopId);
      const payload = buildListingPayload(body, shopId);
      delete payload.shop_id;
      const { data, error } = await client
        .from(LISTINGS)
        .update(payload)
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .select("*")
        .single();
      if (error) throw error;
      return json(200, { item: data });
    }

    if (event.httpMethod === "PUT") {
      const profilePayload = {
        shop_id: shopId,
        display_name: body.display_name || null,
        bio: body.bio || null,
        website: body.website || null,
        minimum_order_amount: body.minimum_order_amount != null ? Number(body.minimum_order_amount) : 0,
        settings: body.settings && typeof body.settings === "object" ? body.settings : {},
        // Wholesaler storefront (Marketplace vision: WHOLESALER STOREFRONTS).
        location_city: body.location_city || null,
        location_state: body.location_state || null,
        location_country: body.location_country || null,
        delivery_area: body.delivery_area || null,
        delivery_radius_miles: body.delivery_radius_miles !== "" && body.delivery_radius_miles != null ? Number(body.delivery_radius_miles) : null,
        pickup_available: Boolean(body.pickup_available),
        pickup_address: body.pickup_address || null,
        pickup_hours: body.pickup_hours || null,
        shipping_flat_fee: body.shipping_flat_fee !== "" && body.shipping_flat_fee != null ? Number(body.shipping_flat_fee) : null,
        free_shipping_over: body.free_shipping_over !== "" && body.free_shipping_over != null ? Number(body.free_shipping_over) : null,
        ordering_policy: body.ordering_policy || null,
        order_deadline_note: body.order_deadline_note || null,
        contact_email: body.contact_email || null,
        contact_phone: body.contact_phone || null,
        updated_at: new Date().toISOString()
      };

      if (Array.isArray(body.featured_listing_ids)) {
        // A seller can only feature their own listings — never trust a
        // client-supplied ID list without checking ownership first.
        const ids = [...new Set(body.featured_listing_ids.filter(Boolean))].slice(0, 12);
        if (ids.length) {
          const { data: owned, error: ownedError } = await client.from(LISTINGS).select("id").eq("shop_id", shopId).in("id", ids);
          if (ownedError) throw ownedError;
          profilePayload.featured_listing_ids = (owned || []).map((row) => row.id);
        } else {
          profilePayload.featured_listing_ids = [];
        }
      }

      const { data, error } = await client.from(SELLER_PROFILES).upsert(profilePayload, { onConflict: "shop_id" }).select("*").single();
      if (error) {
        if (isMissingTableError(error)) {
          return json(503, { error: "Seller profiles require the marketplace milestone migration." });
        }
        throw error;
      }

      if (Array.isArray(body.category_slugs)) {
        await client.from(SELLER_CATEGORIES).delete().eq("shop_id", shopId);
        const rows = body.category_slugs.map((slug) => ({ shop_id: shopId, category_slug: slug }));
        if (rows.length) {
          const catError = await client.from(SELLER_CATEGORIES).insert(rows);
          if (catError.error && !isMissingTableError(catError.error)) throw catError.error;
        }
      }

      return json(200, { profile: data });
    }

    return methodNotAllowed();
  } catch (error) {
    if (isMissingTableError(error)) {
      return json(503, { error: "Seller dashboard tables are not available until wholesale migrations are applied." });
    }
    return fail(error);
  }
}
