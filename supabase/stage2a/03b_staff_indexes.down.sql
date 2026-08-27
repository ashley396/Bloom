-- Stage 2A / M-2A-02b (rollback)
-- CONCURRENTLY: MUST run OUTSIDE a transaction block.
DROP INDEX CONCURRENTLY IF EXISTS public.staff_time_entries_shop_staff_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.staff_shop_user_unique;
DROP INDEX CONCURRENTLY IF EXISTS public.staff_user_id_idx;
