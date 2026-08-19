import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import { validateMarketingPromotionBody } from "./_shared/marketing-promotions.js";

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
    "Marketing Promotions tables are not set up yet. Apply the marketing promotions migration, then try again."
  );
  e.statusCode = 503;
  e.code = "marketing_promotions_not_migrated";
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
        .from("marketing_promotions")
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
      const v = validateMarketingPromotionBody(body);
      if (!v.valid) return json(400, { error: v.error });
      const payload = {
        ...v.sanitized,
        status: "draft",
        shop_id: shopId,
        created_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client.from("marketing_promotions").insert(payload).select().single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(201, { item: data });
    }

    if (method === "POST" && action === "update") {
      if (!body.id) return json(400, { error: "Missing promotion id." });
      const v = validateMarketingPromotionBody(body, { partial: true });
      if (!v.valid) return json(400, { error: v.error });
      const payload = { ...v.sanitized, updated_at: new Date().toISOString() };
      const { data, error } = await client
        .from("marketing_promotions")
        .update(payload)
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .eq("status", "draft") // never edit terms of a promotion that's already active or ended
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { item: data });
    }

    // The safety preview (products affected, discount, dates, eligibility)
    // is shown client-side before this is ever called — this endpoint just
    // enforces the state transition and stamps who activated it and when,
    // matching the audit-trail requirement for a live-money-affecting action.
    if (method === "POST" && action === "activate") {
      if (!body.id) return json(400, { error: "Missing promotion id." });
      const { data, error } = await client
        .from("marketing_promotions")
        .update({ status: "active", activated_by: user?.id || null, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .eq("status", "draft")
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      if (!data) return json(409, { error: "Only a draft promotion can be activated." });
      return json(200, { item: data });
    }

    if (method === "POST" && action === "end") {
      if (!body.id) return json(400, { error: "Missing promotion id." });
      const { data, error } = await client
        .from("marketing_promotions")
        .update({ status: "ended", updated_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .neq("status", "draft")
        .select()
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { item: data });
    }

    if (method === "DELETE" || (method === "POST" && action === "delete")) {
      if (!body.id) return json(400, { error: "Missing promotion id." });
      const { error } = await client
        .from("marketing_promotions")
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
