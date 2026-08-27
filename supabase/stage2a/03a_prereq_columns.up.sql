-- Stage 2A / M-2A-02a (forward) — identity linkage + explicit permission column
-- Transactional.
BEGIN;
-- Link an employee (staff) record to a login user. Nullable => fail-closed until linked.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- Explicit, separate authorization to view ALL staff time entries (owner-independent).
ALTER TABLE public.shop_members
  ADD COLUMN IF NOT EXISTS can_view_all_timesheets boolean NOT NULL DEFAULT false;
COMMIT;
