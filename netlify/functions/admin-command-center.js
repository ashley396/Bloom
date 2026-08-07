import { json } from "./_shared/saas.js";
import {
  platformAdmin,
  writeCommandAudit,
  requireSuperAdmin,
  platformAdminErrorResponse,
  platformAdminError,
  parsePlatformAdminJsonBody
} from "./_shared/platform-admin.js";
import {
  auditRecordFromRow,
  buildMonthlySeries,
  buildRevenueSeries,
  mergeFeatureFlags,
  PLATFORM_FEATURE_FLAGS,
  sanitizeSubscriptionForAdmin,
  systemHealthSnapshot,
  validateAnnouncementPayload
} from "./_shared/command-center.js";
import { detectIntent, mapAdminInsight } from "./_shared/lily-ai-engine.js";
import { getProductionConfig, BETA_READINESS_CHECKLIST, securityReviewSummary } from "./_shared/production.js";
import {
  BLOOM_VERSION_CODE,
  BLOOM_VERSION_LABEL,
  KNOWN_ISSUES_V1,
  probeMigrationStatus
} from "./_shared/bloom-release.js";
import { isMissingVerificationTableError } from "./_shared/marketplace-verification.js";
import { buildPlatformPaymentMetrics } from "./_shared/payment-hub-pro.js";
import { computeAdminSubscriptionMetrics } from "./_shared/subscription-center.js";
import { buildPaymentOperationsMetrics } from "./_shared/payment-operations-admin.js";

const VERIFICATION_TABLE = "marketplace_verification_applications";

function isMissingTableError(error) {
  if (isMissingVerificationTableError(error)) return true;
  if (!error) return false;
  const message = String(error.message || error.details || "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find the table");
}

function clientIp(event) {
  return event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || event.headers["client-ip"] || "unknown";
}

async function safeCount(client, table) {
  try {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
    if (error) {
      if (isMissingTableError(error)) return null;
      console.error(JSON.stringify({
        event: "admin_command_center_safe_count_error",
        table,
        code: error.code || null,
        message: String(error.message || "").slice(0, 180)
      }));
      return null;
    }
    return count || 0;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    console.error(JSON.stringify({
      event: "admin_command_center_safe_count_throw",
      table,
      message: String(error?.message || error).slice(0, 180)
    }));
    return null;
  }
}

async function safeSelect(client, table, build) {
  try {
    const query = build(client.from(table));
    const result = await query;
    if (result.error) {
      if (isMissingTableError(result.error)) return [];
      console.error(JSON.stringify({
        event: "admin_command_center_safe_select_error",
        table,
        code: result.error.code || null,
        message: String(result.error.message || "").slice(0, 180)
      }));
      return [];
    }
    return result.data || [];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    console.error(JSON.stringify({
      event: "admin_command_center_safe_select_throw",
      table,
      message: String(error?.message || error).slice(0, 180)
    }));
    return [];
  }
}

