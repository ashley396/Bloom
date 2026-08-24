/**
 * Priority 8 ("as far as technically possible" pass): real, enforced cost
 * safety for the classic (non-compound) generation path. The compound
 * orchestrator (Priority 1, marketing-compound-orchestrator.js) already
 * treats a request-stated dollar budget as a real execution constraint;
 * generate_content — the original, single-item generation action — had
 * no budget gate at all: recordUsage() writes a real cost row, but
 * nothing ever compared it against a limit before the spend happened.
 * This closes that gap with the same discipline: estimate first, compare
 * against a cap, refuse BEFORE any real provider call if it would be
 * exceeded.
 *
 * A persisted per-shop default cap needs one new nullable column
 * (`shops.marketing_monthly_budget_cents`) — that migration is not
 * applied here (no production migration is applied in this pass; see the
 * governing constraints), so today a cap is only enforced when the
 * caller explicitly supplies one per request (mirrors the exact pattern
 * plan_month's own optional `allowance` override already uses — an
 * explicit per-call override, not a hidden default). Once that column
 * exists, wiring it in is a one-line read here, not a redesign.
 */

// A calendar-month boundary in UTC — matches marketing_generation_usage's
// own created_at (timestamptz, always compared/stored in UTC elsewhere in
// this codebase), so "this month" means the same thing here as it does
// anywhere else real usage is summarized.
function utcMonthStartIso(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Sums this calendar month's COMMITTED spend for a shop — 'estimated'
 * rows only. Every real generation call in this codebase writes its
 * estimate via recordUsage() BEFORE attempting the provider call, so an
 * estimated row already reflects money committed for the month whether
 * or not a later 'actual' row also lands for the same spend (Florisyn
 * never overwrites an estimate with its actual — see
 * marketing-cost-config.js's own doc — it appends a second row instead).
 * Summing 'estimated' alone avoids double-counting that second row while
 * staying conservative (a slight over-count from a since-failed attempt
 * is safe for a budget gate; under-counting would not be).
 */
export async function monthlyCommittedSpendCents(client, { shopId, now = new Date() } = {}) {
  const result = await client
    .from("marketing_generation_usage")
    .select("estimated_cost_cents")
    .eq("shop_id", shopId)
    .eq("status", "estimated")
    .gte("created_at", utcMonthStartIso(now));
  if (result.error) return { ok: false, error: result.error.message };
  const cents = (result.data || []).reduce((sum, row) => sum + (row.estimated_cost_cents || 0), 0);
  return { ok: true, cents };
}

/**
 * The real pre-spend gate: given what THIS operation would additionally
 * cost, checks whether current-month committed spend + that addition
 * would exceed the cap. `capCents == null` means no cap was supplied for
 * this request — always allowed (today's honest default, since no
 * persisted per-shop cap exists yet — see module doc). Never throws; a
 * DB error degrades to a blocked (fail-closed, not fail-open) result with
 * the real error attached, since a budget check that can't verify safety
 * must never silently let an expensive operation through.
 */
export async function checkMonthlyBudget(client, { shopId, additionalCostCents = 0, capCents = null, now = new Date() } = {}) {
  if (capCents == null) {
    return { allowed: true, capCents: null, currentSpendCents: null, wouldBeCents: null };
  }
  const spend = await monthlyCommittedSpendCents(client, { shopId, now });
  if (!spend.ok) {
    return { allowed: false, capCents, error: spend.error, reason: "budget_check_failed" };
  }
  const wouldBeCents = spend.cents + additionalCostCents;
  return { allowed: wouldBeCents <= capCents, capCents, currentSpendCents: spend.cents, wouldBeCents };
}
