-- Stage 2A / M-2A-02a (rollback) — DESTRUCTIVE
-- Only for full reversal BEFORE any employee linking/grants are set; dropping these
-- columns loses staff<->user links and timesheet-view grants.
BEGIN;
ALTER TABLE public.shop_members DROP COLUMN IF EXISTS can_view_all_timesheets;
ALTER TABLE public.staff DROP COLUMN IF EXISTS user_id;
COMMIT;
