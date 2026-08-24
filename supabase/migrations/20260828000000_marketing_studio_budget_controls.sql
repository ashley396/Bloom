-- Priority 2 of the "finish everything that can safely be completed
-- without Ashley" pass: a real, persisted per-shop default monthly
-- budget cap for Florisyn Marketing Studio AI generation spend.
--
-- NOT APPLIED to any environment by this migration file's existence —
-- see the governing "no production migrations are applied in this pass"
-- constraint. The application code (marketing-budget-guard.js's
-- getShopBudgetCapCents()) already degrades safely when this column does
-- not exist: a missing-column Postgres error is treated exactly like a
-- missing table (existing missingRelation()-style handling), so nothing
-- breaks before this is applied and nothing needs to change in calling
-- code once it is.
--
-- Nullable, no default value change for existing shops: NULL means
-- "no shop-level default configured" — the exact behavior every shop has
-- today (unlimited, unless a caller supplies its own per-request cap).

alter table public.shops
  add column if not exists marketing_monthly_budget_cents integer;

alter table public.shops
  drop constraint if exists shops_marketing_monthly_budget_cents_check;

alter table public.shops
  add constraint shops_marketing_monthly_budget_cents_check
  check (marketing_monthly_budget_cents is null or marketing_monthly_budget_cents >= 0);

comment on column public.shops.marketing_monthly_budget_cents is
  'Optional per-shop default monthly cap (in cents) for AI marketing generation spend (Florisyn Marketing Studio). NULL = unlimited (default — unchanged behavior for every existing shop). Enforced by marketing-budget-guard.js''s checkMonthlyBudgetForRequest() before any real generation call, both for the classic generate_content action and the compound-request orchestrator. A caller-supplied per-request cap may be stricter than this default but can never be used to exceed it — the effective cap is always the tighter of the two.';
