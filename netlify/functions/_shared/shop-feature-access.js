/**
 * Florisyn's standard shop-scoped staged-rollout mechanism (Phase 2 of the
 * "Florist-Facing Marketing Studio + Lily Connected Intelligence" pass).
 *
 * Reuses shop_admin_config.features (already the real per-shop config
 * store — theme/navigation/features/content — wired through
 * admin-console.js's save_config action and read by tenant-config.js)
 * rather than a second, parallel feature-flag framework. This is the
 * SAME table/column the shop-scoped Marketing Studio beta access
 * (marketing_studio_beta) already uses; this module just gives that
 * pattern one shared, documented, tested implementation instead of every
 * future caller re-deriving its own JSON-parsing/access-check logic.
 *
 * shop_admin_config has NO row-level-security grant for the `authenticated`
 * role today (its own migration deliberately scoped it to service-role/
 * admin console access only — see 20260804000000_greenfield_baseline.sql's
 * "No client policies: Command Center access is service-role only" note).
 * This helper therefore always reads it via a service-role client — the
 * exact same "check an authorization-relevant flag server-side, even
 * though the caller's own session client can't see the row" pattern
 * platformAdmin() already uses for platform_admins. A caller-supplied
 * `client` is accepted (test injection only); production code should
 * simply omit it and let this module create its own service-role client.
 *
 * CRITICAL — what this helper is and is not:
 *   - It answers ONE question: "does this shop have this feature turned
 *     on?" Nothing more.
 *   - It NEVER proves the caller belongs to that shop. A feature flag is
 *     never authorization by itself (see the module doc on
 *     marketing-studio-shop.js) — every caller MUST separately verify
 *     real shop membership (currentUser()/authenticatedUser() + an
 *     explicit shop_members active-membership check) before trusting a
 *     `true` result here for anything access-sensitive.
 *   - It fails CLOSED on every ambiguous case: no shopId, no config row,
 *     a missing key, a DB error, a malformed features value — all return
 *     false, never true, never throw (throwing would risk an unhandled
 *     500 taking down a caller that just wanted a boolean).
 */

import { admin as createServiceRoleClient } from "./supabase.js";
import { isFeatureEnabled } from "./feature-flags.js";

/**
 * @param {string} shopId
 * @param {string} featureKey - the key inside shop_admin_config.features,
 *   e.g. "marketing_studio_beta".
 * @param {object} [opts]
 * @param {string} [opts.globalFlagName] - an env-based feature-flags.js
 *   name (e.g. "MARKETING_STUDIO") that, if enabled, grants access to
 *   every shop without a per-shop row — preserves the existing
 *   global-rollout path for any feature that also has one. Omit for a
 *   feature that only ever exists as shop-scoped beta access.
 * @param {import('@supabase/supabase-js').SupabaseClient} [opts.client] -
 *   test-only client override. Production callers should omit this.
 * @returns {Promise<boolean>}
 */
export async function isShopFeatureEnabled(shopId, featureKey, opts = {}) {
  // The global flag, when present and on, grants access regardless of
  // shopId — matching every prior caller's behavior exactly (a global
  // rollout was never conditioned on the caller even supplying a shop).
  if (opts.globalFlagName && isFeatureEnabled(opts.globalFlagName)) return true;
  if (!shopId || !featureKey) return false;

  let client;
  try {
    client = opts.client || createServiceRoleClient();
  } catch {
    // No server key configured (e.g. a misconfigured environment) — fail
    // closed rather than throw, exactly like a missing/errored row below.
    return false;
  }

  let data, error;
  try {
    ({ data, error } = await client.from("shop_admin_config").select("features").eq("shop_id", shopId).maybeSingle());
  } catch (err) {
    error = err;
  }
  if (error || !data) return false;

  const features = data.features;
  if (!features || typeof features !== "object" || Array.isArray(features)) return false;
  return features[featureKey] === true;
}
