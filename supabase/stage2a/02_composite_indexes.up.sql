-- Stage 2A / M-2A-03 (forward)
-- Composite indexes for the common shop-scoped list/sort queries.
-- CONCURRENTLY: MUST run OUTSIDE a transaction block (run each statement individually).
-- NOTE: the existing deliveries(shop_id) indexes are intentionally RETAINED per founder
--       directive until future query-plan validation proves redundancy.
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_shop_created_idx
  ON public.orders (shop_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS expenses_shop_date_idx
  ON public.expenses (shop_id, expense_date DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS deliveries_shop_created_idx
  ON public.deliveries (shop_id, created_at DESC);
