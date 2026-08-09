import { randomUUID } from "node:crypto";
import { authenticatedUser, admin as createServiceRoleClient, json } from "./saas.js";
import { FOUNDER_SERVER_KEY_HINT } from "./supabase.js";

/** Unforgeable module-owned brand — never exported; not readable from error objects. */
const brandedPlatformAdminErrors = new WeakSet();

function freezePublicErrorCatalog(catalog) {
  for (const key of Object.keys(catalog)) {
    Object.freeze(catalog[key]);
  }
  return Object.freeze(catalog);
}

/** Florisyn-owned public error catalog — fixed codes map to fixed status/message pairs only. */
export const PLATFORM_ADMIN_PUBLIC_ERRORS = freezePublicErrorCatalog({
  invalid_request: { status: 400, message: "Invalid request." },
  missing_shop_id: { status: 400, message: "A shop ID is required." },
  not_found: { status: 404, message: "We could not find that record." },
  unauthorized: { status: 401, message: "Please sign in again." },
  forbidden: { status: 403, message: "You do not have permission to perform this action." },
  server_key_missing: { status: 503, message: FOUNDER_SERVER_KEY_HINT },
  admin_lookup_unavailable: {
    status: 503,
    message: "Unable to verify Florisyn Administration access right now. Please try again."
  },
  verification_schema_unavailable: {
    status: 503,
    message:
      "Marketplace verification tables are not available yet. Apply the marketplace verification migration in Supabase."
  },
  feature_flag_schema_unavailable: {
    status: 503,
    message: "Apply command_center_v1 migration for feature flags."
  },
  unexpected: { status: 500, message: "Unexpected Florisyn error. Try again or contact support." }
});

/** @deprecated Use PLATFORM_ADMIN_PUBLIC_ERRORS.admin_lookup_unavailable.message */
export const LOOKUP_FAILURE_MESSAGE = PLATFORM_ADMIN_PUBLIC_ERRORS.admin_lookup_unavailable.message;

const FOUNDING_BETA_ROLES = ["super_admin"];

const ALLOWED_LOG_EVENTS = new Set(["platform_admin_lookup_failed", "platform_admin_handler_error"]);
const ALLOWED_LOG_CATEGORIES = new Set([
  "admin_lookup_db",
  "platform_admin_unauthorized",
  "platform_admin_forbidden",
  "platform_admin_validation",
  "platform_admin_not_found",
  "platform_admin_unavailable",
  "platform_admin_internal",
  "platform_admin_client"
]);
const ALLOWED_LOG_STATUSES = new Set([400, 401, 403, 404, 500, 503]);

