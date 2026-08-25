/**
 * Real, consent-aware customer/CRM signals for Lily's general chat context
 * (Phase 7, "Customer/CRM intelligence", of the Lily Connected Intelligence
 * pass — connected the same way Phase 6 connected order workload).
 *
 * AUDIT BEFORE BUILDING found this mostly already exists:
 * buildAudienceSegments() (lib/marketing/audience-segments.js) already
 * computes repeat-customer, VIP, high-spend, new, lapsed, birthday-this-
 * month, anniversary-this-month, and per-occasion segments — every one of
 * them filtered to customers who explicitly opted in to marketing
 * (contact_preferences.marketing_opt_in === true) before any other
 * criterion is applied — and it's already wired into marketing-
 * campaigns.js's `?action=audiences` endpoint for the Marketing Campaigns
 * UI. What was NOT built: Lily's general chat (ai-context.js) had no
 * access to any of it — a florist asking Lily "who should get a birthday
 * reminder this month?" got no real answer, even though the exact same
 * computation was one click away in Marketing Campaigns.
 *
 * This module does not reimplement segmentation — it loads the same
 * fields marketing-campaigns.js's own `?action=audiences` action loads and
 * calls the same buildAudienceSegments(). It only ever returns segment
 * KEY/LABEL/COUNT — never a customer id, name, birthday, or contact
 * detail — matching the exact PII discipline that endpoint (and ai-
 * context.js's own minimal customers query) already follows.
 *
 * Gated on the MARKETING_CAMPAIGNS feature flag (already on in
 * production, distinct from and unrelated to the still-OFF
 * MARKETING_STUDIO flag) so a shop that somehow has it disabled pays zero
 * extra query cost here instead of silently running a feature that's off
 * elsewhere.
 */

import { isFeatureEnabled } from "./feature-flags.js";
import { buildAudienceSegments } from "../../../lib/marketing/audience-segments.js";

const EMPTY = Object.freeze({ enabled: false, subscriberCount: 0, segments: [] });

export async function loadCustomerAudienceSummary(client, shopId) {
  if (!isFeatureEnabled("MARKETING_CAMPAIGNS")) return EMPTY;

  const [{ data: customers, error: cErr }, { data: orders, error: oErr }] = await Promise.all([
    client.from("customers").select("id,vip,birthday,anniversary,created_at,contact_preferences").eq("shop_id", shopId).is("deleted_at", null),
    client.from("orders").select("customer_id,total,occasion,fulfillment,created_at").eq("shop_id", shopId)
  ]);
  // A real DB error here shouldn't break the rest of Lily's context — the
  // caller already has shop/inventory/orders/etc. without this; degrade to
  // the same honestly-empty shape rather than throwing.
  if (cErr || oErr) return EMPTY;

  const { segments, subscriberCount } = buildAudienceSegments({ customers: customers || [], orders: orders || [] });
  return {
    enabled: true,
    subscriberCount,
    segments: segments.map(({ key, label, count }) => ({ key, label, count }))
  };
}

// The handful of segments generically useful to mention while drafting
// marketing copy — deliberately excludes the per-occasion buckets
// (past_valentines_buyers, wedding_customers, etc.) and high_spend: those
// are real too, but noisier to fold into a general-purpose prompt brief
// than a targeted campaign actually built around them would want.
const PROMPT_SEGMENT_KEYS = ["vip", "repeat", "new", "lapsed", "birthday_this_month", "anniversary_this_month"];

/**
 * Turns loadCustomerAudienceSummary()'s structured result into one prompt-
 * ready sentence — the same "compose only what's real and non-zero" shape
 * as order-workload-intelligence.js's buildWorkloadSummaryText(), used by
 * marketing-generation-grounding.js (Phase 9: connecting this real
 * audience data into actual campaign-copy generation, not just Lily's
 * read-only chat context). Never invents a segment or count that isn't in
 * `audienceSummary` — an empty/disabled summary returns null, not a
 * guessed placeholder.
 */
export function buildAudienceGroundingBrief(audienceSummary) {
  if (!audienceSummary?.enabled || !audienceSummary.subscriberCount) {
    return { summaryText: null, grounded: false };
  }
  const bySegmentKey = new Map((audienceSummary.segments || []).map((s) => [s.key, s]));
  const count = audienceSummary.subscriberCount;
  const parts = [`${count} marketing subscriber${count === 1 ? "" : "s"}`];
  for (const key of PROMPT_SEGMENT_KEYS) {
    const seg = bySegmentKey.get(key);
    if (seg && seg.count > 0) parts.push(`${seg.count} ${seg.label.toLowerCase()}`);
  }
  const summaryText = `Real audience data for this shop (never invent a different number or segment): ${parts.join("; ")}. Only mention an audience size or segment if the request is actually about targeting, reach, or a specific customer group — never force a mention into copy that isn't about that.`;
  return { summaryText, grounded: true };
}
