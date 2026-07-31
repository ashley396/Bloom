-- Stage 2A / M-2A-01 (forward)
-- Hot-path index for _shared/supabase.js currentUser() lookup by user_id.
-- CONCURRENTLY: MUST run OUTSIDE a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS shop_members_user_id_status_idx
  ON public.shop_members (user_id, status);
