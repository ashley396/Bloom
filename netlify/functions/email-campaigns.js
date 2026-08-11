import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import { validateEmailCampaignBody } from "./_shared/holiday-weddings-email.js";
import { dispatchEmail, emailProviderConfigured } from "./_shared/notification-email.js";

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
  if (emailProviderConfigured(env).configured) return true;
  return /^(1|true|yes|on)$/i.test(String(env.FLORISYN_EMAIL_CAMPAIGNS_SEND || ""));
}

async function campaignRecipients(client, shopId) {
  const { data, error } = await client
    .from("customers")
    .select("email,contact_preferences")
    .eq("shop_id", shopId)
    .not("email", "is", null);
  if (error) throw error;
  return (data || []).filter((row) => {
    const prefs = row.contact_preferences && typeof row.contact_preferences === "object" ? row.contact_preferences : {};
    return prefs.marketing_opt_in !== false && String(row.email || "").includes("@");
  });
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
          error: "Email send is not configured. Add RESEND_API_KEY in Netlify or set FLORISYN_EMAIL_CAMPAIGNS_SEND=true for local stub mode.",
          code: "email_send_disabled",
        });
      }
      const { data: campaign, error: loadError } = await client
        .from("email_campaigns")
        .select("*")
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .in("status", ["draft", "scheduled"])
        .single();
      if (loadError) {
        if (missingRelation(loadError)) friendlyMissing();
        throw loadError;
      }

      const provider = emailProviderConfigured(process.env);
      let delivery = "local_stub";
      let sentCount = 0;
      let failedCount = 0;

      if (provider.configured) {
        const recipients = await campaignRecipients(client, shopId);
        const testTo = String(body.test_to || "").trim();
        const targets = testTo ? [{ email: testTo }] : recipients;
        if (!targets.length) {
          return json(400, { error: "No marketing recipients found. Add customer emails or pass test_to." });
        }
        for (const row of targets.slice(0, 500)) {
          const result = await dispatchEmail(process.env, {
            to: row.email,
            subject: campaign.subject,
            html: campaign.body_html,
            text: campaign.preview_text || campaign.subject,
          });
          if (result.ok) sentCount += 1;
          else failedCount += 1;
        }
        delivery = provider.provider;
        if (!sentCount) {
          return json(502, { error: "Email provider rejected all sends.", code: "email_send_failed", failedCount });
        }
      }

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
      return json(200, { item: data, delivery, sentCount, failedCount });
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
