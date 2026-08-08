import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import {
  validateHolidayPeakBody,
  holidayCapacityAlert,
} from "./_shared/holiday-weddings-email.js";

function featureGate() {
  if (!isFeatureEnabled("HOLIDAY_COMMAND_CENTER")) {
    const e = new Error("Holiday Command Center is disabled.");
    e.statusCode = 503;
    e.code = "holiday_command_disabled";
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
    "Holiday Command Center tables are not set up yet. Apply the holiday migration, then try again."
  );
  e.statusCode = 503;
  e.code = "holiday_not_migrated";
  throw e;
}

function withAlerts(items) {
  return (items || []).map((item) => ({
    ...item,
    capacity: holidayCapacityAlert(item),
  }));
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    featureGate();
    const { client, shopId, user } = await currentUser(event);
    const method = event.httpMethod;

    if (method === "GET") {
      const { data, error } = await client
        .from("holiday_peaks")
        .select("*")
        .eq("shop_id", shopId)
        .order("starts_on", { ascending: false });
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { items: withAlerts(data) });
    }

    if (method === "POST") {
      const body = bodyOf(event);
      const v = validateHolidayPeakBody(body);
      if (!v.valid) return json(400, { error: v.error });
      const payload = {
        ...v.sanitized,
        shop_id: shopId,
        created_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client.from("holiday_peaks").insert(payload).select().single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(201, { item: withAlerts([data])[0] });
    }

    if (method === "PATCH") {
      const body = bodyOf(event);
      if (!body?.id) return json(400, { error: "Missing holiday peak id." });
      const v = validateHolidayPeakBody(body, { partial: true });
      if (!v.valid) return json(400, { error: v.error });
      const payload = { ...v.sanitized, updated_at: new Date().toISOString() };
      const { data, error } = await client
        .from("holiday_peaks")
        .update(payload)
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { item: withAlerts([data])[0] });
    }

    if (method === "DELETE") {
      const body = bodyOf(event);
      if (!body?.id) return json(400, { error: "Missing holiday peak id." });
      const { error } = await client
        .from("holiday_peaks")
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
