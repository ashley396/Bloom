import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import { validateMarketingCampaignBody } from "./_shared/marketing-campaigns.js";
import { buildAudienceSegments } from "../../lib/marketing/audience-segments.js";

function featureGate() {
  if (!isFeatureEnabled("MARKETING_CAMPAIGNS")) {
    const e = new Error("Marketing Campaigns is disabled.");
    e.statusCode = 503;
    e.code = "marketing_campaigns_disabled";
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
    "Marketing Campaigns tables are not set up yet. Apply the marketing campaigns migration, then try again."
  );
  e.statusCode = 503;
  e.code = "marketing_campaigns_not_migrated";
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

    // Checked before the generic GET/list branch below — that branch
    // matches any GET request regardless of action, which would otherwise
    // shadow "GET ?action=audiences" and silently return the campaign
    // list instead (same route-precedence gotcha as elsewhere in this
    // codebase: the more specific handler has to run first).
    if (action === "audiences") {
      // Only the columns segmentation actually needs — never fetch a
      // customer's name, phone, email, address, or notes here. Every
      // segment definition itself starts from marketing_opt_in, but this
      // is the belt to that suspenders: even a bug in buildAudienceSegments
      // couldn't leak PII this endpoint never asked for.
      const [{ data: customers, error: cErr }, { data: orders, error: oErr }] = await Promise.all([
        client
          .from("customers")
          .select("id,vip,birthday,anniversary,created_at,contact_preferences")
          .eq("shop_id", shopId)
          .is("deleted_at", null),
        client.from("orders").select("customer_id,total,occasion,fulfillment,created_at").eq("shop_id", shopId),
      ]);
      if (cErr) throw cErr;
      if (oErr) throw oErr;
      const { segments, subscriberCount } = buildAudienceSegments({ customers: customers || [], orders: orders || [] });
      return json(200, {
        subscriberCount,
        segments: segments.map(({ key, label, count }) => ({ key, label, count })),
      });
    }

    if (method === "GET" || action === "list") {
      const { data, error } = await client
        .from("marketing_campaigns")
        .select("*")
        .eq("shop_id", shopId)
        .order("updated_at", { ascending: false });
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { items: data || [] });
    }

    if (method === "POST" && (!action || action === "create")) {
      const v = validateMarketingCampaignBody(body);
      if (!v.valid) return json(400, { error: v.error });
      const payload = {
        ...v.sanitized,
        shop_id: shopId,
        created_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client.from("marketing_campaigns").insert(payload).select().single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(201, { item: data });
    }

    if (method === "POST" && action === "update") {
      if (!body.id) return json(400, { error: "Missing campaign id." });
      const v = validateMarketingCampaignBody(body, { partial: true });
      if (!v.valid) return json(400, { error: v.error });
      const payload = { ...v.sanitized, updated_at: new Date().toISOString() };
      const { data, error } = await client
        .from("marketing_campaigns")
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

    // Attach an existing Email Campaign or Holiday peak to this campaign
    // (or detach with content_id + campaign_id: null) — the join that
    // actually connects Marketing's previously-disconnected tools.
    if (method === "POST" && action === "attach") {
      if (!body.content_type || !body.content_id) {
        return json(400, { error: "Missing content_type or content_id." });
      }
      if (body.campaign_id) {
        const { data: campaign, error: cErr } = await client
          .from("marketing_campaigns")
          .select("id")
          .eq("id", body.campaign_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (cErr) throw cErr;
        if (!campaign) return json(404, { error: "Campaign not found." });
      }
      const table = body.content_type === "email_campaign" ? "email_campaigns" : body.content_type === "holiday_peak" ? "holiday_peaks" : null;
      if (!table) return json(400, { error: "content_type must be email_campaign or holiday_peak." });
      const { data, error } = await client
        .from(table)
        .update({ campaign_id: body.campaign_id || null, updated_at: new Date().toISOString() })
        .eq("id", body.content_id)
        .eq("shop_id", shopId)
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { item: data });
    }

    if (method === "DELETE" || (method === "POST" && action === "delete")) {
      if (!body.id) return json(400, { error: "Missing campaign id." });
      const { error } = await client
        .from("marketing_campaigns")
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
