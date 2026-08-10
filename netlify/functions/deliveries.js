import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { writeShopAudit } from "./_shared/production.js";
import { requireRowShopId } from "./_shared/shop-scope.js";
import { optimizeRouteStops } from "../../lib/delivery/route-board.js";
import {
  uploadDeliveryProof,
  attachDeliveryProofUrls,
  validateProofCaptureBody,
  DELIVERY_PROOF_BUCKET,
  DELIVERY_PROOF_SIGNED_URL_SECONDS,
  isStoragePath,
} from "./_shared/delivery-proof.js";

const TABLE = "deliveries";
const FIELDS = [
  "order_id",
  "address",
  "driver",
  "route_order",
  "status",
  "delivered_at",
  "notes",
  "round_trip_miles",
  "drive_minutes",
  "delivery_date",
  "delivery_window",
  "recipient_name",
  "recipient_phone",
  "signature_name",
  "proof_captured_at",
];
const ORDER = "created_at";

async function loadDelivery(client, id, shopId) {
  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function captureDeliveryProof(client, shopId, user, body) {
  if (!body.id) throw Object.assign(new Error("Missing delivery id"), { statusCode: 400 });
  const existing = await loadDelivery(client, body.id, shopId);
  if (!existing) throw Object.assign(new Error("Delivery not found."), { statusCode: 404 });
  requireRowShopId(existing, shopId, "Delivery");

  const validation = validateProofCaptureBody(body);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.errors[0]), { statusCode: 400 });
  }

  const payload = {};
  let proofSaved = false;
  let uploadError = null;

  if (body.proof_data_url) {
    const upload = await uploadDeliveryProof(client, shopId, body.proof_data_url);
    if (!upload.ok) {
      uploadError = upload.error;
    } else if (upload.path) {
      payload.proof_photo_url = upload.path;
      if (existing.proof_photo_url && isStoragePath(existing.proof_photo_url)) {
        await client.storage.from(DELIVERY_PROOF_BUCKET).remove([existing.proof_photo_url]);
      }
      proofSaved = true;
    }
  } else if (validation.deliveredWithoutPhoto) {
    proofSaved = true;
  }

  if (uploadError) {
    return json(400, {
      error: uploadError,
      proof_saved: false,
      status_unchanged: true,
      item: existing,
    });
  }

  if ("recipient_name" in body) payload.recipient_name = String(body.recipient_name || "").trim();
  if ("signature_name" in body) payload.signature_name = String(body.signature_name || "").trim();
  if ("notes" in body || body.delivery_note) {
    payload.notes = String(body.notes || body.delivery_note || "").trim();
  }

  const shouldMarkDelivered =
    Boolean(body.mark_delivered) &&
    (proofSaved || validation.deliveredWithoutPhoto);

  if (!shouldMarkDelivered && Boolean(body.mark_delivered) && !proofSaved) {
    return json(400, {
      error: "Delivery proof was not saved. Status was not changed.",
      proof_saved: false,
      status_unchanged: true,
      item: existing,
    });
  }

  if (shouldMarkDelivered) {
    payload.status = "DELIVERED";
    payload.delivered_at = body.delivered_at || new Date().toISOString();
    payload.proof_captured_at = new Date().toISOString();
    if (validation.deliveredWithoutPhoto) {
      const reasonNote = `[Delivered without photo] ${validation.noPhotoReason}`;
      payload.notes = payload.notes ? `${payload.notes}\n${reasonNote}` : reasonNote;
    }
  } else if (proofSaved) {
    payload.proof_captured_at = new Date().toISOString();
  }

  const { data, error } = await client
    .from(TABLE)
    .update(payload)
    .eq("id", body.id)
    .eq("shop_id", shopId)
    .select("*")
    .single();
  if (error) throw error;

  const [withUrl] = await attachDeliveryProofUrls(client, [data]);
  await writeShopAudit(client, {
    shopId,
    userId: user?.id,
    eventType: shouldMarkDelivered ? "delivery_proof_completed" : "delivery_proof_saved",
    entityType: "delivery",
    entityId: data.id,
    metadata: {
      order_id: data.order_id,
      delivered_without_photo: validation.deliveredWithoutPhoto,
      proof_saved: proofSaved,
    },
  });

  return json(200, {
    item: withUrl,
    proof_saved: proofSaved,
    marked_delivered: shouldMarkDelivered,
  });
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const { client, shopId, user } = await currentUser(event);
    const qs = event.queryStringParameters || {};

    if (event.httpMethod === "GET") {
      let q = client.from(TABLE).select("*").eq("shop_id", shopId);
      if (qs.order_id) q = q.eq("order_id", qs.order_id);
      const { data, error } = await q.order(ORDER, { ascending: false });
      if (error) throw error;
      const items = await attachDeliveryProofUrls(client, data || []);
      return json(200, {
        items,
        proof_url_ttl_seconds: DELIVERY_PROOF_SIGNED_URL_SECONDS,
      });
    }

    const body = bodyOf(event);

    if (event.httpMethod === "POST" && body.action === "optimize_route") {
      const { data: stops, error: listError } = await client
        .from(TABLE)
        .select("*")
        .eq("shop_id", shopId);
      if (listError) throw listError;
      const optimized = optimizeRouteStops(stops || []);
      for (const stop of optimized) {
        if (stop.route_order == null) continue;
        await client
          .from(TABLE)
          .update({ route_order: stop.route_order })
          .eq("id", stop.id)
          .eq("shop_id", shopId);
      }
      const { data: refreshed, error: refreshError } = await client
        .from(TABLE)
        .select("*")
        .eq("shop_id", shopId)
        .order("route_order", { ascending: true, nullsFirst: false })
        .order(ORDER, { ascending: false });
      if (refreshError) throw refreshError;
      const items = await attachDeliveryProofUrls(client, refreshed || []);
      return json(200, { items, optimized: true });
    }

    if (event.httpMethod === "POST" && (body.action === "capture_proof" || qs.action === "proof")) {
      return captureDeliveryProof(client, shopId, user, body);
    }

    if (event.httpMethod === "POST") {
      const payload = { shop_id: shopId };
      for (const f of FIELDS) if (f in body) payload[f] = body[f];
      const { data, error } = await client.from(TABLE).insert(payload).select("*").single();
      if (error) throw error;
      return json(201, { item: data });
    }

    if (event.httpMethod === "PATCH") {
      if (body.action === "capture_proof") {
        return captureDeliveryProof(client, shopId, user, body);
      }
      if (!body.id) throw Object.assign(new Error("Missing id"), { statusCode: 400 });
      const existing = await loadDelivery(client, body.id, shopId);
      if (!existing) throw Object.assign(new Error("Delivery not found."), { statusCode: 404 });
      requireRowShopId(existing, shopId, "Delivery");

      const payload = {};
      for (const f of FIELDS) if (f in body) payload[f] = body[f];
      const { data, error } = await client
        .from(TABLE)
        .update(payload)
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .select("*")
        .single();
      if (error) throw error;
      const [withUrl] = await attachDeliveryProofUrls(client, [data]);
      return json(200, { item: withUrl });
    }

    if (event.httpMethod === "DELETE") {
      if (!body.id) throw Object.assign(new Error("Missing id"), { statusCode: 400 });
      const existing = await loadDelivery(client, body.id, shopId);
      requireRowShopId(existing, shopId, "Delivery");
      const { error } = await client.from(TABLE).delete().eq("id", body.id).eq("shop_id", shopId);
      if (error) throw error;
      if (existing?.proof_photo_url && isStoragePath(existing.proof_photo_url)) {
        await client.storage.from(DELIVERY_PROOF_BUCKET).remove([existing.proof_photo_url]);
      }
      return json(200, { ok: true });
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
