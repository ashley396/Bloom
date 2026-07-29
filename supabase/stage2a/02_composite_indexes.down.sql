-- Stage 2A / M-2A-03 (rollback)
-- CONCURRENTLY: MUST run OUTSIDE a transaction block.
DROP INDEX CONCURRENTLY IF EXISTS public.orders_shop_created_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.expenses_shop_date_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.deliveries_shop_created_idx;
