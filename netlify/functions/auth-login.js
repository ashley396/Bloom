import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail, adminIfConfigured } from "./_shared/supabase.js";
import { checkRateLimit, writeShopAudit } from "./_shared/production.js";
import { validateEmail } from "./_shared/validation.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";
import { logAuthEvent, mapAuthProviderFailure } from "./_shared/auth-email.js";

const MEMBERSHIP_MESSAGE =
  "Your Florisyn login works, but this account is not linked to an active flower shop yet. Finish onboarding or contact Florisyn support so we can attach your shop membership.";

function isMissingColumnError(error, column = "status") {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes(column.toLowerCase()) && (msg.includes("column") || msg.includes("schema cache"));
}

async function hasActiveShopMembership(client, userId) {
  let result = await client
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (result.error && isMissingColumnError(result.error, "status")) {
    result = await client.from("shop_members").select("shop_id").eq("user_id", userId).limit(1).maybeSingle();
  }
  if (result.error) throw result.error;
  return Boolean(result.data?.shop_id);
}

async function isActivePlatformAdmin(client, userId) {
  const result = await client
    .from("platform_admins")
    .select("user_id,active")
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data?.active);
}

/**
 * Florist accounts need an active shop membership before a session is issued.
 * Platform admins may sign in without shop membership (Admin console path).
 * If service role is unavailable, skip the gate and let currentUser enforce later.
 */
async function assertFloristAccessOrAdmin(userId, event, requestId) {
  const client = adminIfConfigured();
  if (!client || !userId) return { ok: true, skipped: true };
  try {
    if (await hasActiveShopMembership(client, userId)) return { ok: true, kind: "shop_member" };
    if (await isActivePlatformAdmin(client, userId)) return { ok: true, kind: "platform_admin" };
    logAuthEvent(
      "warn",
      "login_shop_membership_required",
      { user_id: userId, request_id: requestId },
      event
    );
    return { ok: false, code: "shop_membership_required", error: MEMBERSHIP_MESSAGE };
  } catch (error) {
    logAuthEvent(
      "warn",
      "login_membership_check_failed",
      { user_id: userId, request_id: requestId, provider_status: error?.status || error?.code || "error" },
      event
    );
    // Fail open to currentUser membership enforcement when lookup is unavailable.
    return { ok: true, skipped: true };
  }
}

export async function handler(event) {
  const requestId = requestIdOf(event);
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  const limit = checkRateLimit(event, { key: "auth-login", limit: 30, windowMs: 60_000 });
  if (!limit.allowed) {
    return json(429, {
      error: "Too many sign-in attempts. Please wait and try again.",
      code: "auth_rate_limited"
    });
  }
  try {
    const body = bodyOf(event);
    const emailCheck = validateEmail(body.email, { required: true });
    if (!emailCheck.ok) {
      return json(400, { error: emailCheck.error, code: emailCheck.code || "invalid_email" });
    }
    const password = String(body.password || "");
    if (password.length < 8) {
      return json(400, { error: "Password is required.", code: "password_required" });
    }
    const { url, anonKey } = publicSettings();
    const response = await fetchWithTimeout(
      `${url}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`
        },
        body: JSON.stringify({ email: emailCheck.value, password })
      },
      { timeoutMs: 5_000, service: "Authentication service" }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const mapped = mapAuthProviderFailure(response, data, { flow: "login" });
      if (
        mapped.code === "email_not_confirmed" ||
        mapped.code === "auth_rate_limited" ||
        mapped.code === "auth_email_provider_unavailable"
      ) {
        logAuthEvent(
          "warn",
          mapped.code === "email_not_confirmed" ? "login_email_not_confirmed" : "login_provider_failed",
          {
            email_domain: emailCheck.value.split("@")[1],
            provider_status: response.status,
            code: mapped.code,
            request_id: requestId
          },
          event
        );
        return json(mapped.statusCode, { error: mapped.error, code: mapped.code });
      }
      logAuthEvent(
        "warn",
        "login_failed",
        {
          email_domain: emailCheck.value.split("@")[1],
          provider_status: response.status,
          request_id: requestId
        },
        event
      );
      const auditClient = adminIfConfigured();
      if (auditClient) {
        await writeShopAudit(auditClient, {
          userId: null,
          eventType: "login_failed",
          entityType: "auth",
          metadata: { email_domain: emailCheck.value.split("@")[1] }
        });
      }
      return json(401, { error: "Invalid email or password.", code: "invalid_credentials" });
    }

    const access = await assertFloristAccessOrAdmin(data.user?.id, event, requestId);
    if (!access.ok) {
      return json(403, { error: access.error, code: access.code });
    }

    logAuthEvent(
      "info",
      "login_success",
      { user_id: data.user?.id, access_kind: access.kind || "unknown", request_id: requestId },
      event
    );
    const auditClient = adminIfConfigured();
    if (auditClient) {
      await writeShopAudit(auditClient, {
        userId: data.user?.id,
        eventType: "login_success",
        entityType: "auth",
        entityId: data.user?.id
      });
    }
    return json(200, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      user: data.user
    });
  } catch (error) {
    return fail(error);
  }
}
