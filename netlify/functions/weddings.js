import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import {
  validateWeddingProjectBody,
  validateWeddingChecklistBody,
  validateInspirationPhotoBody,
} from "./_shared/holiday-weddings-email.js";
import { uploadWebsiteMedia, publicWebsiteMediaUrl } from "./_shared/website-media.js";

function featureGate() {
  if (!isFeatureEnabled("WEDDING_WORKFLOWS")) {
    const e = new Error("Wedding Workflows is disabled.");
    e.statusCode = 503;
    e.code = "wedding_workflows_disabled";
    throw e;
  }
}

function missingRelation(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the table")
  );
}

function friendlyMissing() {
  const e = new Error(
    "Wedding Workflows tables are not set up yet. Apply the weddings migration, then try again."
  );
  e.statusCode = 503;
  e.code = "weddings_not_migrated";
  throw e;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    featureGate();
    const { client, shopId, user } = await currentUser(event);
    const method = event.httpMethod;
    const qs = event.queryStringParameters || {};
    const body = method === "GET" ? {} : bodyOf(event);
    const action = String(body.action || qs.action || "").toLowerCase();

    if (method === "GET" || action === "list") {
      const { data, error } = await client
        .from("wedding_projects")
        .select("*, wedding_checklist_items(*), wedding_inspiration_photos(*)")
        .eq("shop_id", shopId)
        .order("event_date", { ascending: true, nullsFirst: false });
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      const items = (data || []).map((row) => {
        const checklist = (row.wedding_checklist_items || []).sort(
          (a, b) => (a.sort_order || 0) - (b.sort_order || 0)
        );
        const inspiration = (row.wedding_inspiration_photos || [])
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
          .map((photo) => ({ ...photo, url: publicWebsiteMediaUrl(client, photo.storage_path) }));
        const { wedding_checklist_items, wedding_inspiration_photos, ...rest } = row;
        return { ...rest, checklist, inspiration_photos: inspiration };
      });
      return json(200, { items });
    }

    if (method === "POST" && (!action || action === "create")) {
      const v = validateWeddingProjectBody(body);
      if (!v.valid) return json(400, { error: v.error });
      if (v.sanitized.customer_id) {
        const { data: cust, error: cErr } = await client
          .from("customers")
          .select("id")
          .eq("id", v.sanitized.customer_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (cErr) throw cErr;
        if (!cust) return json(400, { error: "Customer not found in this shop." });
      }
      if (v.sanitized.order_id) {
        const { data: ord, error: oErr } = await client
          .from("orders")
          .select("id")
          .eq("id", v.sanitized.order_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (oErr) throw oErr;
        if (!ord) return json(400, { error: "Order not found in this shop." });
      }
      const payload = {
        ...v.sanitized,
        shop_id: shopId,
        created_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client.from("wedding_projects").insert(payload).select().single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(201, { item: { ...data, checklist: [] } });
    }

    if (method === "POST" && action === "update") {
      if (!body.id) return json(400, { error: "Missing wedding id." });
      const v = validateWeddingProjectBody(body, { partial: true });
      if (!v.valid) return json(400, { error: v.error });
      if (v.sanitized.customer_id) {
        const { data: cust, error: cErr } = await client
          .from("customers")
          .select("id")
          .eq("id", v.sanitized.customer_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (cErr) throw cErr;
        if (!cust) return json(400, { error: "Customer not found in this shop." });
      }
      if (v.sanitized.order_id) {
        const { data: ord, error: oErr } = await client
          .from("orders")
          .select("id")
          .eq("id", v.sanitized.order_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (oErr) throw oErr;
        if (!ord) return json(400, { error: "Order not found in this shop." });
      }
      const payload = { ...v.sanitized, updated_at: new Date().toISOString() };
      const { data, error } = await client
        .from("wedding_projects")
        .update(payload)
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { item: data });
    }

    if (method === "POST" && action === "add_checklist") {
      if (!body.wedding_id) return json(400, { error: "Missing wedding id." });
      const v = validateWeddingChecklistBody(body);
      if (!v.valid) return json(400, { error: v.error });
      const { data: wedding, error: wErr } = await client
        .from("wedding_projects")
        .select("id")
        .eq("id", body.wedding_id)
        .eq("shop_id", shopId)
        .maybeSingle();
      if (wErr) {
        if (missingRelation(wErr)) friendlyMissing();
        throw wErr;
      }
      if (!wedding) return json(404, { error: "Wedding not found." });
      const payload = {
        ...v.sanitized,
        shop_id: shopId,
        wedding_id: body.wedding_id,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client
        .from("wedding_checklist_items")
        .insert(payload)
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(201, { item: data });
    }

    if (method === "POST" && action === "toggle_checklist") {
      if (!body.id) return json(400, { error: "Missing checklist item id." });
      const { data: existing, error: rErr } = await client
        .from("wedding_checklist_items")
        .select("*")
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .maybeSingle();
      if (rErr) {
        if (missingRelation(rErr)) friendlyMissing();
        throw rErr;
      }
      if (!existing) return json(404, { error: "Checklist item not found." });
      const next =
        body.is_done === undefined ? !existing.is_done : Boolean(body.is_done);
      const { data, error } = await client
        .from("wedding_checklist_items")
        .update({ is_done: next, updated_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .select()
        .single();
      if (error) throw error;
      return json(200, { item: data });
    }

    if (method === "POST" && action === "add_inspiration_photo") {
      if (!body.wedding_id) return json(400, { error: "Missing wedding id." });
      const v = validateInspirationPhotoBody(body);
      if (!v.valid) return json(400, { error: v.error });
      const { data: wedding, error: wErr } = await client
        .from("wedding_projects")
        .select("id")
        .eq("id", body.wedding_id)
        .eq("shop_id", shopId)
        .maybeSingle();
      if (wErr) {
        if (missingRelation(wErr)) friendlyMissing();
        throw wErr;
      }
      if (!wedding) return json(404, { error: "Wedding not found." });

      // Reuses Website Studio's own upload pipeline (same bucket, same
      // validation, same public-URL convention) rather than a second
      // storage system — see website-media.js.
      const uploaded = await uploadWebsiteMedia(client, shopId, {
        dataUrl: body.data_url,
        filename: body.filename
      });
      if (!uploaded.ok) return json(400, { error: uploaded.error });

      const payload = {
        shop_id: shopId,
        wedding_id: body.wedding_id,
        storage_path: uploaded.path,
        caption: v.sanitized.caption,
        sort_order: v.sanitized.sort_order,
        created_by: user?.id || null
      };
      const { data, error } = await client
        .from("wedding_inspiration_photos")
        .insert(payload)
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(201, { item: { ...data, url: publicWebsiteMediaUrl(client, data.storage_path) } });
    }

    if (method === "POST" && action === "remove_inspiration_photo") {
      if (!body.id) return json(400, { error: "Missing inspiration photo id." });
      const { error } = await client
        .from("wedding_inspiration_photos")
        .delete()
        .eq("id", body.id)
        .eq("shop_id", shopId);
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { ok: true });
    }

    if (method === "DELETE" || (method === "POST" && action === "delete")) {
      if (!body.id) return json(400, { error: "Missing wedding id." });
      const { error } = await client
        .from("wedding_projects")
        .delete()
        .eq("id", body.id)
        .eq("shop_id", shopId);
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { ok: true });
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
