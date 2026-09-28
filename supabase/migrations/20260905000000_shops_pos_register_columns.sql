-- Shops: POS tile layout + register identity columns — repo-canonical.
--
-- Launch-readiness audit (2026-09-28), settings 500 root cause:
-- netlify/functions/settings.js has selected/patched `pos_tiles`,
-- `register_name` and `register_id` on public.shops since commits b355821
-- (feat(pos): sync custom POS tiles across devices) and 6ad32df
-- (feat(pos-settings): make Checkout defaults editable), but NO migration
-- in this repo ever created those columns. On the production project they
-- were added by hand through the dashboard (its migration history records
-- `add_pos_tiles_to_shops` 20260814173916 and
-- `add_register_name_and_id_to_shops` 20260815153930 with no matching
-- file here), so production works; every environment built from this
-- chain alone (the marketing staging project, CI's disposable Postgres,
-- any future project) is missing them, and PostgREST answers
-- `GET /settings` with 42703 "column shops.pos_tiles does not exist" —
-- the recurring settings 500 that empties the Settings and Website Studio
-- forms and blocks every settings PATCH (the PATCH re-selects the same
-- column list).
--
-- This file makes the chain self-sufficient again. Column types and
-- nullability match production exactly (jsonb / text / text, all nullable,
-- no defaults — inspected 2026-09-28), so this is a strict no-op where the
-- columns already exist and never rewrites a value anywhere.

alter table public.shops add column if not exists pos_tiles jsonb;
alter table public.shops add column if not exists register_name text;
alter table public.shops add column if not exists register_id text;
