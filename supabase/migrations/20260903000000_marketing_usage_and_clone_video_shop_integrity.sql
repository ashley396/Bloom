-- Final tenant-integrity patch: closes the SAME class of gap fixed by
-- 20260902000000_marketing_platform_variants_shop_integrity.sql on two
-- more relationships, both discovered while tracing that exact
-- relationship and explicitly reported (not fixed) in that migration's
-- own comments:
--
--   1. marketing_generation_usage.content_item_id (nullable, was a
--      single-column FK to marketing_content_items(id) only).
--   2. marketing_clone_video_jobs.content_item_id (nullable, was a
--      single-column FK to marketing_content_items(id) only).
--   3. marketing_clone_video_jobs.platform_variant_id (nullable, was a
--      single-column FK to marketing_platform_variants(id) only).
--
-- PROVEN DEFECT (reproduced live before writing this migration, against
-- the real schema through 20260902000000): a Shop A row could carry its
-- own legitimate shop_id while any of the three columns above referenced
-- a parent row that actually belongs to Shop B. RLS on both child tables
-- only ever validates is_shop_member(shop_id) on the CHILD's own
-- shop_id column — the same shape of gap as the prior patch, just on two
-- more tables.
--
-- FIX: the same composite parent-child foreign key pattern as
-- 20260902000000, now applied to these three relationships.
--   - marketing_content_items already has UNIQUE (id, shop_id), added by
--     20260902000000 — reused here, no duplicate constraint created.
--   - marketing_platform_variants gets its own new UNIQUE (id, shop_id)
--     (it was only ever a CHILD before; this migration is the first
--     time anything needs it as a PARENT too).
--
-- NULLABILITY PRESERVED: all three columns stay nullable, exactly as
-- before — a NULL value in ANY column of a composite foreign key
-- (Postgres's default MATCH SIMPLE) exempts that row from the check
-- entirely, so "no content item yet" / "no platform variant yet" remains
-- completely valid, unchanged.
--
-- ON DELETE SEMANTICS PRESERVED, PRECISELY: the original single-column
-- FKs were all `on delete set null`. A naive composite
-- `on delete set null` would try to null EVERY column in the FK,
-- including shop_id — which is `not null` on both child tables and must
-- NEVER be nulled (it is the tenant-scoping column, not a nullable
-- relationship). Postgres 16 supports column-scoped
-- `on delete set null (<column>)`, used here so ONLY the child's own
-- reference column is ever nulled when its parent is deleted — shop_id
-- is never touched, matching the original behavior exactly (verified
-- live against a real Postgres 16 instance before writing this file).
--
-- FAILS LOUDLY, NEVER SILENTLY REWRITES: three separate preflight DO
-- blocks (one per relationship) count any pre-existing row whose
-- shop_id doesn't match its referenced parent's shop_id and RAISE
-- EXCEPTION naming the table, the relationship, and the exact violating
-- count BEFORE any constraint is touched. No UPDATE, no DELETE, no
-- reassignment anywhere in this file. client.query() sends this whole
-- file as one implicit transaction (verified against the prior patch),
-- so any raised exception rolls back everything already run in this
-- same call — no partial constraint is ever left behind.
--
-- SAFETY: purely additive/surgical. No existing column dropped, renamed,
-- or reinterpreted. No data rewritten. RLS is completely untouched on
-- every table this file touches. No new table created.
--
-- NOT APPLIED to any environment by this migration file's existence —
-- same governing constraint as every other migration in this repo. Local
-- disposable-Postgres verification only (see
-- scripts/apply-marketing-rls-local.mjs and
-- tests/integration/marketing-studio-rls.test.js).

-- ── Preflight: fail loudly on any pre-existing violating row ──────────────

do $$
declare
  violating_count integer;
begin
  select count(*) into violating_count
  from public.marketing_generation_usage u
  join public.marketing_content_items c on c.id = u.content_item_id
  where c.shop_id is distinct from u.shop_id;

  if violating_count > 0 then
    raise exception
      'Refusing to add the marketing_generation_usage -> marketing_content_items composite foreign key: % existing row(s) already reference a content item belonging to a DIFFERENT shop. This migration will not silently reassign or delete these rows. STOP and report the exact violating row ids for a remediation decision before retrying. Query: select u.id, u.shop_id as usage_shop_id, c.shop_id as content_item_shop_id, u.content_item_id from public.marketing_generation_usage u join public.marketing_content_items c on c.id = u.content_item_id where c.shop_id is distinct from u.shop_id;',
      violating_count;
  end if;
end $$;

do $$
declare
  violating_count integer;
begin
  select count(*) into violating_count
  from public.marketing_clone_video_jobs j
  join public.marketing_content_items c on c.id = j.content_item_id
  where c.shop_id is distinct from j.shop_id;

  if violating_count > 0 then
    raise exception
      'Refusing to add the marketing_clone_video_jobs.content_item_id -> marketing_content_items composite foreign key: % existing row(s) already reference a content item belonging to a DIFFERENT shop. This migration will not silently reassign or delete these rows. STOP and report the exact violating row ids for a remediation decision before retrying. Query: select j.id, j.shop_id as job_shop_id, c.shop_id as content_item_shop_id, j.content_item_id from public.marketing_clone_video_jobs j join public.marketing_content_items c on c.id = j.content_item_id where c.shop_id is distinct from j.shop_id;',
      violating_count;
  end if;
end $$;

do $$
declare
  violating_count integer;
begin
  select count(*) into violating_count
  from public.marketing_clone_video_jobs j
  join public.marketing_platform_variants v on v.id = j.platform_variant_id
  where v.shop_id is distinct from j.shop_id;

  if violating_count > 0 then
    raise exception
      'Refusing to add the marketing_clone_video_jobs.platform_variant_id -> marketing_platform_variants composite foreign key: % existing row(s) already reference a platform variant belonging to a DIFFERENT shop. This migration will not silently reassign or delete these rows. STOP and report the exact violating row ids for a remediation decision before retrying. Query: select j.id, j.shop_id as job_shop_id, v.shop_id as variant_shop_id, j.platform_variant_id from public.marketing_clone_video_jobs j join public.marketing_platform_variants v on v.id = j.platform_variant_id where v.shop_id is distinct from j.shop_id;',
      violating_count;
  end if;
end $$;

-- ── Parent-side composite uniqueness ───────────────────────────────────
-- marketing_content_items already has this (added by 20260902000000) —
-- not repeated here. marketing_platform_variants needs its own for the
-- first time (it was only ever a child relationship before this file).
-- Always safe to add regardless of existing data: id is already the
-- primary key (globally unique on its own), so (id, shop_id) is
-- trivially unique too.
alter table public.marketing_platform_variants
  drop constraint if exists marketing_platform_variants_id_shop_id_key;
alter table public.marketing_platform_variants
  add constraint marketing_platform_variants_id_shop_id_key
  unique (id, shop_id);

-- ── marketing_generation_usage.content_item_id ─────────────────────────
alter table public.marketing_generation_usage
  drop constraint if exists marketing_generation_usage_content_item_id_fkey;
alter table public.marketing_generation_usage
  add constraint marketing_generation_usage_content_item_shop_fkey
  foreign key (content_item_id, shop_id)
  references public.marketing_content_items (id, shop_id)
  on delete set null (content_item_id);

comment on constraint marketing_generation_usage_content_item_shop_fkey
  on public.marketing_generation_usage is
  'Final tenant-integrity patch: guarantees at the database level that a usage row''s content_item_id, when set, always belongs to a marketing_content_items row with the SAME shop_id as the usage row itself. content_item_id stays nullable (a usage row with no linked content item is still valid) and ON DELETE still only nulls content_item_id, never shop_id.';

-- ── marketing_clone_video_jobs.content_item_id ─────────────────────────
alter table public.marketing_clone_video_jobs
  drop constraint if exists marketing_clone_video_jobs_content_item_id_fkey;
alter table public.marketing_clone_video_jobs
  add constraint marketing_clone_video_jobs_content_item_shop_fkey
  foreign key (content_item_id, shop_id)
  references public.marketing_content_items (id, shop_id)
  on delete set null (content_item_id);

comment on constraint marketing_clone_video_jobs_content_item_shop_fkey
  on public.marketing_clone_video_jobs is
  'Final tenant-integrity patch: guarantees at the database level that a clone-video job''s content_item_id, when set, always belongs to a marketing_content_items row with the SAME shop_id as the job itself. Stays nullable; ON DELETE still only nulls content_item_id, never shop_id.';

-- ── marketing_clone_video_jobs.platform_variant_id ─────────────────────
alter table public.marketing_clone_video_jobs
  drop constraint if exists marketing_clone_video_jobs_platform_variant_id_fkey;
alter table public.marketing_clone_video_jobs
  add constraint marketing_clone_video_jobs_platform_variant_shop_fkey
  foreign key (platform_variant_id, shop_id)
  references public.marketing_platform_variants (id, shop_id)
  on delete set null (platform_variant_id);

comment on constraint marketing_clone_video_jobs_platform_variant_shop_fkey
  on public.marketing_clone_video_jobs is
  'Final tenant-integrity patch: guarantees at the database level that a clone-video job''s platform_variant_id, when set, always belongs to a marketing_platform_variants row with the SAME shop_id as the job itself. Stays nullable; ON DELETE still only nulls platform_variant_id, never shop_id.';
