import { authenticatedUser, admin as createServiceRoleClient } from "./saas.js";

const UNAUTHORIZED_MESSAGE = "This account is not authorized for Florisyn Administration.";
const ROLE_MESSAGE = "Your admin role does not allow this action.";
const LOOKUP_FAILURE_MESSAGE =
  "Unable to verify Florisyn Administration access right now. Please try again.";

/**
 * Server-side authorization boundary for Florisyn platform administration.
 *
 * IMPORTANT: This is a server authorization boundary, not a browser
 * database-access mechanism. `public.platform_admins` has no grants or RLS
 * policies for the `anon`/`authenticated` roles (see P0-01 / P0-01 R1) —
 * only this function's service-role client may read it. The only trusted
 * identity source is the verified bearer token's `user.id` from Supabase
 * Auth; an administrator identity is never accepted from the request body,
 * query parameters, other headers, `user_metadata`, or `raw_user_meta_data`.
 *
 * Flow (fail-closed at every step):
 *   1. Verify the bearer token via `authenticatedUser()` — throws 401 for a
 *      missing, invalid, or expired token. No server client exists yet.
 *   2. Use only the verified `user.id`.
 *   3. Only after authentication succeeds, create the secure service-role
 *      client via the existing `admin()` helper. `admin()` itself throws a
 *      safe 503 when the service-role key is not configured in Netlify.
 *   4. Use the service-role client to query `platform_admins` for exactly
 *      that `user.id`. Any query/provider failure is caught and re-thrown
 *      as a redacted, safe 503 — the raw error is only logged server-side.
 *   5. Require a matching row with `active = true`; require the endpoint's
 *      allowed role when `allowedRoles` is non-empty. `super_admin` is
 *      always permitted as an explicit override.
 *   6. Only after authorization succeeds is the service-role client
 *      returned to downstream platform administration code.
 *
 * @param {object} event Netlify function event.
 * @param {string[]} [allowedRoles] Roles permitted for this call; empty means any active admin.
 * @param {object} [deps] Test seam only: { authenticate, createServerClient }. Production
 *   call sites must never pass this — defaults are the real Supabase-backed implementations.
 */
export async function platformAdmin(event, allowedRoles = [], deps = {}) {
  const authenticate = deps.authenticate || authenticatedUser;
  const buildServerClient = deps.createServerClient || createServiceRoleClient;

  // Step 1 + 2: verify the bearer token first. The ONLY identity we trust is
  // the verified user.id — nothing from body/query/headers/user_metadata.
  const { user } = await authenticate(event);
  const userId = user && user.id;
  if (!userId) {
    const err = new Error("Please sign in");
    err.statusCode = 401;
    throw err;
  }

  // Step 3: only after authentication succeeds, create the secure server
  // client. buildServerClient() throws a safe 503 if the server key is
  // missing — no platform_admins query is attempted without it.
  const serverClient = buildServerClient();

  // Step 4: query platform_admins for exactly the verified user id, using
  // the service-role client (never the caller's own JWT client).
  let data;
  try {
    const result = await serverClient
      .from("platform_admins")
      .select("user_id,role,display_name,active")
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error) throw result.error;
    data = result.data;
  } catch (dbError) {
    // Redacted: log the real cause server-side only; never leak provider
    // details, table/column names, or raw messages to the caller.
    console.error("platformAdmin: platform_admins lookup failed:", dbError?.message || dbError);
    const err = new Error(LOOKUP_FAILURE_MESSAGE);
    err.statusCode = 503;
    throw err;
  }

  // Step 5: require a matching, active administrator row.
  if (!data || data.active !== true) {
    const err = new Error(UNAUTHORIZED_MESSAGE);
    err.statusCode = 403;
    throw err;
  }

  // Role gate — super_admin is always permitted as an explicit override.
  if (allowedRoles.length && !allowedRoles.includes(data.role) && data.role !== "super_admin") {
    const err = new Error(ROLE_MESSAGE);
    err.statusCode = 403;
    throw err;
  }

  // Step 6: only now hand the service-role client to downstream admin code.
  return { client: serverClient, user, admin: data };
}

/** Closed Beta: only `super_admin` may run high-impact platform mutations. */
export function requireSuperAdmin(adminRecord, message = "This action requires a Florisyn super admin.") {
  if (String(adminRecord?.role || "").toLowerCase() === "super_admin") return;
  const err = new Error(message);
  err.statusCode = 403;
  throw err;
}

/**
 * Explicit gate for mutations intentionally available to any active platform
 * administrator (not restricted to super_admin). `platformAdmin()` already
 * guarantees `adminRecord.active === true` by the time a handler runs this,
 * so this call is always satisfied in practice — its purpose is to make each
 * mutation's authorization decision explicit and greppable/auditable rather
 * than an implicit assumption, per the platform admin authorization boundary
 * (P0-02): every mutation branch must show a role gate before its database
 * write, not only the handler-entry check.
 */
export function requireAnyActiveAdmin(
  adminRecord,
  message = "This action requires an active Florisyn platform administrator."
) {
  if (adminRecord && adminRecord.active === true) return;
  const err = new Error(message);
  err.statusCode = 403;
  throw err;
}

export async function writeAdminAudit(client, adminUserId, shopId, action, details = {}) {
  await client.from('platform_admin_audit').insert({
    admin_user_id: adminUserId,
    shop_id: shopId || null,
    action,
    details
  });
}

export async function writeCommandAudit(client, adminUserId, action, { shopId = null, targetType = null, targetId = null, result = 'success', ip = 'unknown', ...rest } = {}) {
  await writeAdminAudit(client, adminUserId, shopId, action, {
    target_type: targetType,
    target_id: targetId,
    result,
    ip_placeholder: ip,
    ...rest
  });
}
