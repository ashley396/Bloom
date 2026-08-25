/**
 * Florisyn's one authoritative shop-context layer for marketing content
 * generation (Phase 4 of the "Florist-Facing Marketing Studio + Lily
 * Connected Intelligence" pass).
 *
 * Composes existing, independently-tested per-domain loaders — never
 * reimplements them:
 *   - marketing-brand-brain.js  — the shop's learned WRITING voice
 *   - ai-style-memory.js        — the shop's learned VISUAL creative style
 *   - marketing-inventory-grounding.js — real current stock (PR #177)
 *   - customer-audience-grounding.js — real, consent-aware audience
 *     segment counts (Phase 7), added here for Phase 9 ("connect
 *     intelligence to marketing"): the same real subscriber/VIP/repeat/
 *     lapsed/birthday counts Lily's read-only chat context already gets
 *     (ai-context.js) can now also ground actual campaign-copy generation
 *     — Lily can say "for your 6 subscribers with birthdays this month"
 *     instead of a vague, unverifiable "your loyal customers".
 *
 * Before this module, three separate call sites (marketing-studio.js's
 * generate_content, marketing-compound-orchestrator.js,
 * ai-orchestrator.js) each independently decided which of these to load
 * and pass into generateSocialPost/generateVideoConcept — inconsistently.
 * ai-orchestrator.js (the general Lily chat path, the most commonly used
 * entry point) passed NONE of the three into those calls, even though it
 * already computed a visual style summary for an unrelated step and just
 * never threaded it through. This is now the one place that decision gets
 * made, so every caller gets the same real grounding by default and a gap
 * like that can't recur silently in a future call site.
 *
 * Intent-driven, not a giant dump: `needs` lets a caller ask for only what
 * it actually uses (e.g. a plain background-image step has no reason to
 * pay for a Brand Brain read). brand/style/inventory default to included
 * because every existing caller this replaces already wanted all three;
 * `audience` is opt-in only (its two underlying queries read the shop's
 * FULL customers + orders history, unbounded — heavier than the other
 * three's small/limited reads) — a caller adds it to `needs` explicitly
 * when it's actually about to generate copy that could reference an
 * audience.
 *
 * Lazily memoized per the `ctx` object a caller already owns (the same
 * ctx.jobId-scoped object marketing-compound-orchestrator.js already uses
 * for its own getBrandVoiceSummary/getVisualStyleSummary getters) — a job
 * that generates three platform variants still only ever pays for ONE
 * Brand Brain read, ONE My Style read, ONE inventory read, not one per
 * variant. Pass a plain {} when a caller has no longer-lived ctx to reuse.
 *
 * Shop-scoped and permission-aware by inheritance: every underlying loader
 * already scopes its own query with .eq("shop_id", shopId) — this module
 * adds no new query of its own, and the shopId it's given must already
 * come from a caller that resolved it from a real, authorized session
 * (never a client-supplied value this module trusts on its own).
 */

import { loadBrandBrain, buildBrandSummary } from "./marketing-brand-brain.js";
import { loadStyleMemory, buildStyleSummary } from "./ai-style-memory.js";
import { loadGroundedInventory, buildInventoryGroundingBrief } from "./marketing-inventory-grounding.js";
import { loadCustomerAudienceSummary, buildAudienceGroundingBrief } from "./customer-audience-grounding.js";

const EMPTY_INVENTORY_BRIEF = Object.freeze({ summaryText: null, sources: [], grounded: false });
const EMPTY_AUDIENCE_BRIEF = Object.freeze({ summaryText: null, grounded: false });

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} shopId
 * @param {object} [opts]
 * @param {("brand"|"style"|"inventory"|"audience")[]} [opts.needs] - defaults to brand+style+inventory; "audience" is opt-in (see module docstring)
 * @param {object} [opts.ctx] - an object to memoize onto across repeated
 *   calls within the same job/request (e.g. one generation per platform).
 *   Optional — a fresh {} is used (and discarded) when omitted.
 * @returns {Promise<{brandVoiceSummary: string, visualStyleSummary: string, inventorySummary: string|null, inventorySources: Array, audienceSummary: string|null}>}
 */
export async function loadGenerationGrounding(client, shopId, { needs = ["brand", "style", "inventory"], ctx = {} } = {}) {
  const want = new Set(needs);

  if (want.has("brand") && ctx._genGroundingBrand === undefined) {
    const { preferences } = await loadBrandBrain(client, shopId);
    ctx._genGroundingBrand = buildBrandSummary(preferences);
  }
  if (want.has("style") && ctx._genGroundingStyle === undefined) {
    const { preferences } = await loadStyleMemory(client, shopId);
    ctx._genGroundingStyle = buildStyleSummary(preferences);
  }
  if (want.has("inventory") && ctx._genGroundingInventory === undefined) {
    const inv = await loadGroundedInventory(client, shopId);
    ctx._genGroundingInventory = inv.ok ? buildInventoryGroundingBrief(inv.items) : EMPTY_INVENTORY_BRIEF;
  }
  if (want.has("audience") && ctx._genGroundingAudience === undefined) {
    const audience = await loadCustomerAudienceSummary(client, shopId);
    ctx._genGroundingAudience = buildAudienceGroundingBrief(audience);
  }

  return {
    brandVoiceSummary: want.has("brand") ? ctx._genGroundingBrand || "" : "",
    visualStyleSummary: want.has("style") ? ctx._genGroundingStyle || "" : "",
    inventorySummary: want.has("inventory") ? ctx._genGroundingInventory?.summaryText || null : null,
    inventorySources: want.has("inventory") ? ctx._genGroundingInventory?.sources || [] : [],
    audienceSummary: want.has("audience") ? ctx._genGroundingAudience?.summaryText || null : null
  };
}
