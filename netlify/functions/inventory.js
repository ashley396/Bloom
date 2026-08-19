import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { writeShopAudit } from "./_shared/production.js";
import { validateInventoryItemBody } from "./_shared/validation.js";
import { validateInventoryFreshnessFields } from "./_shared/inventory-freshness.js";
import { requireRowShopId } from "./_shared/shop-scope.js";
import { shopDateStr } from "./_shared/shop-time.js";

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function payloadOf(body, shopId, todayStr) {
  const category = cleanText(body.category, "Flowers") || "Flowers";
  const cost = Math.max(0, Number(body.cost || 0));
  const enteredPrice = Math.max(0, Number(body.price || 0));
  const freshness = validateInventoryFreshnessFields(body);
  const markup = freshness.sanitized.markup_multiplier;
  const price =
    category.toLowerCase() === "flowers" && !body.price && !body.id
      ? Number((cost * markup).toFixed(2))
      : enteredPrice > 0
        ? enteredPrice
        : category.toLowerCase() === "flowers"
          ? Number((cost * markup).toFixed(2))
          : enteredPrice;

  // A brand-new item with no explicit arrival date defaults to "today" —
  // that must be the shop's own calendar day (arrival_date drives the
  // freshness/age scoring on the dashboard), not the server's UTC day.
  const received_at =
    freshness.sanitized.received_at ||
    cleanText(body.arrival_date) ||
    (body.id ? null : todayStr);

  return {
    shop_id: shopId,
    name: cleanText(body.name),
    category,
    color: cleanText(body.color),
    variety: cleanText(body.variety),
    quantity: Math.max(0, Number(body.quantity || 0)),
    low_stock_level: Math.max(0, Number(body.low_stock_level || 5)),
    unit: cleanText(body.unit, "stems") || "stems",
    cost,
    price,
    arrival_date: received_at || cleanText(body.arrival_date) || null,
    received_at: received_at || null,
    use_by: freshness.sanitized.use_by || cleanText(body.use_by) || null,
    vase_life_days: Math.max(1, Number(body.vase_life_days || 7)),
    supplier: cleanText(body.supplier),
    lot_code: cleanText(body.lot_code),
    markup_multiplier: markup,
    item_kind: freshness.sanitized.item_kind,
  };
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const { client, shopId, user } = await currentUser(event);
    if (event.httpMethod === "GET") {
      const { data, error } = await client
        .from("inventory")
        .select("*")
        .eq("shop_id",shopId)
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .order("color", { ascending: true });
      if (error) throw error;
      return json(200, { items: data || [] });
    }
    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      const sourceItems = Array.isArray(body.items) ? body.items : [body];
      for (const item of sourceItems) {
        const v = validateInventoryItemBody(item);
        if (!v.valid) return json(400, { error: v.errors[0] });
        const fresh = validateInventoryFreshnessFields(item);
        if (!fresh.valid) return json(400, { error: fresh.errors[0] });
      }
      const { data: shop } = await client.from("shops").select("timezone").eq("id", shopId).maybeSingle();
      const todayStr = shopDateStr(shop?.timezone);
      const payloads = sourceItems.map((item) => payloadOf(item, shopId, todayStr)).filter((item) => item.name);
      if (!payloads.length) return json(400, { error: "Item name is required" });
      const { data, error } = await client.from("inventory").insert(payloads).select();
      if (error) throw error;
      await writeShopAudit(client, {
        shopId,
        userId: user?.id,
        eventType: "inventory_added",
        entityType: "inventory",
        entityId: data?.[0]?.id,
        metadata: { count: payloads.length, names: payloads.map((p) => p.name).slice(0, 5) },
      });
      return json(201, { item: data?.[0] || null, items: data || [] });
    }
    if (event.httpMethod === "PATCH") {
      const body = bodyOf(event);
      if (!body.id || !cleanText(body.name)) return json(400, { error: "Item and name are required" });
      const { data: existing, error: readError } = await client
        .from("inventory")
        .select("*")
        .eq("id", body.id)
        .eq("shop_id",shopId)
        .is("deleted_at", null)
        .maybeSingle();
      if (readError) throw readError;
      if (!existing) return json(404, { error: "Inventory item not found." });
      requireRowShopId(existing, shopId, "Inventory item");
      const fresh = validateInventoryFreshnessFields(body);
      if (!fresh.valid) return json(400, { error: fresh.errors[0] });
      const payload = payloadOf(body, shopId);
      delete payload.shop_id;
      const { data, error } = await client
        .from("inventory")
        .update(payload)
        .eq("id", body.id)
        .eq("shop_id",shopId)
        .is("deleted_at", null)
        .select()
        .single();
      if (error) throw error;
      await writeShopAudit(client, {
        shopId,
        userId: user?.id,
        eventType: "inventory_updated",
        entityType: "inventory",
        entityId: data.id,
        metadata: {
          quantity: data.quantity,
          name: data.name,
          received_at: data.received_at,
          use_by: data.use_by,
          markup_multiplier: data.markup_multiplier,
        },
      });
      return json(200, { item: data });
    }
    if (event.httpMethod === "DELETE") {
      const body = bodyOf(event);
      if (!body.id) return json(400, { error: "Item is required" });
      const { data: existing } = await client
        .from("inventory")
        .select("id, shop_id")
        .eq("id", body.id)
        .maybeSingle();
      requireRowShopId(existing, shopId, "Inventory item");
      const { error } = await client
        .from("inventory")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("shop_id",shopId);
      if (error) throw error;
      return json(200, { ok: true });
    }
    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
