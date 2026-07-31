-- Stage 2A / M-2A-02b (forward) — supporting indexes
-- CONCURRENTLY: MUST run OUTSIDE a transaction block (run each statement individually).
CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_user_id_idx
  ON public.staff (user_id) WHERE user_id IS NOT NULL;
-- A login user maps to at most one staff record per shop.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS staff_shop_user_unique
  ON public.staff (shop_id, user_id) WHERE user_id IS NOT NULL;
-- Supports staff_time_entries lookups by shop + employee.
CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_time_entries_shop_staff_idx
  ON public.staff_time_entries (shop_id, staff_id, clock_in DESC);
