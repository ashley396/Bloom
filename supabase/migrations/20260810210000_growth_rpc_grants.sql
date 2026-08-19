-- Ensure Community membership/admin RPCs are callable with a florist JWT.
-- Safe to re-run; fixes "Unable to verify platform admin authorization" when grants were stale.

grant execute on function public.is_active_florist() to authenticated;
grant execute on function public.is_platform_admin_user() to authenticated;

notify pgrst, 'reload schema';
