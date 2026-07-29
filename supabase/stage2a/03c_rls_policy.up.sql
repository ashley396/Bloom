-- Stage 2A / M-2A-02c (forward) — authorization function + RLS + policy
-- Transactional. Read-only policy (writes remain via service role until Stage 2B).
BEGIN;
CREATE OR REPLACE FUNCTION public.can_read_time_entry(target_shop_id uuid, target_staff_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.user_is_shop_owner(target_shop_id)                        -- owner: all shop entries
    OR EXISTS (                                                      -- explicitly authorized (e.g., manager granted)
      SELECT 1 FROM public.shop_members
      WHERE shop_id = target_shop_id AND user_id = auth.uid()
        AND status = 'active' AND can_view_all_timesheets = true
    )
    OR EXISTS (                                                      -- employee: only their own linked entries
      SELECT 1 FROM public.staff
      WHERE id = target_staff_id AND shop_id = target_shop_id
        AND user_id = auth.uid()
    );
$$;
REVOKE ALL ON FUNCTION public.can_read_time_entry(uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_read_time_entry(uuid,uuid) TO authenticated, service_role;

ALTER TABLE public.staff_time_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.staff_time_entries TO authenticated;

DROP POLICY IF EXISTS "read own or authorized staff time entries" ON public.staff_time_entries;
CREATE POLICY "read own or authorized staff time entries"
  ON public.staff_time_entries
  FOR SELECT
  USING (public.can_read_time_entry(shop_id, staff_id));
COMMIT;
