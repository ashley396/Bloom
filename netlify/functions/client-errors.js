import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { fail, admin } from "./_shared/supabase.js";
import { checkRateLimit, structuredLog, writeShopAudit } from "./_shared/production.js";
import { sanitizeClientErrorPayload } from "./_shared/validation.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  const limit = checkRateLimit(event, { key: "client-errors", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) {
    return json(429, { error: "Too many error reports. Try again shortly." });
  }

  try {
    const body = bodyOf(event);
    const safe = sanitizeClientErrorPayload(body);
    let userId = null;
    let shopId = null;
    try {
      const { currentUser } = await import("./_shared/supabase.js");
      const ctx = await currentUser(event);
      userId = ctx.user?.id;
      shopId = ctx.shopId;
    } catch {
      // anonymous client reports allowed
    }

    structuredLog("error", "client_error_report", {
      type: safe.type || "client",
      message: String(safe.message || "unknown").slice(0, 500),
      path: String(safe.path || "").slice(0, 200),
      status: safe.status,
      shop_id: shopId,
      user_id: userId
    });

    if (shopId || userId) {
      const client = admin();
      await writeShopAudit(client, {
        shopId,
        userId,
        eventType: "client_error",
        entityType: "client",
        metadata: safe
      });
    }

    return json(204, {});
  } catch (error) {
    return fail(error);
  }
}
