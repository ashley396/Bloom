-- Stage 2A / M-2A-01 (rollback)
-- CONCURRENTLY: MUST run OUTSIDE a transaction block.
DROP INDEX CONCURRENTLY IF EXISTS public.shop_members_user_id_status_idx;
