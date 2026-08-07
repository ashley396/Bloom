import { adminIfConfigured } from "./supabase.js";
import { logAuthEvent } from "./auth-email.js";

export const MEMBERSHIP_MESSAGE =
  "Your Florisyn login works, but this account is not linked to an active flower shop yet. Finish onboarding or contact Florisyn support so we can attach your shop membership.";
export const MEMBERSHIP_CHECK_UNAVAILABLE =
  "Sign in is temporarily unavailable while we verify shop access. Please try again in a moment.";

function isMissingColumnError(error, column = "status") {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes(column.toLowerCase()) && (msg.includes("column") || msg.includes("schema cache"));
}

/**
 * Active shop membership only. Missing `status` column fails closed (no legacy skip).
 */
export async function hasActiveShopMembership(client, userId) {
  const result = await client
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (result.error) {
    if (isMissingColumnError(result.error, "status")) {
      const err = new Error("Shop membership schema is incomplete.");
      err.statusCode = 503;
      err.code = "membership_check_unavailable";
      throw err;
    }
    throw result.error;
  }
  return Boolean(result.data?.shop_id);
}

export async function isActivePlatformAdmin(client, userId) {
  const result = await client
    .from("platform_admins")
    .select("user_id,active")
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data?.active);
}

/**
 * Gate session minting (login + refresh). Fail closed when service role or lookup is unavailable.
 */
export async function assertFloristAccessOrAdmin(userId, event, requestId, { flow = "login" } = {}) {
  if (!userId) {
    return { ok: false, status: 401, code: "invalid_credentials", error: "Invalid email or password." };
  }
  const client = adminIfConfigured();
  if (!client) {
    logAuthEvent(
      "error",
      `${flow}_membership_check_unavailable`,
      { user_id: userId, request_id: requestId, reason: "service_role_missing" },
      event
    );
    return {
      ok: false,
      status: 503,
      code: "membership_check_unavailable",
      error: MEMBERSHIP_CHECK_UNAVAILABLE
    };
  }
  try {
    if (await hasActiveShopMembership(client, userId)) return { ok: true, kind: "shop_member" };
    if (await isActivePlatformAdmin(client, userId)) return { ok: true, kind: "platform_admin" };
    logAuthEvent(
      "warn",
      `${flow}_shop_membership_required`,
      { user_id: userId, request_id: requestId },
      event
    );
    return { ok: false, status: 403, code: "shop_membership_required", error: MEMBERSHIP_MESSAGE };
  } catch (error) {
    logAuthEvent(
      "error",
      `${flow}_membership_check_failed`,
      { user_id: userId, request_id: requestId, provider_status: error?.status || error?.code || "error" },
      event
    );
    return {
      ok: false,
      status: 503,
      code: "membership_check_unavailable",
      error: MEMBERSHIP_CHECK_UNAVAILABLE
    };
  }
}
