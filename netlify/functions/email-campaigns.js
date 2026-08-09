import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import { validateEmailCampaignBody } from "./_shared/holiday-weddings-email.js";

function featureGate() {
  if (!isFeatureEnabled("EMAIL_CAMPAIGNS")) {
    const e = new Error("Email Campaigns is disabled.");
    e.statusCode = 503;
    e.code = "email_campaigns_disabled";
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
    "Email Campaigns tables are not set up yet. Apply the email campaigns migration, then try again."
  );
  e.statusCode = 503;
  e.code = "email_campaigns_not_migrated";
  throw e;
}

function sendEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.FLORISYN_EMAIL_CAMPAIGNS_SEND || ""));
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
        .from("email_campaigns")
        .select("*")
        .eq("shop_id", shopId)
        .order("updated_at", { ascending: false });
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, {
        items: data || [],
        send_enabled: sendEnabled(),
      });
    }

    if (method === "POST" && (!action || action === "create")) {
      const v = validateEmailCampaignBody(body);
      if (!v.valid) return json(400, { error: v.error });
      const payload = {
        ...v.sanitized,
        status: "draft",
        shop_id: shopId,
        created_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client.from("email_campaigns").insert(payload).select().single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(201, { item: data });
    }

    if (method === "POST" && action === "update") {
      if (!body.id) return json(400, { error: "Missing campaign id." });
      const v = validateEmailCampaignBody(body, { partial: true });
      if (!v.valid) return json(400, { error: v.error });
      // Never allow clients to mark sent via generic update.
      if (v.sanitized.status === "sent") delete v.sanitized.status;
      const payload = { ...v.sanitized, updated_at: new Date().toISOString() };
      const { data, error } = await client
        .from("email_campaigns")
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

    if (method === "POST" && action === "schedule") {
      if (!body.id) return json(400, { error: "Missing campaign id." });
      const when = body.scheduled_at ? Date.parse(String(body.scheduled_at)) : Date.now();
      if (Number.isNaN(when)) return json(400, { error: "Invalid scheduled time." });
      const { data, error } = await client
        .from("email_campaigns")
        .update({
          status: "scheduled",
          scheduled_at: new Date(when).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .in("status", ["draft", "scheduled"])
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { item: data });
    }

    if (method === "POST" && action === "cancel") {
      if (!body.id) return json(400, { error: "Missing campaign id." });
      const { data, error } = await client
        .from("email_campaigns")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .neq("status", "sent")
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { item: data });
    }

    if (method === "POST" && action === "send") {
      if (!body.id) return json(400, { error: "Missing campaign id." });
      if (!sendEnabled()) {
        return json(503, {
          error: "Email send pipeline is not enabled. Draft and schedule only until domain send is configured.",
          code: "email_send_disabled",
        });
      }
      // Fail-closed stub: mark sent locally only when explicitly enabled. No external provider yet.
      const { data, error } = await client
        .from("email_campaigns")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .in("status", ["draft", "scheduled"])
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { item: data, delivery: "local_stub" });
    }

    if (method === "DELETE" || (method === "POST" && action === "delete")) {
      if (!body.id) return json(400, { error: "Missing campaign id." });
      const { error } = await client
        .from("email_campaigns")
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
