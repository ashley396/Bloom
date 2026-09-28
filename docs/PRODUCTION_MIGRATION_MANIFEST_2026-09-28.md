# Production migration manifest — release candidate of 2026-09-28

Target: Supabase project `sqdzaoxqlsgbphvlmfeb` (the live www.florisyn.com
database — note it is *named* "Florisyn Staging" in the Supabase
dashboard). Currently deployed code: `beta/august10-stabilization` @
`8d31a0e`. Nothing in this document has been applied to production; every
"current state" fact below was read from `information_schema` /
`pg_constraint` on 2026-09-28.

Read this top to bottom before approving. All seven migrations are
**additive** (new columns, one new table, new indexes, one new policy,
constraint swaps to *wider* or *composite* definitions). None rewrites or
deletes existing rows. None touches `orders`, `customers`, `payments`,
`shops` data, or auth.

## Why production is behind the repo

Production's migration history stops at `20260825165134
storage_admin_policy_use_definer_function` plus a few dashboard-only
entries. Six repo migrations (`20260822`, `20260830`, `20260901`,
`20260902`, `20260903`, `20260904`) were never applied there, and the
release candidate's Premium Creative path writes columns they add
(`marketing_generation_usage.trace_id/operation/cost_source/...`,
`ai_execution_jobs.idempotency_key`). A seventh (`20260905`) is new in this
release and is a no-op on production (its columns already exist there).

## ⚠ Ordering hazard — do not apply `20260822` verbatim

`20260822000000_lily_visual_creation_studio.sql` lines 34–36 *replace*
`ai_generated_assets_asset_type_check` with the 6-value list
`('social_post','image','video_concept','website_section','background','flyer')`.
Production already has the **wider 10-value** list from `20260829` (applied):
`(... 'video','voice','founder_concept','social_copy')`, and the release
candidate writes `founder_concept`, `social_copy`, `video` and `voice`
assets. Applying `20260822` as written would narrow the constraint back and
break those inserts. **Apply `20260822` with lines 34–36 omitted** (the
end-state constraint is already in place), or re-run `20260829`'s
constraint block immediately after. Staging (`lnarliipmqimkpdoitoa`), which
applied the chain in order, ends at the 10-value list — verified.

## Per-migration manifest

### 1. `20260822000000_lily_visual_creation_studio.sql` (apply minus lines 34–36)
- **Effect:** `ai_generated_assets.parent_asset_id uuid` (FK → self, on delete set null) + partial index; `ai_execution_jobs.conversation_id uuid` (FK → `lily_conversations`, on delete set null) + `context jsonb not null default '{}'` + partial index; new table `ai_style_memory (shop_id pk → shops, preferences jsonb, created_at, updated_at)` with RLS policy `is_shop_member(shop_id)`, grants (authenticated CRUD, service_role all, anon revoked), `touch_updated_at` trigger; `notify pgrst`.
- **Objects:** tables `ai_generated_assets`, `ai_execution_jobs`, `ai_style_memory`; indexes `ai_generated_assets_parent_idx`, `ai_execution_jobs_conversation_idx`; policy "ai style memory shop access".
- **Additive:** yes. **Lock/downtime:** `ADD COLUMN` with a constant default on `ai_execution_jobs` (0 rows in prod) — instant; `ai_generated_assets` (63 rows) — instant; partial indexes are built non-concurrently but on ≤63 rows.
- **Existing rows:** untouched (`parent_asset_id`/`conversation_id` NULL, `context` = `{}`).
- **Idempotent:** yes (`if not exists` / `drop ... if exists` everywhere).
- **Compatible with 8d31a0e:** yes — deployed code already reads `ai_style_memory` (tolerating its absence) and never writes the new columns.
- **Prerequisites verified in prod:** `lily_conversations` exists; `touch_updated_at()` and `is_shop_member()` exist.
- **Verify:** `select column_name from information_schema.columns where table_name in ('ai_execution_jobs') and column_name in ('conversation_id','context'); select count(*) from ai_style_memory;` and `select pg_get_constraintdef(oid) from pg_constraint where conname='ai_generated_assets_asset_type_check'` must still list 10 values.
- **Rollback:** not needed for 8d31a0e (columns unused). Forward recovery: `drop table ai_style_memory; alter table ai_execution_jobs drop column conversation_id, drop column context;` only if explicitly desired.

### 2. `20260830000000_shop_admin_config_member_read_policy.sql`
- **Effect:** policy `"shop admin config member read"` (SELECT, `to authenticated`, `is_shop_member(shop_id)`) + `grant select` on `shop_admin_config` to `authenticated`.
- **Objects:** `shop_admin_config` (1 row in prod). **Additive:** yes. **Lock:** none. **Existing rows:** untouched. **Idempotent:** yes.
- **Security effect:** lets a shop member *read their own shop's* config row (feature flags such as `marketing_studio_beta`) through the RLS client; writes stay admin-only (no insert/update/delete policy). Today the table has RLS enabled and no policy (advisor `rls_enabled_no_policy`).
- **Compatible with 8d31a0e:** yes. **Verify:** `select policyname from pg_policies where tablename='shop_admin_config';`
- **Rollback:** `drop policy "shop admin config member read" on public.shop_admin_config;`

### 3. `20260901000000_marketing_generation_usage_ledger_extension.sql`
- **Effect:** adds `model text, operation text, trace_id uuid, operation_id uuid, attempt_index int not null default 0, provider_request_id text, metadata jsonb not null default '{}', cost_source text not null default 'estimated'`; check `cost_source in ('estimated','provider_confirmed')`; **widens** `purpose` check to add `'vision'`; partial indexes on `trace_id`, `operation_id`; column comments.
- **Objects:** `marketing_generation_usage` (151 rows; existing `purpose` values are only `copy`/`image` — verified, so the new check passes). **Additive:** yes. **Lock:** short `ACCESS EXCLUSIVE` for the ALTERs on a 151-row table — sub-second. **Existing rows:** get defaults (`attempt_index 0`, `metadata {}`, `cost_source 'estimated'`); nothing rewritten.
- **Idempotent:** yes. **Compatible with 8d31a0e:** yes (deployed code selects the wide column list with a narrow fallback; inserts only the old columns).
- **Verify:** `select column_name from information_schema.columns where table_name='marketing_generation_usage' and column_name in ('trace_id','operation','cost_source','operation_id','attempt_index','provider_request_id','metadata','model');` → 8 rows.
- **Rollback:** drop the eight columns / two indexes; not required for 8d31a0e.

### 4. `20260902000000_marketing_platform_variants_shop_integrity.sql`
- **Effect:** guarded by a `DO` block that aborts if any variant references a content item of another shop (**prod count = 0, verified**); adds `unique (id, shop_id)` on `marketing_content_items`; replaces `marketing_platform_variants.content_item_id` single-column FK with composite FK `(content_item_id, shop_id) → marketing_content_items(id, shop_id)` on delete cascade.
- **Objects:** `marketing_content_items` (48 rows), `marketing_platform_variants` (48 rows). **Additive:** constraint-tightening only; no data change. **Lock:** brief exclusive locks while the unique index/FK validate over 48 rows. **Existing rows:** untouched.
- **Idempotent:** yes (drop if exists / re-add). **Compatible with 8d31a0e:** yes — deployed code always writes matching `shop_id`s.
- **Verify:** `select conname from pg_constraint where conname in ('marketing_content_items_id_shop_id_key','marketing_platform_variants_content_item_shop_fkey');` → 2 rows.
- **Rollback:** re-add the original single-column FK `marketing_platform_variants_content_item_id_fkey`.

### 5. `20260903000000_marketing_usage_and_clone_video_shop_integrity.sql`
- **Effect:** three `DO` guards (**all prod counts = 0, verified**); `unique (id, shop_id)` on `marketing_platform_variants`; composite FKs `marketing_generation_usage(content_item_id, shop_id)` and `marketing_clone_video_jobs(content_item_id, shop_id)` → `marketing_content_items`, and `marketing_clone_video_jobs(platform_variant_id, shop_id)` → `marketing_platform_variants`, each `on delete set null (<id column>)`.
- **Objects:** `marketing_platform_variants` (48), `marketing_generation_usage` (151; 0 orphan `content_item_id` refs — verified), `marketing_clone_video_jobs` (0). **Additive:** constraint-tightening only. **Lock:** brief. **Existing rows:** untouched.
- **Idempotent:** yes. **Requires:** #4 first (needs `marketing_content_items_id_shop_id_key`). **Compatible with 8d31a0e:** yes.
- **Verify:** `select conname from pg_constraint where conname in ('marketing_platform_variants_id_shop_id_key','marketing_generation_usage_content_item_shop_fkey','marketing_clone_video_jobs_content_item_shop_fkey','marketing_clone_video_jobs_platform_variant_shop_fkey');` → 4 rows.
- **Rollback:** re-add the three original single-column FKs.

### 6. `20260904000000_premium_creative_job_idempotency.sql`
- **Effect:** `ai_execution_jobs.idempotency_key text` + partial unique index; partial unique index on `marketing_generation_usage(operation_id)` where `provider='openai' and operation='premium_creative_image'`.
- **Objects:** `ai_execution_jobs` (0 rows), `marketing_generation_usage` (151 rows, no `openai` rows yet). **Additive:** yes. **Lock:** trivial. **Existing rows:** untouched. **Idempotent:** yes. **Requires:** #3 (needs `operation`/`operation_id`). **Compatible with 8d31a0e:** yes.
- **Verify:** `select indexname from pg_indexes where indexname in ('ai_execution_jobs_idempotency_key_uidx','marketing_generation_usage_premium_operation_uidx');` → 2 rows.
- **Rollback:** drop the two indexes and the column.

### 7. `20260905000000_shops_pos_register_columns.sql`
- **Effect:** `alter table shops add column if not exists pos_tiles jsonb / register_name text / register_id text`.
- **Production:** all three already exist (added by hand 2026-08-14/15, nullable, no default) → **strict no-op**; recording it in the migration history keeps prod and the repo chain aligned. **Staging:** creates them and resolves the `settings` 500.
- **Verify:** `select column_name from information_schema.columns where table_name='shops' and column_name in ('pos_tiles','register_name','register_id');` → 3 rows. **Rollback:** none needed.

## Proposed production sequence (needs Ashley's explicit approval)
1. Take a Supabase point-in-time reference (note the timestamp) — PITR is the real rollback for a schema change.
2. Apply in this exact order: #1 (minus lines 34–36) → #2 → #3 → #4 → #5 → #6 → #7, each via the Supabase migration API so the history records the version names.
3. Run every "Verify" query above plus the ordering-hazard check (asset_type check still has 10 values; purpose check now has 7 incl. `vision`).
4. Only then deploy the RC to `beta/august10-stabilization` (fast-forward).

## Rollback / forward recovery
- Code rollback: Netlify "publish deploy" `6a95cb856691700008009096` (8d31a0e). Every migration above is compatible with 8d31a0e, so the schema does **not** need to be rolled back for a code rollback.
- Schema rollback (only if a migration itself misbehaves): the per-item rollback statements above, or PITR to the timestamp from step 1.
