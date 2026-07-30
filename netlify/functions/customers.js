import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { writeShopAudit } from "./_shared/production.js";
import { validateCustomerBody } from "./_shared/validation.js";
import { findDuplicateCustomer } from "./_shared/customer-dedup.js";
import {
  normalizeContactPreferences,
  resolveContactPreferences,
  contactPreferenceAuditMetadata,
} from "./_shared/customer-preferences.js";
import { requireRowShopId } from "./_shared/shop-scope.js";

const fields = [
  "name",
  "phone",
  "email",
  "address",
  "notes",
  "birthday",
  "anniversary",
  "favorite_flowers",
  "favorite_colors",
  "tags",
  "vip",
  "is_business",
  "is_house_account",
  "contact_preferences",
];

function applyContactPreferences(payload, body, { isCreate, previous = null } = {}) {
  if (!("contact_preferences" in body) && !isCreate) return payload;
  payload.contact_preferences = normalizeContactPreferences(body.contact_preferences ?? body, {
    isCreate,
    previous,
  });
  return payload;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const { client, shopId, user } = await currentUser(event);
    if (event.httpMethod === "GET") {
      const { data, error } = await client
        .from("customers")
        .select("*")
        .eq("shop_id",shopId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      const items = (data || []).map((row) => ({
        ...row,
        contact_preferences: resolveContactPreferences(row.contact_preferences),
      }));
      return json(200, { items });
    }
    const body = bodyOf(event);
    if (event.httpMethod === "POST") {
      const v = validateCustomerBody(body);
      if (!v.valid) return json(400, { error: v.errors[0] });
      const dup = await findDuplicateCustomer(client, shopId, {
        phone: body.phone,
        email: body.email,
      });
      if (dup.duplicate) {
        return json(409, {
          error: `A customer with this ${dup.field} already exists (${dup.existing?.name || "duplicate"}).`,
          existing_id: dup.existing?.id,
        });
      }
      const payload = { shop_id: shopId };
      for (const f of fields) if (f in body && f !== "contact_preferences") payload[f] = body[f];
      applyContactPreferences(payload, body, { isCreate: true });
      const { data, error } = await client.from("customers").insert(payload).select("*").single();
      if (error) throw error;
      await writeShopAudit(client, {
        shopId,
        userId: user?.id,
        eventType: "customer_created",
        entityType: "customer",
        entityId: data.id,
        metadata: { contact_preferences: data.contact_preferences },
      });
      return json(201, {
        item: { ...data, contact_preferences: resolveContactPreferences(data.contact_preferences) },
      });
    }
    if (event.httpMethod === "PATCH") {
      const v = validateCustomerBody(body);
      if (!v.valid) return json(400, { error: v.errors[0] });
      if (!body.id) return json(400, { error: "Customer id is required." });
      const { data: existing, error: readError } = await client
        .from("customers")
        .select("*")
        .eq("id", body.id)
        .eq("shop_id",shopId)
        .is("deleted_at", null)
        .maybeSingle();
      if (readError) throw readError;
      if (!existing) return json(404, { error: "Customer not found." });
      requireRowShopId(existing, shopId, "Customer");
      const dup = await findDuplicateCustomer(client, shopId, {
        phone: body.phone,
        email: body.email,
        excludeId: body.id,
      });
      if (dup.duplicate) {
        return json(409, {
          error: `Another customer already uses this ${dup.field} (${dup.existing?.name || "duplicate"}).`,
          existing_id: dup.existing?.id,
        });
      }
      const payload = {};
      for (const f of fields) if (f in body && f !== "contact_preferences") payload[f] = body[f];
      applyContactPreferences(payload, body, {
        isCreate: false,
        previous: existing.contact_preferences,
      });
      const { data, error } = await client
        .from("customers")
        .update(payload)
        .eq("id", body.id)
        .eq("shop_id",shopId)
        .select("*")
        .single();
      if (error) throw error;
      const prefAudit = contactPreferenceAuditMetadata(
        existing.contact_preferences,
        data.contact_preferences,
      );
      await writeShopAudit(client, {
        shopId,
        userId: user?.id,
        eventType: prefAudit ? "customer_preferences_updated" : "customer_updated",
        entityType: "customer",
        entityId: data.id,
        metadata: prefAudit || {},
      });
      return json(200, {
        item: { ...data, contact_preferences: resolveContactPreferences(data.contact_preferences) },
      });
    }
    if (event.httpMethod === "DELETE") {
      if (!body.id) return json(400, { error: "Customer id is required." });
      const { data: existing } = await client
        .from("customers")
        .select("id, shop_id")
        .eq("id", body.id)
        .maybeSingle();
      requireRowShopId(existing, shopId, "Customer");
      const { error } = await client
        .from("customers")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("shop_id",shopId);
      if (error) throw error;
      await writeShopAudit(client, {
        shopId,
        userId: user?.id,
        eventType: "customer_deleted",
        entityType: "customer",
        entityId: body.id,
      });
      return json(200, { ok: true });
    }
    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
