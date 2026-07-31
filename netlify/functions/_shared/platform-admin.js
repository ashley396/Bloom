import { authenticatedUser, admin as createServiceRoleClient, json } from "./saas.js";
import { FOUNDER_SERVER_KEY_HINT } from "./supabase.js";

export const UNAUTHORIZED_MESSAGE = "This account is not authorized for Florisyn Administration.";
export const ROLE_MESSAGE = "Your admin role does not allow this action.";
export const LOOKUP_FAILURE_MESSAGE =
  "Unable to verify Florisyn Administration access right now. Please try again.";

const GENERIC_401 = "Please sign in again.";
const GENERIC_403 = "You do not have permission to perform this action.";
const GENERIC_500 = "Unexpected Florisyn error. Try again or contact support.";
const GENERIC_503 = "Florisyn is temporarily unavailable. Please try again.";

/** Florisyn-owned 503 messages that may be returned to callers (never provider text). */
const ALLOWLISTED_503_MESSAGES = new Set([
  LOOKUP_FAILURE_MESSAGE,
  FOUNDER_SERVER_KEY_HINT,
  "Marketplace verification tables are not available yet. Apply the marketplace verification migration in Supabase.",
  "Apply command_center_v1 migration for feature flags."
]);

const FOUNDING_BETA_ROLES = ["super_admin"];

/**
 * Safe platform-admin log line — never includes provider messages, codes, stacks,
 * URLs, hostnames, table names, tokens, or request bodies.
 */
export function logPlatformAdminEvent(eventName, { category, status, correlationId } = {}) {
  const payload = {
    event: eventName,
    category: category || "platform_admin",
    status: status || 500,
    ts: new Date().toISOString()
  };
  if (correlationId) payload.correlationId = correlationId;
  console.error(JSON.stringify(payload));
}

function correlationIdFromEvent(event) {
  return (
    event?.headers?.["x-request-id"] ||
    event?.headers?.["X-Request-Id"] ||
    event?.headers?.["x-correlation-id"] ||
    event?.headers?.["X-Correlation-Id"] ||
    null
  );
}

function categorizeError(status) {
  if (status === 401) return "platform_admin_unauthorized";
  if (status === 403) return "platform_admin_forbidden";
  if (status === 400) return "platform_admin_validation";
  if (status === 404) return "platform_admin_not_found";
  if (status === 503) return "platform_admin_unavailable";
  if (status >= 500) return "platform_admin_internal";
  return "platform_admin_client";
}

function safe503Message(error) {
  const msg = String(error?.message || "");
  if (error?.code === "supabase_server_key_missing") return FOUNDER_SERVER_KEY_HINT;
  if (ALLOWLISTED_503_MESSAGES.has(msg)) return msg;
  if (/Florisyn's secure server connection/i.test(msg)) return FOUNDER_SERVER_KEY_HINT;
  return GENERIC_503;
}

/**
 * Shared fail-closed error boundary for all platform-admin handlers.
 * Never returns raw database/provider messages on 500-level responses.
 */
export function platformAdminErrorResponse(event, error) {
  const status = error?.statusCode || 500;
  const correlationId = correlationIdFromEvent(event);
  const category = categorizeError(status);

  logPlatformAdminEvent("platform_admin_handler_error", {
    category,
    status,
    correlationId
  });

  let message;
  if (status === 401) {
    message = GENERIC_401;
  } else if (status === 403) {
    message = GENERIC_403;
  } else if (status === 400 || status === 404) {
    message = error?.message || (status === 404 ? "We could not find that record." : "Invalid request.");
  } else if (status === 503) {
    message = safe503Message(error);
  } else if (status >= 500) {
    message = GENERIC_500;
  } else {
    message = error?.message || "Request could not be completed.";
  }

  return json(status, { error: message });
}

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
 * Founding Beta (P0-02 R1): when `allowedRoles` is missing or empty, access
 * fails closed to `super_admin` only — no "any active admin" fallback.
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
 *      as a redacted, safe 503 — provider details never enter logs.
 *   5. Require a matching row with `active = true` and an allowed role.
 *      `super_admin` is always permitted as an explicit override.
 *   6. Only after authorization succeeds is the service-role client
 *      returned to downstream platform administration code.
 *
 * @param {object} event Netlify function event.
 * @param {string[]} [allowedRoles] Roles permitted for this call; missing/empty
 *   defaults to `["super_admin"]` (Founding Beta fail-closed).
 * @param {object} [deps] Test seam only: { authenticate, createServerClient }.
 */
export async function platformAdmin(event, allowedRoles, deps = {}) {
  const roles =
    allowedRoles && allowedRoles.length > 0 ? allowedRoles : FOUNDING_BETA_ROLES;
  const authenticate = deps.authenticate || authenticatedUser;
  const buildServerClient = deps.createServerClient || createServiceRoleClient;

  const { user } = await authenticate(event);
  const userId = user && user.id;
  if (!userId) {
    const err = new Error("Please sign in");
    err.statusCode = 401;
    throw err;
  }

  const serverClient = buildServerClient();

  let data;
  try {
    const result = await serverClient
      .from("platform_admins")
      .select("user_id,role,display_name,active")
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error) throw result.error;
    data = result.data;
  } catch {
    logPlatformAdminEvent("platform_admin_lookup_failed", {
      category: "admin_lookup_db",
      status: 503,
      correlationId: correlationIdFromEvent(event)
    });
    const err = new Error(LOOKUP_FAILURE_MESSAGE);
    err.statusCode = 503;
    throw err;
  }

  if (!data || data.active !== true) {
    const err = new Error(UNAUTHORIZED_MESSAGE);
    err.statusCode = 403;
    throw err;
  }

  if (!roles.includes(data.role) && data.role !== "super_admin") {
    const err = new Error(ROLE_MESSAGE);
    err.statusCode = 403;
    throw err;
  }

  return { client: serverClient, user, admin: data };
}

/** Founding Beta: only `super_admin` may run platform-admin mutations. */
export function requireSuperAdmin(adminRecord, message = "This action requires a Florisyn super admin.") {
  if (String(adminRecord?.role || "").toLowerCase() === "super_admin") return;
  const err = new Error(message);
  err.statusCode = 403;
  throw err;
}

export async function writeAdminAudit(client, adminUserId, shopId, action, details = {}) {
  await client.from("platform_admin_audit").insert({
    admin_user_id: adminUserId,
    shop_id: shopId || null,
    action,
    details
  });
}

export async function writeCommandAudit(
  client,
  adminUserId,
  action,
  { shopId = null, targetType = null, targetId = null, result = "success", ip = "unknown", ...rest } = {}
) {
  await writeAdminAudit(client, adminUserId, shopId, action, {
    target_type: targetType,
    target_id: targetId,
    result,
    ip_placeholder: ip,
    ...rest
  });
}
