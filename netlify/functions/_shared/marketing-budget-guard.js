/**
 * Real, enforced cost safety for both the classic (generate_content) and
 * compound-request generation paths: estimate first, compare against a
 * cap, refuse BEFORE any real provider call if it would be exceeded.
 *
 * A persisted per-shop default cap now has a real column —
 * `shops.marketing_monthly_budget_cents`, added by an UNAPPLIED migration
 * (20260828000000_marketing_studio_budget_controls.sql; no production
 * migration is applied in this pass). getShopBudgetCapCents() degrades
 * safely (treats a missing-column error exactly like a missing table)
 * until that migration is applied anywhere — every existing caller and
 * test keeps working unmodified either way. checkMonthlyBudgetForRequest()
 * is the real combined gate: it resolves the shop's persisted default
 * against a caller-supplied per-request cap — the per-request cap may be
 * stricter, but can never be used to exceed the shop's configured hard
 * cap (resolveEffectiveBudgetCapCents() always takes the tighter of the
 * two) — and reports a structured reason plus remaining budget, not just
 * an allowed/blocked boolean.
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

/** True for a real Postgres "this column/table doesn't exist yet" error —
 * the exact situation before 20260828000000_marketing_studio_budget_
 * controls.sql is applied anywhere. Mirrors marketing-studio.js's own
 * missingRelation() convention (undefined_table 42P01, undefined_column
 * 42703, PostgREST's schema-cache-miss code, or the matching message
 * text) so a missing column degrades exactly like a missing table always
 * has elsewhere in this codebase. */
function isSchemaMismatchError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    error?.code === "42703" ||
    error?.code === "42P01" ||
    error?.code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the")
  );
}

/**
 * Reads the shop's persisted default monthly budget cap
 * (shops.marketing_monthly_budget_cents). Never throws; a schema
 * mismatch (column not added yet) degrades to "no persisted cap" rather
 * than an error — see module doc. A real, unexpected DB error still
 * reports ok:false so a caller can fail closed rather than silently
 * treating an unverifiable shop as uncapped.
 */
export async function getShopBudgetCapCents(client, shopId) {
  const result = await client.from("shops").select("marketing_monthly_budget_cents").eq("id", shopId).maybeSingle();
  if (result.error) {
    if (isSchemaMismatchError(result.error)) return { ok: true, capCents: null, columnExists: false };
    return { ok: false, error: result.error.message };
  }
  const value = result.data?.marketing_monthly_budget_cents;
  return { ok: true, capCents: typeof value === "number" ? value : null, columnExists: true };
}

/**
 * Combines a shop's persisted default cap with a caller-supplied
 * per-request cap into the one real ceiling that governs a request. A
 * per-request cap may be stricter (lower) than the shop default — that's
 * a florist deliberately being more conservative for one request — but a
 * per-request cap can NEVER be used to exceed a configured shop hard cap.
 * `null` on either side means "not set"; `null` on both means unlimited
 * (today's default for every shop with nothing configured either way).
 */
export function resolveEffectiveBudgetCapCents({ shopCapCents = null, requestedCapCents = null } = {}) {
  if (shopCapCents == null) return requestedCapCents;
  if (requestedCapCents == null) return shopCapCents;
  return Math.min(shopCapCents, requestedCapCents);
}

/**
 * The real, combined pre-spend gate every generation caller should use
 * (classic generate_content and the compound orchestrator's budget_check
 * step both call this, not checkMonthlyBudget directly) — resolves the
 * effective cap (see resolveEffectiveBudgetCapCents), then applies the
 * same fail-closed monthly-spend check. Reports a structured `reason` and
 * `remainingCents` so a caller (and the admin UI) can explain WHY a
 * request was refused, and how much headroom is actually left, not just
 * a bare boolean.
 */
export async function checkMonthlyBudgetForRequest(client, { shopId, additionalCostCents = 0, requestedCapCents = null, now = new Date() } = {}) {
  const shopCap = await getShopBudgetCapCents(client, shopId);
  if (!shopCap.ok) {
    return { allowed: false, reason: "shop_budget_lookup_failed", error: shopCap.error, capCents: null, capSource: null };
  }
  const effectiveCapCents = resolveEffectiveBudgetCapCents({ shopCapCents: shopCap.capCents, requestedCapCents });
  const capSource = effectiveCapCents == null ? "none" : shopCap.capCents != null && (requestedCapCents == null || shopCap.capCents <= requestedCapCents) ? "shop_default" : "request_override";

  const check = await checkMonthlyBudget(client, { shopId, additionalCostCents, capCents: effectiveCapCents, now });
  const remainingCents = effectiveCapCents != null && check.currentSpendCents != null ? Math.max(0, effectiveCapCents - check.currentSpendCents) : null;
  return {
    ...check,
    reason: check.allowed ? null : check.reason || "over_budget",
    capSource,
    shopCapCents: shopCap.capCents,
    requestedCapCents,
    remainingCents
  };
}