const CODE_TO_LOG_CATEGORY = Object.freeze({
  unauthorized: "platform_admin_unauthorized",
  forbidden: "platform_admin_forbidden",
  invalid_request: "platform_admin_validation",
  missing_shop_id: "platform_admin_validation",
  not_found: "platform_admin_not_found",
  server_key_missing: "platform_admin_unavailable",
  admin_lookup_unavailable: "admin_lookup_db",
  verification_schema_unavailable: "platform_admin_unavailable",
  feature_flag_schema_unavailable: "platform_admin_unavailable",
  unexpected: "platform_admin_internal"
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Server-owned request context — never reads browser-provided identifiers. */
const requestContext = new WeakMap();

/**
 * Returns a stable, server-generated request ID for this Netlify event object.
 * Ignores browser request/correlation headers, body, query, and user metadata.
 */
export function getPlatformAdminRequestId(event) {
  if (!event || typeof event !== "object") return randomUUID();
  let ctx = requestContext.get(event);
  if (!ctx) {
    ctx = { requestId: randomUUID() };
    requestContext.set(event, ctx);
  }
  return ctx.requestId;
}

function isFlorisynPlatformAdminError(error) {
  return Boolean(error && brandedPlatformAdminErrors.has(error));
}

/**
 * Resolve a catalog code via own-property membership only.
 * Inherited prototype keys, symbols, non-strings, and unknown codes → unexpected.
 */
function resolveCatalogCode(code) {
  if (typeof code !== "string" || code === "") return "unexpected";
  if (!Object.hasOwn(PLATFORM_ADMIN_PUBLIC_ERRORS, code)) return "unexpected";
  return code;
}

/** Create a Florisyn-owned platform-admin error (never copy provider text). */
export function platformAdminError(code) {
  const resolvedCode = resolveCatalogCode(code);
  const entry = PLATFORM_ADMIN_PUBLIC_ERRORS[resolvedCode];
  const err = new Error(entry.message);
  err.statusCode = entry.status;
  err.florisynCode = resolvedCode;
  brandedPlatformAdminErrors.add(err);
  return err;
}

/**
 * Shared safe JSON body parser for platform-admin handlers.
 * Empty → {}; valid plain object → object; malformed/non-object → branded invalid_request.
 * Never returns submitted body text or parser messages.
 */
export function parsePlatformAdminJsonBody(event) {
  const raw = event?.body;
  if (raw == null || raw === "") return {};

  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw platformAdminError("invalid_request");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw platformAdminError("invalid_request");
  }

  return parsed;
}

function safeLogEventName(eventName) {
  return ALLOWED_LOG_EVENTS.has(eventName) ? eventName : "platform_admin_event";
}

function safeLogCategory(category) {
  return ALLOWED_LOG_CATEGORIES.has(category) ? category : "unknown";
}

function safeLogStatus(status) {
  const numeric = Number(status);
  return ALLOWED_LOG_STATUSES.has(numeric) ? numeric : 500;
}

function safeLogRequestId(requestId) {
  return typeof requestId === "string" && UUID_RE.test(requestId) ? requestId : null;
}

/** Private logger — allowlisted fields only; never logs caller-controlled strings. */
function logPlatformAdminEvent(eventName, { category, status, requestId } = {}) {
  const payload = {
    event: safeLogEventName(eventName),
    category: safeLogCategory(category),
    status: safeLogStatus(status),
    ts: new Date().toISOString()
  };
  const safeRequestId = safeLogRequestId(requestId);
  if (safeRequestId) payload.requestId = safeRequestId;
  console.error(JSON.stringify(payload));
}

/**
 * Shared fail-closed error boundary for all platform-admin handlers.
 * Only Florisyn-branded errors from platformAdminError() may select a non-500 catalog entry.
 * Public wording never comes from statusCode, message, or forged florisynCode values.
 */
export function platformAdminErrorResponse(event, error) {
  const requestId = getPlatformAdminRequestId(event);
  const code = isFlorisynPlatformAdminError(error) ? error.florisynCode : undefined;
  const resolvedCode = resolveCatalogCode(code);
  const entry = PLATFORM_ADMIN_PUBLIC_ERRORS[resolvedCode];

  logPlatformAdminEvent("platform_admin_handler_error", {
    category: CODE_TO_LOG_CATEGORY[resolvedCode] || "unknown",
    status: entry.status,
    requestId
  });

  return json(entry.status, { error: entry.message });
}

/**
 * Server-side authorization boundary for Florisyn platform administration.
 *
 * Founding Beta (P0-02 R1): when `allowedRoles` is missing or empty, access
 * fails closed to `super_admin` only — no "any active admin" fallback.
 */
export async function platformAdmin(event, allowedRoles, deps = {}) {
  const roles =
    allowedRoles && allowedRoles.length > 0 ? allowedRoles : FOUNDING_BETA_ROLES;
  const authenticate = deps.authenticate || authenticatedUser;
  const buildServerClient = deps.createServerClient || createServiceRoleClient;
  const requestId = getPlatformAdminRequestId(event);

  let user;
  try {
    ({ user } = await authenticate(event));
  } catch {
    throw platformAdminError("unauthorized");
  }

  const userId = user && user.id;
  if (!userId) {
    throw platformAdminError("unauthorized");
  }

  let serverClient;
  try {
    serverClient = buildServerClient();
  } catch {
    throw platformAdminError("server_key_missing");
  }

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
      requestId
    });
    throw platformAdminError("admin_lookup_unavailable");
  }

  if (!data || data.active !== true) {
    throw platformAdminError("forbidden");
  }

  if (!roles.includes(data.role) && data.role !== "super_admin") {
    throw platformAdminError("forbidden");
  }

  return { client: serverClient, user, admin: data };
}

/** Founding Beta: only `super_admin` may run platform-admin mutations. */
export function requireSuperAdmin(adminRecord) {
  if (String(adminRecord?.role || "").toLowerCase() === "super_admin") return;
  throw platformAdminError("forbidden");
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
