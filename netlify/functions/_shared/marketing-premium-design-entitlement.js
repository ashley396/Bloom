/**
 * Premium Marketing Design entitlement — server-side calculation SHAPE
 * only (Hybrid Marketing Studio Batch 2, Part 12).
 *
 * Ashley's own explicit instruction: "Do NOT implement Stripe pricing or
 * customer billing yet. But create the server-side entitlement
 * calculation shape needed later." — and: "If current schema cannot
 * safely support this without a migration: STOP and report the gap. Do
 * not invent a migration in this batch."
 *
 * No migration was needed. Originally (Batch 2, Part 12) a "Premium
 * Marketing Design" was defined as one `marketing_generation_usage` row
 * where `provider = 'openai'`, `operation = OPENAI_PREMIUM_CREATIVE_OPERATION`,
 * and `attempt_index = 0` — the FIRST reservation row for a given premium
 * generation. Batch 4's real staging 504 proved that definition wrong: it
 * counted a reservation the instant it was WRITTEN, regardless of whether
 * the real provider call that followed ever succeeded — so a timed-out,
 * failed, or forever-stuck-"estimated" attempt (see Batch 4's own
 * investigation) consumed a florist's monthly Premium Design allowance
 * for a design she never actually received. That conflated PROVIDER
 * SPEND (tracked per-attempt in the usage ledger, unchanged) with
 * FLORIST ENTITLEMENT CONSUMPTION (what this module exists to measure).
 *
 * Batch 4, Part G fix: a "Premium Marketing Design" now means one
 * COMPLETED `ai_execution_jobs` row (`job_type = PREMIUM_JOB_TYPE`,
 * `status = 'completed'`) — the one state
 * marketing-premium-creative-job.js's own settlePremiumJobCompleted()
 * only ever reaches after a real image URL came back from OpenAI and was
 * durably persisted as a real asset. A job with a failed attempt, a
 * reservation that was never started, or a provider result that's
 * genuinely unknown (a process death mid-call — see
 * PREMIUM_JOB_RECOVERY_STATES) never reaches 'completed', so none of
 * those ever counts here — even though a Retry (Part J) may have created
 * more than one usage-ledger reservation row for that same job along the
 * way. One completed job = one consumed Premium Design, no matter how
 * many failed attempts preceded the success. Still no new table, no new
 * column, no migration — `ai_execution_jobs` already existed for exactly
 * this shape.
 *
 * NOT WIRED INTO A LIVE GATE YET. This module has no code path that looks
 * up a real shop's billing plan — that lookup doesn't exist yet anywhere
 * in this codebase (Stripe/billing integration is future work). Calling
 * this against a guessed plan would either wrongly block a shop that paid
 * for more, or wrongly allow one that didn't — worse than not gating at
 * all. A future batch that adds real per-shop plan data wires
 * checkPremiumDesignEntitlement() into the live path; this batch only
 * builds the pure calculation shape.
 */

// Batch 4, Part G: imported rather than redefined, so this module and
// marketing-premium-creative-job.js can never drift on what job_type a
// completed Premium Design actually is.
import { PREMIUM_JOB_TYPE } from "./marketing-premium-creative-job.js";

// The one operation name every Premium Creative reservation row uses —
// exported so the orchestrator and this module never drift out of sync
// on what "a Premium Marketing Design" means in the ledger.
export const OPENAI_PREMIUM_CREATIVE_OPERATION = "premium_creative_image";

/**
 * Part 12's own numbers. Founding Florist is deliberately NOT capped here
 * — "grandfathered pricing, entitlement TBD separately... DO NOT remove
 * existing rights" — represented as `null` (no ceiling enforced by this
 * shape) rather than guessing a number Ashley never gave.
 */
export const PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN = Object.freeze({
  founding_florist: null,
  starter: 30,
  professional: 100,
  enterprise: 300
});

function startOfMonthIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Counts real Premium Marketing Designs actually COMPLETED this calendar
 * month (UTC) for one shop — never an estimate, never a guess, and never
 * a reservation that was merely attempted (Part G — see this module's own
 * doc for the real staging incident that proved counting reservations
 * wrong). Queries `ai_execution_jobs` for this job type's one terminal
 * success state only; never throws (fails closed to `null` count on a
 * query error, since "unknown usage" must never be silently read as
 * "zero usage used" by a future caller that gates on this).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} shopId
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<{ ok: boolean, used: number|null, error?: string }>}
 */
export async function countPremiumDesignsUsedThisMonth(client, shopId, { now = new Date() } = {}) {
  if (!shopId) return { ok: false, used: null, error: "countPremiumDesignsUsedThisMonth requires shopId." };
  try {
    const result = await client
      .from("ai_execution_jobs")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("job_type", PREMIUM_JOB_TYPE)
      .eq("status", "completed")
      .gte("created_at", startOfMonthIso(now));
    if (result.error) return { ok: false, used: null, error: result.error.message };
    return { ok: true, used: result.count ?? 0 };
  } catch (error) {
    return { ok: false, used: null, error: String(error?.message || error).slice(0, 300) };
  }
}

/**
 * The pure entitlement check a future live gate would call once real
 * per-shop plan data exists. `planTier` must be supplied by the caller
 * (this module has no opinion about where a shop's real plan comes
 * from) — an unrecognized plan fails closed (`ok: false`), never
 * defaults to unlimited.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} shopId
 * @param {string} planTier - one of PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN's keys.
 * @returns {Promise<{ ok: boolean, allowed: boolean, used: number|null, allowance: number|null, remaining: number|null, error?: string }>}
 */
export async function checkPremiumDesignEntitlement(client, shopId, planTier) {
  if (!(planTier in PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN)) {
    return { ok: false, allowed: false, used: null, allowance: null, remaining: null, error: `Unrecognized plan tier: ${JSON.stringify(planTier)}.` };
  }
  const allowance = PREMIUM_DESIGN_MONTHLY_ALLOWANCE_BY_PLAN[planTier];
  // Founding Florist: no ceiling enforced by this shape (see module doc).
  if (allowance === null) {
    return { ok: true, allowed: true, used: null, allowance: null, remaining: null };
  }
  const usage = await countPremiumDesignsUsedThisMonth(client, shopId);
  if (!usage.ok) {
    return { ok: false, allowed: false, used: null, allowance, remaining: null, error: usage.error };
  }
  const remaining = Math.max(0, allowance - usage.used);
  return { ok: true, allowed: usage.used < allowance, used: usage.used, allowance, remaining };
}
