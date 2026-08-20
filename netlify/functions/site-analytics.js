// First-party, non-invasive marketing-site analytics (SEO/GEO brief,
// Section 22): tracks organic/AI referral sources, landing pages, and
// signup/Founding-Florist conversions for florisyn.com's own public
// pages — never a third-party script, never a cookie, never an IP or
// anything identifying. Reuses the existing audit_events table and
// writeShopAudit() helper (the same place client-error reports already
// land for anonymous visitors) rather than a new table.
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { admin } from "./_shared/supabase.js";
import { checkRateLimit, writeShopAudit, structuredLog } from "./_shared/production.js";
import { sanitizeSiteAnalyticsPayload } from "./_shared/validation.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  const limit = checkRateLimit(event, { key: "site-analytics", limit: 120, windowMs: 60_000 });
  if (!limit.allowed) {
    return json(429, { error: "Too many events. Try again shortly." });
  }

  try {
    const body = bodyOf(event);
    const safe = sanitizeSiteAnalyticsPayload(body);
    if (!safe) return json(204, {});

    const client = admin();
    await writeShopAudit(client, {
      eventType: safe.eventType,
      entityType: "marketing_site",
      metadata: safe.metadata,
    });

    return json(204, {});
  } catch (error) {
    // Analytics must never break a visitor's page or surface an error
    // toast — best-effort only.
    structuredLog("warn", "site_analytics insert skipped", {
      reason: String(error?.message || error).slice(0, 200),
    });
    return json(204, {});
  }
}
