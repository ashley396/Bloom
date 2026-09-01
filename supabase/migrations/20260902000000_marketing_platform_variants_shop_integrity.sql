-- Post-Batch-6 security blocker patch: cross-shop parent/child integrity
-- for marketing_platform_variants -> marketing_content_items ONLY. This
-- migration closes exactly this one relationship — it does NOT close
-- every instance of this class of gap in the schema (see "OTHER TABLES
-- WITH THE SAME SHAPE OF GAP" below, discovered while tracing this exact
-- relationship and explicitly reported rather than fixed here, per
-- instruction: "do not broaden the patch without approval").
--
-- PROVEN DEFECT (tests/integration/marketing-studio-rls.test.js,
-- "INVESTIGATION" test added in Batch 6, Part I): the real, shipped RLS
-- policy on marketing_platform_variants only validates
-- is_shop_member(shop_id) on the VARIANT's own shop_id column. Nothing in
-- the schema or RLS cross-checks that content_item_id actually belongs to
-- a marketing_content_items row with the SAME shop_id. A shop member can
-- currently insert a variant with their own legitimate shop_id (passes
-- RLS trivially) while content_item_id references another shop's content
-- item. Row-level shop_id policy alone is not sufficient to guarantee
-- parent/child tenant integrity — that requires a real database-level
-- constraint, which this migration adds for this one relationship.
--
-- OTHER TABLES WITH THE SAME SHAPE OF GAP (found while tracing this exact
-- relationship; NOT fixed by this migration — reported only):
--   - marketing_generation_usage.content_item_id (nullable FK to
--     marketing_content_items(id), no composite check against shop_id).
--   - marketing_clone_video_jobs.content_item_id and
--     .platform_variant_id (nullable FKs to marketing_content_items(id)
--     and marketing_platform_variants(id) respectively, same gap).
-- Both are real, unpatched instances of the identical class of defect.
--
-- FIX: a composite parent-child foreign key, the standard Postgres
-- pattern for this exact class of defect.
--   1. marketing_content_items gets a UNIQUE (id, shop_id) constraint.
--      Always safe to add regardless of existing data: id is already the
--      primary key (globally unique on its own), so (id, shop_id) is
--      trivially unique too — this can never fail due to existing rows.
--   2. marketing_platform_variants.content_item_id's existing single-
--      column foreign key to marketing_content_items(id) is REPLACED by
--      a composite FOREIGN KEY (content_item_id, shop_id) REFERENCES
--      marketing_content_items(id, shop_id) — the database itself now
--      rejects any row whose content_item_id and shop_id don't both
--      belong to the same real content item. Cross-shop reassignment
--      (an UPDATE that only changes shop_id or only changes
--      content_item_id such that they stop matching) is rejected the
--      same way an INSERT is.
--
-- SAFETY: purely additive. No existing column is dropped, renamed, or
-- reinterpreted; no data is rewritten. Preserves every existing valid
-- row exactly as-is. RLS is completely untouched (neither policy on
-- either table is touched by this file) — this is a database-level
-- integrity guarantee layered UNDER the existing RLS, not a replacement
-- for it.
--
-- FAILS LOUDLY, NEVER SILENTLY REWRITES: the DO block below explicitly
-- counts any already-existing marketing_platform_variants row whose
-- content_item_id points at a DIFFERENT shop's content item, and RAISES
-- EXCEPTION naming the exact count before ever attempting to add the
-- constraint, if any exist — this migration refuses to apply rather than
-- silently reassigning or deleting a real row. (Postgres's own
-- ADD CONSTRAINT ... FOREIGN KEY validation would also refuse in this
-- case, but only reports one offending row at a time with a generic
-- message; this gives the exact count up front instead.) If this
-- migration ever fails this way against a real environment: STOP, do not
-- retry, do not rewrite the rows — report the exact count and the
-- violating row ids to Ashley for a remediation decision.
--
-- NOT APPLIED to any environment by this migration file's existence —
-- same governing constraint as every other migration in this pass. Local
-- disposable-Postgres verification only (see
-- scripts/apply-marketing-rls-local.mjs and
-- tests/integration/marketing-studio-rls.test.js).

do $$
declare
  violating_count integer;
begin
  select count(*) into violating_count
  from public.marketing_platform_variants v
  join public.marketing_content_items c on c.id = v.content_item_id
  where c.shop_id is distinct from v.shop_id;

  if violating_count > 0 then
    raise exception
      'Refusing to add the marketing_platform_variants -> marketing_content_items composite foreign key: % existing row(s) already reference a content item belonging to a DIFFERENT shop. This migration will not silently reassign or delete these rows. STOP and report the exact violating row ids for a remediation decision before retrying. Query: select v.id, v.shop_id as variant_shop_id, c.shop_id as content_item_shop_id, v.content_item_id from public.marketing_platform_variants v join public.marketing_content_items c on c.id = v.content_item_id where c.shop_id is distinct from v.shop_id;',
      violating_count;
  end if;
end $$;

-- 1. Parent-side composite unique constraint — id alone is already the
-- primary key, so this can never fail on existing data.
alter table public.marketing_content_items
  drop constraint if exists marketing_content_items_id_shop_id_key;
alter table public.marketing_content_items
  add constraint marketing_content_items_id_shop_id_key
  unique (id, shop_id);

-- 2. Child-side composite foreign key, replacing the single-column one.
-- Preserves the exact same ON DELETE CASCADE behavior the original
-- single-column FK already had (deleting a content item still deletes
-- its variants) — only the referenced key changes, from (id) to
-- (id, shop_id).
alter table public.marketing_platform_variants
  drop constraint if exists marketing_platform_variants_content_item_id_fkey;
alter table public.marketing_platform_variants
  add constraint marketing_platform_variants_content_item_shop_fkey
  foreign key (content_item_id, shop_id)
  references public.marketing_content_items (id, shop_id)
  on delete cascade;

comment on constraint marketing_platform_variants_content_item_shop_fkey
  on public.marketing_platform_variants is
  'Post-Batch-6 security patch: guarantees at the database level that a variant''s content_item_id always belongs to a marketing_content_items row with the SAME shop_id as the variant itself — closes this ONE cross-shop parent/child relationship RLS alone could not catch (RLS only ever validated the variant''s own shop_id column, never the parent it points at). marketing_generation_usage.content_item_id and marketing_clone_video_jobs.content_item_id/.platform_variant_id have the identical unpatched gap — reported, not fixed here.';
