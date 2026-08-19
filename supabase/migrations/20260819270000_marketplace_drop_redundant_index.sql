-- One genuinely redundant index, found while investigating the
-- "unused_index" advisor category: marketplace_verification_applications
-- has both a UNIQUE constraint's own backing index
-- (marketplace_verification_applications_user_id_key, btree(user_id))
-- and a separate plain, non-unique index on the exact same single column
-- (marketplace_verification_applications_user_id_idx). The unique
-- index already serves every purpose the plain one could — same lookup
-- speed, plus the uniqueness guarantee for free — so the plain index can
-- never be chosen over it and exists purely as dead weight (extra
-- storage, extra write-time maintenance on every insert/update).
--
-- This is a genuinely safe, traffic-independent removal: it's provably
-- redundant by definition (two indexes on the identical single column,
-- one already unique) — not a judgment call based on the low-traffic
-- staging DB's usage stats. The rest of the "unused_index" advisor
-- findings (27 total: 17 are covering indexes added in the prior RLS/
-- performance-cleanup migration for real, still-valid FK-coverage
-- reasons, and 9 are pre-existing indexes whose "unused" status is an
-- artifact of low staging traffic, not evidence of genuine redundancy)
-- are deliberately NOT touched here — see the PR description.
drop index if exists public.marketplace_verification_applications_user_id_idx;

notify pgrst, 'reload schema';
