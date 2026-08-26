/**
 * Florisyn Marketing Studio — florist-facing entry point (Phase 1 of the
 * "Florist-Facing Marketing Studio + Lily Connected Intelligence" pass).
 *
 * The existing marketing-studio.js (Founding Beta admin console) is a
 * ~50-action surface every single action of which requires the platform
 * super_admin authorization boundary — reachable only via admin.html,
 * with a shop_id typed into a text box by a platform admin. A normal
 * florist has no way to reach it at all. This file is the separate,
 * narrower, real florist-facing surface Phase 1D calls for: it does NOT
 * simply expose the existing super_admin endpoint to regular users.
 *
 * Real session → shop resolution (1A): currentUser() (_shared/supabase.js)
 * — the SAME mechanism every other regular (non-admin) Florisyn endpoint
 * already uses. It authenticates the real Bearer session, resolves the
 * caller's real active shop_members row (honoring profiles.default_shop_id
 * / Florisyn's existing shop-selection behavior — this file invents no
 * competing shop-switcher), and hands back a member-scoped, RLS-enforced
 * client. A client-supplied shop_id is NEVER trusted once the session's
 * own shop is known (see the forced overwrite below) — this closes the
 * direct-ID-attack path at its root rather than relying on every
 * individual action to reject it.
 *
 * Real private-beta gate (1B): isShopFeatureEnabled() (Phase 2's shared
 * helper — the SAME shop_admin_config.features.marketing_studio_beta PR
 * #178 already uses for the admin console). A beta flag is authorization
 * for NOTHING by itself — real active shop membership (proven by
 * currentUser() actually returning a shopId, which it only does for a
 * real active member) is checked first and is what makes this safe.
 *
 * Real backend authorization (1D): rather than duplicating
 * marketing-studio.js's business logic a second time (which the codebase
 * everywhere else treats as the failure mode to avoid — "never a second,
 * independently-maintained branch"), this reuses its EXACT dispatch —
 * createMarketingStudioHandler(deps) accepts deps.florist, set ONLY here,
 * ONLY after real auth/membership/beta verification. An explicit
 * allowlist (FLORIST_ALLOWED_ACTIONS) below is the second, independent
 * gate: even though the shared dispatch contains ~50 actions, this file
 * refuses (403) anything outside the safe subset a florist genuinely
 * needs BEFORE ever reaching that dispatch — so widening what a florist
 * can do is always a deliberate, reviewed addition to that allowlist, not
 * an accident of the admin surface growing.
 */

import { json, fail } from "./_shared/saas.js";
import { currentUser } from "./_shared/supabase.js";
import { isShopFeatureEnabled } from "./_shared/shop-feature-access.js";
import { createMarketingStudioHandler } from "./marketing-studio.js";

/**
 * The safe, read-and-draft-workflow action subset a florist may reach
 * directly. Every write action here is reversible/draft-only or an
 * explicit review decision — nothing here can ever cause an external
 * publish (that stays behind enqueue_publish/run_publishing_queue's own
 * provider gates, which this file does not expose at all today).
 */
const FLORIST_ALLOWED_ACTIONS = new Set([
  "status",
  "get_brand_brain",
  "get_visual_style",
  "connections",
  "usage_summary",
  "list_content",
  "create_content_item",
  "generate_content",
  "revise_content",
  "revert_content_revision",
  "approve_content",
  "finalize_flyer_render"
]);

function parseAction(event) {
  const qs = event.queryStringParameters || {};
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }
  return String(body.action || qs.action || "status").toLowerCase();
}

/** Test seam — production uses bound real dependencies via exported `handler`. */
export function createMarketingStudioShopHandler(deps = {}) {
  const resolveUser = deps.currentUser || currentUser;
  const checkFeature = deps.isShopFeatureEnabled || isShopFeatureEnabled;

  return async function handler(event) {
    try {
      const action = parseAction(event);
      if (!FLORIST_ALLOWED_ACTIONS.has(action)) {
        return json(404, { error: "That isn't available here." });
      }

      // 1A — real session → shop resolution, never a client-supplied
      // shop_id. currentUser() throws (401/403) for a missing/expired
      // session or an account with no active shop membership at all —
      // both handled by the shared `fail()` error boundary below.
      const { client, user, shopId, role } = await resolveUser(event);

      // 1B — a beta flag is never authorization by itself: shopId above
      // only exists because currentUser() already proved real, active
      // shop_members membership. This is the second, independent check —
      // does THIS specific shop actually have Marketing Studio access.
      const hasAccess = await checkFeature(shopId, "marketing_studio_beta", { globalFlagName: "MARKETING_STUDIO" });
      if (!hasAccess) {
        return json(403, { error: "Marketing Studio isn't available for your shop yet." });
      }

      // 1D — the real, shared dispatch, built fresh with a florist
      // context this function itself just verified for THIS request.
      // deps.florist is never set by anything a request to this handler
      // controls — a test may still override the whole dispatch via
      // deps.floristHandler to isolate this file's own auth logic.
      const dispatch = deps.floristHandler || createMarketingStudioHandler({ ...deps, florist: { client, user, shopId, role } });
      return await dispatch(event);
    } catch (error) {
      return fail(error);
    }
  };
}

export const handler = createMarketingStudioShopHandler();
