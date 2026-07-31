-- Stage 2A / M-2A-02c (rollback)
-- Transactional. Reverts to the prior (RLS-disabled) state — emergency use only.
BEGIN;
DROP POLICY IF EXISTS "read own or authorized staff time entries" ON public.staff_time_entries;
ALTER TABLE public.staff_time_entries DISABLE ROW LEVEL SECURITY;
DROP FUNCTION IF EXISTS public.can_read_time_entry(uuid,uuid);
COMMIT;
