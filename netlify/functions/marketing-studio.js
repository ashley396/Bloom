/**
 * Florisyn Marketing Studio — Founding Beta (admin-only) API surface.
 *
 * Stage B foundation only: Brand Brain read/write, connection status
 * (never tokens), usage/cost ledger summary, and an honest `status` action
 * reporting exactly what is and isn't live yet. Content generation,
 * publishing, and AI Clone job execution land in Stages C-E — this file
 * intentionally does not fake any of that here.
 *
 * Access control is two layers, both required (Section 5: admin-only must
 * be enforced server-side, not UI-hidden):
 *   1. isFeatureEnabled("MARKETING_STUDIO") — the kill switch.
 *   2. platformAdmin(event, ["super_admin"]) — only the founder account,
 *      the same mechanism admin-command-center.js/admin-photo-manager.js
 *      already use in production. No per-shop bypass exists; Ashley/
 *      Florisyn is Tenant Zero, reached the same way any future beta shop
 *      would be, not via a hard-coded special path.
 *
 * Follows the exact createXHandler(deps)/export const handler = createX()
 * dependency-injection convention every other platformAdmin() call site in
 * this codebase uses (see tests/platform-admin-authorization-boundary.test.js) —
 * parsePlatformAdminJsonBody() for request bodies, never bodyOf()/JSON.parse
 * directly, and platformAdminErrorResponse() for every failure path.
 */

import { json, methodNotAllowed } from "./_shared/http.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import {
  platformAdmin,
  requireSuperAdmin,
  platformAdminErrorResponse,
  platformAdminError,
  parsePlatformAdminJsonBody,
  writeCommandAudit
} from "./_shared/platform-admin.js";
import {
  loadBrandBrain,
  saveBrandBrain,
  applyExplicitBrandUpdates,
  forgetBrandTrait,
  resetPreferences,
  buildBrandSummary
} from "./_shared/marketing-brand-brain.js";
import { SUPPORTED_PLATFORMS, isPlatformLive } from "./_shared/marketing-social-providers.js";
import { COST_CONFIG_VERSION } from "./_shared/marketing-cost-config.js";

function featureGate() {
  if (!isFeatureEnabled("MARKETING_STUDIO")) {
    throw platformAdminError("forbidden");
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
  const err = new Error(
    "Marketing Studio tables are not set up yet. Apply the marketing studio foundation migration, then try again."
  );
  err.statusCode = 503;
  err.florisynCode = "unexpected";
  return err;
}

function requireShopId(qs, body) {
  const shopId = body?.shop_id || qs?.shop_id;
  if (!shopId) throw platformAdminError("missing_shop_id");
  return shopId;
}

/** Test seam — production uses bound real dependencies via exported `handler`. */
export function createMarketingStudioHandler(deps = {}) {
  return async function handler(event) {
    try {
      featureGate();
      const { client, user, admin } = await platformAdmin(event, ["super_admin"], deps);
      const method = event.httpMethod;
      const qs = event.queryStringParameters || {};
      const body = parsePlatformAdminJsonBody(event);
      const action = String(body.action || qs.action || "status").toLowerCase();

      if (action === "status") {
        return json(200, {
          marketing_studio_enabled: true,
          access: "admin_only_founding_beta",
          supported_platforms: SUPPORTED_PLATFORMS.map((platform) => ({
            platform,
            live: isPlatformLive(platform)
          })),
          cost_config_version: COST_CONFIG_VERSION,
          note: "NOT LIVE — PROVIDER CONNECTION REQUIRED. No social platform, AI Clone, or voice provider is connected yet (Stage B foundation only). See Stage E/D for provider onboarding."
        });
      }

      if (action === "get_brand_brain") {
        const shopId = requireShopId(qs, body);
        const { preferences, error } = await loadBrandBrain(client, shopId);
        if (error && missingRelation({ message: error })) throw friendlyMissing();
        return json(200, { preferences, summary: buildBrandSummary(preferences) });
      }

      if (action === "update_brand_brain" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!Array.isArray(body.updates) || body.updates.length === 0) {
          return json(400, { error: "updates must be a non-empty array." });
        }
        const { preferences: current } = await loadBrandBrain(client, shopId);
        const next = applyExplicitBrandUpdates(current, body.updates);
        const { ok, error } = await saveBrandBrain(client, shopId, next);
        if (!ok) {
          if (missingRelation({ message: error })) throw friendlyMissing();
          throw new Error(error);
        }
        await writeCommandAudit(client, user.id, "marketing_brand_brain_update", {
          shopId,
          targetType: "marketing_brand_brain",
          targetId: shopId
        });
        return json(200, { preferences: next, summary: buildBrandSummary(next) });
      }

      if (action === "forget_brand_trait" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.category || !body.text) return json(400, { error: "category and text are required." });
        const { preferences: current } = await loadBrandBrain(client, shopId);
        const next = forgetBrandTrait(current, { category: body.category, text: body.text });
        const { ok, error } = await saveBrandBrain(client, shopId, next);
        if (!ok) throw new Error(error);
        return json(200, { preferences: next, summary: buildBrandSummary(next) });
      }

      if (action === "reset_brand_brain" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const next = resetPreferences();
        const { ok, error } = await saveBrandBrain(client, shopId, next);
        if (!ok) throw new Error(error);
        await writeCommandAudit(client, user.id, "marketing_brand_brain_reset", {
          shopId,
          targetType: "marketing_brand_brain",
          targetId: shopId
        });
        return json(200, { preferences: next, summary: "" });
      }

      if (action === "connections") {
        const shopId = requireShopId(qs, body);
        const { data, error } = await client
          .from("marketing_social_connections")
          .select("id,platform,status,account_label,connected_at,expires_at,last_error,last_checked_at")
          .eq("shop_id", shopId)
          .order("platform", { ascending: true });
        if (error) {
          if (missingRelation(error)) throw friendlyMissing();
          throw error;
        }
        const byPlatform = new Map((data || []).map((row) => [row.platform, row]));
        const items = SUPPORTED_PLATFORMS.map((platform) => {
          const row = byPlatform.get(platform) || { status: "not_connected", account_label: null };
          return { ...row, platform, live: isPlatformLive(platform) };
        });
        return json(200, { items });
      }

      if (action === "usage_summary") {
        const shopId = requireShopId(qs, body);
        const { data, error } = await client
          .from("marketing_generation_usage")
          .select("provider,purpose,estimated_cost_cents,actual_cost_cents,status,created_at")
          .eq("shop_id", shopId)
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) {
          if (missingRelation(error)) throw friendlyMissing();
          throw error;
        }
        const rows = data || [];
        const estimatedTotalCents = rows.reduce((sum, r) => sum + (r.status === "estimated" ? r.estimated_cost_cents || 0 : 0), 0);
        const actualTotalCents = rows.reduce((sum, r) => sum + (r.status === "actual" ? r.actual_cost_cents || 0 : 0), 0);
        return json(200, {
          items: rows,
          estimated_total_cents: estimatedTotalCents,
          actual_total_cents: actualTotalCents,
          cost_config_version: COST_CONFIG_VERSION
        });
      }

      return methodNotAllowed();
    } catch (error) {
      return platformAdminErrorResponse(event, error);
    }
  };
}

export const handler = createMarketingStudioHandler();