/** Test seam — production uses bound real dependencies via exported `handler`. */
export function createAdminCommandCenterHandler(deps = {}) {
  return async function handler(event, _context) {
  try {
    const { client, user, admin } = await platformAdmin(event, ["super_admin"], deps);
    const body = parsePlatformAdminJsonBody(event);
    const action = body.action || event.queryStringParameters?.action || "dashboard";
    const ip = clientIp(event);

    if (event.httpMethod === "GET" && action === "dashboard") {
      const [
        shopsCount,
        membersCount,
        ordersCount,
        listingsCount,
        sellerProfilesCount,
        subs,
        shops,
        orders,
        aiTodayRows
      ] = await Promise.all([
        safeCount(client, "shops"),
        safeCount(client, "shop_members"),
        safeCount(client, "orders"),
        safeCount(client, "marketplace_listings"),
        safeCount(client, "marketplace_seller_profiles"),
        safeSelect(client, "shop_subscriptions", (q) =>
          q.select("shop_id,plan_code,status,cancel_at_period_end,created_at,updated_at,stripe_customer_id,current_period_ends_at")
        ),
        safeSelect(client, "shops", (q) => q.select("id,created_at").order("created_at", { ascending: false }).limit(500)),
        safeSelect(client, "orders", (q) => q.select("id,total,created_at").order("created_at", { ascending: false }).limit(500)),
        safeSelect(client, "platform_ai_usage_daily", (q) =>
          q.select("request_count").eq("usage_date", new Date().toISOString().slice(0, 10)).limit(1)
        )
      ]);

      let pendingFloristVerifications = null;
      let pendingSellerVerifications = null;
      try {
        const vRes = await client
          .from(VERIFICATION_TABLE)
          .select("id, status", { count: "exact" })
          .in("status", ["submitted", "under_review", "more_info_required"]);
        if (!vRes.error) pendingFloristVerifications = vRes.count || 0;
      } catch {
        pendingFloristVerifications = null;
      }

      try {
        const pendingListings = await client
          .from("marketplace_listings")
          .select("id", { count: "exact", head: true })
          .eq("admin_review_status", "pending");
        if (!pendingListings.error) pendingSellerVerifications = pendingListings.count || 0;
      } catch {
        pendingSellerVerifications = null;
      }

      const active = (subs || []).filter((x) => ["trialing", "active"].includes(x.status));
      const price = { starter: 39, professional: 79, premium: 129 };
      const mrr = active.filter((x) => x.status === "active").reduce((sum, x) => sum + (price[x.plan_code] || 0), 0);

      const wholesaleOrders = await safeSelect(client, "marketplace_wholesale_orders", (q) =>
        q.select("total,created_at,status").limit(500)
      );
      const grossMarketplace = wholesaleOrders
        .filter((o) => ["paid", "fulfilled", "completed"].includes(String(o.status).toLowerCase()))
        .reduce((sum, o) => sum + Number(o.total || 0), 0);

      const charts = {
        revenue: buildRevenueSeries(orders),
        new_customers: buildMonthlySeries(shops),
        marketplace_orders: buildMonthlySeries(wholesaleOrders),
        subscription_growth: buildMonthlySeries(
          (subs || []).map((s) => ({ created_at: s.created_at })),
          { months: 6 }
        )
      };

      return json(200, {
        admin,
        kpis: {
          total_florists: shopsCount,
          total_wholesalers: sellerProfilesCount ?? listingsCount,
          total_marketplace_sellers: sellerProfilesCount,
          total_marketplace_listings: listingsCount,
          pending_florist_verifications: pendingFloristVerifications,
          pending_seller_verifications: pendingSellerVerifications,
          pending_marketplace_approvals: (pendingFloristVerifications || 0) + (pendingSellerVerifications || 0),
          total_orders: ordersCount,
          gross_marketplace_sales: grossMarketplace,
          marketplace_revenue: grossMarketplace,
          monthly_recurring_revenue: mrr,
          active_subscriptions: active.length,
          ai_requests_today: aiTodayRows[0] ? Number(aiTodayRows[0].request_count || 0) : null,
          online_users: null,
          members_count: membersCount
        },
        charts
      });
    }

    if (event.httpMethod === "GET" && action === "users") {
      const search = String(event.queryStringParameters?.search || body.search || "").trim();
      const roleFilter = String(event.queryStringParameters?.role || "").trim();
      let query = client
        .from("shop_members")
        .select("user_id,shop_id,role,status,created_at,shops(name,email,city,state)")
        .eq("status", "active")
        .limit(200);
      if (roleFilter) query = query.eq("role", roleFilter);
      const { data, error } = await query;
      if (error) throw error;
      let rows = data || [];
      if (search) rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
      const admins = await client.from("platform_admins").select("user_id,role,display_name,active");
      return json(200, { users: rows, admins: admins.data || [] });
    }

    if (event.httpMethod === "GET" && action === "marketplace") {
      const listingsRes = await client
        .from("marketplace_listings")
        .select("id,shop_id,product_name,supplier_name,active,publish_status,admin_review_status,featured_at,admin_suspended_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (listingsRes.error && !isMissingTableError(listingsRes.error)) throw listingsRes.error;
      let applications = [];
      try {
        const appRes = await client
          .from(VERIFICATION_TABLE)
          .select("id,user_id,florist_shop_id,wholesaler_shop_id,status,submitted_at,created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (!appRes.error) applications = appRes.data || [];
      } catch {
        applications = [];
      }
      return json(200, {
        listings: listingsRes.data || [],
        verifications: applications
      });
    }

    if (event.httpMethod === "GET" && action === "support") {
      const { data, error } = await client
        .from("platform_support_items")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        if (isMissingTableError(error)) return json(200, { items: [] });
        throw error;
      }
      return json(200, { items: data || [] });
    }

    if (event.httpMethod === "GET" && action === "subscriptions") {
      const { data, error } = await client
        .from("shop_subscriptions")
        .select("shop_id,plan_code,status,trial_ends_at,current_period_ends_at,cancel_at_period_end,stripe_customer_id,created_at,updated_at,shops(name,email)")
        .order("updated_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      const rows = (data || []).map((row) => ({
        ...sanitizeSubscriptionForAdmin(row),
        shop_name: row.shops?.name,
        shop_email: row.shops?.email
      }));
      return json(200, {
        subscriptions: rows,
        summary: {
          active: rows.filter((r) => r.status === "active").length,
          trialing: rows.filter((r) => r.status === "trialing").length,
          canceled: rows.filter((r) => r.status === "canceled").length,
          cancel_at_period_end: rows.filter((r) => r.cancel_at_period_end).length
        }
      });
    }

    if (event.httpMethod === "GET" && action === "announcements") {
      const { data, error } = await client
        .from("platform_announcements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        if (isMissingTableError(error)) return json(200, { announcements: [] });
        throw error;
      }
      return json(200, { announcements: data || [] });
    }

    if (event.httpMethod === "GET" && action === "feature-flags") {
      const { data, error } = await client.from("platform_feature_flags").select("flag_key,enabled,description,updated_at");
      if (error) {
        if (isMissingTableError(error)) {
          return json(200, { flags: mergeFeatureFlags({}) });
        }
        throw error;
      }
      const map = {};
      (data || []).forEach((row) => {
        map[row.flag_key] = row.enabled;
      });
      return json(200, { flags: mergeFeatureFlags(map), catalog: PLATFORM_FEATURE_FLAGS });
    }

    if (event.httpMethod === "GET" && action === "analytics") {
      const [ordersRes, shopsRes, listingsRes] = await Promise.all([
        client.from("orders").select("total,created_at").order("created_at", { ascending: false }).limit(300),
        client.from("shop_members").select("shop_id,created_at").order("created_at", { ascending: false }).limit(300),
        client.from("marketplace_listings").select("id,product_name,shop_id,created_at").order("created_at", { ascending: false }).limit(100)
      ]);
      return json(200, {
        revenue_by_month: buildRevenueSeries(ordersRes.data || []),
        customer_growth: buildMonthlySeries(shopsRes.data || []),
        marketplace_growth: buildMonthlySeries(listingsRes.data || []),
        top_products: (listingsRes.data || []).slice(0, 10),
        ai_usage_note: "Connect platform_ai_usage_daily for live AI analytics after migration apply."
      });
    }

    if (event.httpMethod === "GET" && action === "system-health") {
      return json(200, {
        health: systemHealthSnapshot(),
        recent_errors: []
      });
    }

    if (event.httpMethod === "GET" && action === "subscription-analytics") {
      const { data: subs, error: subErr } = await client
        .from("shop_subscriptions")
        .select("shop_id,plan_code,status,cancel_at_period_end,current_period_ends_at");
      if (subErr && !isMissingTableError(subErr)) throw subErr;
      let events = [];
      try {
        const ev = await client.from("shop_subscription_events").select("shop_id,event_type,reason_code,created_at").limit(1000);
        if (!ev.error) events = ev.data || [];
      } catch {
        events = [];
      }
      const metrics = computeAdminSubscriptionMetrics(subs || [], events);
      const recent = events.slice(0, 50).map((e) => ({
        shop_id: e.shop_id,
        event_type: e.event_type,
        reason_code: e.reason_code,
        at: e.created_at
      }));
      return json(200, { metrics, recent_events: recent });
    }

    if (event.httpMethod === "GET" && action === "payment-operations") {
      const today = new Date().toISOString().slice(0, 10);
      const monthStart = today.slice(0, 7);
      let shopSubscriptions = [];
      let subscriptionEvents = [];
      let floristPayments = [];
      let flowerSubs = [];
      let paymentLinks = [];
      let recoveryAttempts = [];
      let recurringRuns = [];
      let providerEvents = [];
      try {
        const s = await client.from("shop_subscriptions").select("shop_id,plan_code,status,metadata,updated_at,created_at");
        if (!s.error) shopSubscriptions = s.data || [];
      } catch {
        /* optional */
      }
      try {
        const e = await client.from("shop_subscription_events").select("shop_id,event_type,created_at").limit(500);
        if (!e.error) subscriptionEvents = e.data || [];
      } catch {
        /* optional */
      }
      try {
        const p = await client.from("payments").select("amount,received_at,created_at,shop_id").gte("received_at", `${monthStart}-01`).limit(2000);
        if (!p.error) floristPayments = p.data || [];
      } catch {
        /* optional */
      }
      try {
        const f = await client.from("bloom_customer_subscriptions").select("amount,status,shop_id");
        if (!f.error) flowerSubs = f.data || [];
      } catch {
        /* optional */
      }
      try {
        const l = await client.from("payment_hub_payment_links").select("status,viewed_at,amount_paid").limit(1000);
        if (!l.error) paymentLinks = l.data || [];
      } catch {
        /* optional */
      }
      try {
        const r = await client.from("payment_hub_recovery_attempts").select("status,created_at").limit(500);
        if (!r.error) recoveryAttempts = r.data || [];
      } catch {
        /* optional */
      }
      try {
        const rr = await client.from("payment_hub_recurring_runs").select("status,error_message").limit(200);
        if (!rr.error) recurringRuns = rr.data || [];
      } catch {
        /* optional */
      }
      try {
        const ev = await client.from("payment_hub_provider_events").select("event_type,status,created_at").order("created_at", { ascending: false }).limit(200);
        if (!ev.error) providerEvents = ev.data || [];
      } catch {
        /* optional */
      }
      const webhookFailures = providerEvents.filter((e) => e.event_type === "webhook_error" || e.status === "error").length;
      return json(200, buildPaymentOperationsMetrics({
        shopSubscriptions,
        subscriptionEvents,
        floristPayments,
        flowerSubs,
        paymentLinks,
        recoveryAttempts,
        recurringRuns,
        providerEvents,
        webhookFailures
      }));
    }

    if (event.httpMethod === "GET" && action === "payment-hub-metrics") {
      let events = [];
      let refunds = [];
      try {
        const ev = await client.from("payment_hub_provider_events").select("shop_id,provider_id,event_type,status,created_at").order("created_at", { ascending: false }).limit(500);
        if (!ev.error) events = ev.data || [];
      } catch {
        events = [];
      }
      try {
        const rf = await client.from("payment_hub_refunds").select("amount,status,provider_id,created_at").order("created_at", { ascending: false }).limit(200);
        if (!rf.error) refunds = rf.data || [];
      } catch {
        refunds = [];
      }
      const metrics = buildPlatformPaymentMetrics(events);
      const failedTx = events.filter((e) => e.event_type === "transaction_failed" || e.status === "error").length;
      return json(200, {
        metrics,
        failed_transactions: failedTx,
        refund_volume: refunds.reduce((s, r) => s + Number(r.amount || 0), 0),
        refund_count: refunds.length,
        note: "Requires payment_hub_pro_v1 migration for full event stream."
      });
    }

    if (event.httpMethod === "GET" && action === "beta-toolkit") {
      const migrations = await probeMigrationStatus(client);
      const config = getProductionConfig(process.env);
      let feedback = [];
      try {
        const { data, error } = await client
          .from("platform_beta_feedback")
          .select("id,shop_id,user_id,category,message,app_version,created_at")
          .order("created_at", { ascending: false })
          .limit(100);
        if (!error) feedback = data || [];
      } catch {
        feedback = [];
      }
      return json(200, {
        version: { label: BLOOM_VERSION_LABEL, code: BLOOM_VERSION_CODE, branch: "release-candidate-v1" },
        migrations,
        known_issues: KNOWN_ISSUES_V1,
        checklist: BETA_READINESS_CHECKLIST,
        config,
        feedback,
        database: { schema_tag: "release-candidate-v1", migrations_applied: migrations.filter((m) => m.status === "applied").length }
      });
    }

    if (event.httpMethod === "GET" && action === "beta-feedback") {
      try {
        const { data, error } = await client
          .from("platform_beta_feedback")
          .select("id,shop_id,user_id,category,message,app_version,created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        return json(200, { feedback: data || [] });
      } catch (error) {
        if (isMissingTableError(error)) {
          return json(200, { feedback: [], note: "Apply 20260728_release_candidate_v1.sql to enable inbox storage." });
        }
        throw error;
      }
    }

    if (event.httpMethod === "GET" && action === "beta-readiness") {
      const config = getProductionConfig(process.env);
      return json(200, {
        checklist: BETA_READINESS_CHECKLIST,
        config,
        security: securityReviewSummary(),
        tests: { command: "node --test tests/*.test.js", note: "Run in CI before beta invite." }
      });
    }

    if (event.httpMethod === "GET" && action === "audit-log") {
      const filter = String(event.queryStringParameters?.filter || "").trim();
      let query = client.from("platform_admin_audit").select("*").order("created_at", { ascending: false }).limit(200);
      if (filter) query = query.ilike("action", `%${filter}%`);
      const { data, error } = await query;
      if (error) throw error;
      return json(200, { audit: (data || []).map(auditRecordFromRow) });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    if (action === "suspend-user") {
      requireSuperAdmin(admin);
      const shopId = body.shop_id;
      if (!shopId) return json(400, { error: "shop_id is required" });
      const { data, error } = await client
        .from("shop_admin_config")
        .upsert({ shop_id: shopId, account_status: "suspended", updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "shop_id" })
        .select()
        .single();
      if (error) throw error;
      await writeCommandAudit(client, user.id, "suspend_user", { shopId, targetType: "shop", targetId: shopId, ip });
      return json(200, { config: data });
    }

    if (action === "reactivate-user") {
      requireSuperAdmin(admin);
      const shopId = body.shop_id;
      if (!shopId) return json(400, { error: "shop_id is required" });
      const { data, error } = await client
        .from("shop_admin_config")
        .upsert({ shop_id: shopId, account_status: "active", updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "shop_id" })
        .select()
        .single();
      if (error) throw error;
      await writeCommandAudit(client, user.id, "reactivate_user", { shopId, targetType: "shop", targetId: shopId, ip });
      return json(200, { config: data });
    }

    if (action === "password-reset-workflow") {
      requireSuperAdmin(admin);
      await writeCommandAudit(client, user.id, "password_reset_workflow", {
        targetType: "user",
        targetId: body.user_id || body.email,
        ip,
        note: "Admin initiated reset workflow (manual Supabase Auth reset)."
      });
      return json(200, { ok: true, message: "Password reset workflow recorded. Complete reset in Supabase Auth dashboard." });
    }

    if (action === "marketplace-listing") {
      requireSuperAdmin(admin);
      const listingId = body.listing_id || body.id;
      const decision = String(body.decision || "").toLowerCase();
      if (!listingId) return json(400, { error: "listing_id is required" });
      const patch = { updated_at: new Date().toISOString() };
      if (decision === "approve") patch.admin_review_status = "approved";
      if (decision === "reject") patch.admin_review_status = "rejected";
      if (decision === "more_info") patch.admin_review_status = "more_info_required";
      if (decision === "suspend") {
        patch.admin_suspended_at = new Date().toISOString();
        patch.active = false;
      }
      if (decision === "remove") {
        patch.active = false;
        patch.archived_at = new Date().toISOString();
      }
      if (decision === "feature") patch.featured_at = new Date().toISOString();
      if (body.review_notes) patch.admin_review_notes = body.review_notes;
      const { data, error } = await client.from("marketplace_listings").update(patch).eq("id", listingId).select("*").single();
      if (error) throw error;
      await writeCommandAudit(client, user.id, "marketplace_listing_review", {
        targetType: "listing",
        targetId: listingId,
        ip,
        decision
      });
      return json(200, { listing: data });
    }

    if (action === "verification-review") {
      return json(400, { error: "Use marketplace-verification-admin function for verification decisions." });
    }

    if (action === "support-update") {
      requireSuperAdmin(admin);
      const id = body.id;
      if (!id) return json(400, { error: "id is required" });
      const notes = Array.isArray(body.notes) ? body.notes : [];
      if (body.note) notes.push({ text: body.note, at: new Date().toISOString(), admin_id: user.id });
      const patch = {
        status: body.status,
        assigned_to: body.assigned_to || undefined,
        notes,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await client.from("platform_support_items").update(patch).eq("id", id).select("*").single();
      if (error) throw error;
      await writeCommandAudit(client, user.id, "support_update", { targetType: "support_item", targetId: id, ip, status: body.status });
      return json(200, { item: data });
    }

    if (action === "create-announcement") {
      requireSuperAdmin(admin);
      const validation = validateAnnouncementPayload(body);
      if (!validation.valid) return json(400, { error: validation.errors.join(" ") });
      const record = {
        title: body.title,
        body: body.body || body.message,
        kind: validation.kind,
        audience: validation.audience,
        audience_user_ids: Array.isArray(body.audience_user_ids) ? body.audience_user_ids : [],
        popup: Boolean(body.popup),
        active: body.active !== false,
        starts_at: body.starts_at || null,
        ends_at: body.ends_at || null,
        created_by: user.id,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await client.from("platform_announcements").insert(record).select("*").single();
      if (error) throw error;
      await writeCommandAudit(client, user.id, "create_announcement", { targetType: "announcement", targetId: data.id, ip });
      return json(201, { announcement: data });
    }

    if (action === "save-feature-flags") {
      requireSuperAdmin(admin);
      const flags = body.flags && typeof body.flags === "object" ? body.flags : {};
      for (const key of PLATFORM_FEATURE_FLAGS) {
        if (!(key in flags)) continue;
        const { error } = await client.from("platform_feature_flags").upsert(
          {
            flag_key: key,
            enabled: Boolean(flags[key]),
            updated_by: user.id,
            updated_at: new Date().toISOString()
          },
          { onConflict: "flag_key" }
        );
        if (error) {
          if (isMissingTableError(error)) return json(503, { error: "Apply command_center_v1 migration for feature flags." });
          throw error;
        }
      }
      await writeCommandAudit(client, user.id, "save_feature_flags", { targetType: "platform", targetId: "feature_flags", ip, flags });
      return json(200, { flags: mergeFeatureFlags(flags) });
    }

    if (action === "lily-query") {
      requireSuperAdmin(admin);
      const message = String(body.message || "").trim();
      if (!message) return json(400, { error: "Add a message for Lily." });
      const intent = detectIntent(message);
      const health = systemHealthSnapshot(process.env);
      const response = mapAdminInsight(message, {
        kpis: body.kpis || {},
        health,
        support_open: body.support_open
      });
      await writeCommandAudit(client, user.id, "lily_admin_query", {
        targetType: "platform",
        targetId: "lily",
        ip,
        intent: intent.intent,
        message_preview: message.slice(0, 120)
      });
      return json(200, { response, intent, permission: { allowed: true } });
    }

    if (action === "record-ai-request") {
      requireSuperAdmin(admin);
      const today = new Date().toISOString().slice(0, 10);
      try {
        const { data: existing } = await client.from("platform_ai_usage_daily").select("request_count").eq("usage_date", today).maybeSingle();
        const next = Number(existing?.request_count || 0) + 1;
        await client.from("platform_ai_usage_daily").upsert(
          { usage_date: today, request_count: next, updated_at: new Date().toISOString() },
          { onConflict: "usage_date" }
        );
      } catch {
        // optional table
      }
      return json(200, { ok: true });
    }

    return json(400, { error: "Unknown command center action" });
  } catch (error) {
    return platformAdminErrorResponse(event, error);
  }
  };
}

/** Production Netlify entry — ignores context for auth/service-role overrides. */
export const handler = createAdminCommandCenterHandler();
