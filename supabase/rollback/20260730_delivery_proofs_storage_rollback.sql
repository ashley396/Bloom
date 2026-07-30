-- =============================================================================
-- ROLLBACK — delivery-proofs storage bucket (Daily Loop v3)
-- =============================================================================
-- ⚠️  DO NOT RUN IN PRODUCTION WITHOUT EXPLICIT OWNER APPROVAL
--
-- Removes RLS policies and the delivery-proofs bucket definition.
-- Does NOT delete uploaded object files automatically — remove objects first
-- if you need a clean rollback (see post-rollback steps in STACKED_RELEASE_ROLLBACK.md).
--
-- Application rollback: redeploy pre-v3 Netlify build OR disable proof capture UI.
-- =============================================================================

begin;

drop policy if exists "delivery proofs shop member select" on storage.objects;
drop policy if exists "delivery proofs shop member insert" on storage.objects;
drop policy if exists "delivery proofs shop member update" on storage.objects;
drop policy if exists "delivery proofs shop member delete" on storage.objects;
drop policy if exists "delivery proofs service role" on storage.objects;

-- Empty bucket before delete (Supabase may block delete if objects remain)
delete from storage.objects where bucket_id = 'delivery-proofs';

delete from storage.buckets where id = 'delivery-proofs';

commit;

notify pgrst, 'reload schema';
