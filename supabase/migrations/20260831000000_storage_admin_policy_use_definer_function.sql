-- Fix: "platform library media admin write" (20260816180000_platform_library_
-- photo_manager.sql) checks platform-admin status with a RAW inline
-- `exists (select 1 from public.platform_admins pa where ...)` instead of the
-- established public.is_platform_admin_user() SECURITY DEFINER helper every
-- other admin-check policy/function in this codebase uses. That raw subquery
-- is the ACTUAL root cause of the real, live "permission denied for table
-- platform_admins" failure an ordinary authenticated florist (Ashley) hit on
-- Marketing Studio's generate_content — NOT the platform_admin_audit path
-- fixed in the prior pass (that fix was real and still correct, just not
-- this bug).
--
-- Mechanism: this policy is `for all to authenticated` on storage.objects —
-- a PERMISSIVE policy that Postgres must be able to plan/evaluate for EVERY
-- authenticated-role operation against storage.objects, regardless of which
-- bucket_id the operation actually targets, because RLS policies attached to
-- a table are combined (OR'd) at the query-planning level, not filtered out
-- per-row before evaluation. Evaluating this policy's `exists(select 1 from
-- platform_admins ...)` clause requires the `authenticated` role to have
-- real SELECT privilege on platform_admins — which it deliberately does not
-- have (platform_admins is service-role-only by design). So ANY authenticated
-- upload to ANY bucket (e.g. Marketing Studio's generateImage ->
-- uploadWebsiteMedia() -> client.storage.from("website-media").upload(...),
-- confirmed live via Supabase Postgres logs: a Storage API pre-existence
-- check "SELECT id FROM storage.objects WHERE name=$1 AND bucket_id=$2"
-- failed with sql_state 42501 and hint "GRANT SELECT ON public.platform_admins
-- TO authenticated" — a grant we correctly refuse to make) fails, even
-- though the object being uploaded has nothing to do with the
-- platform-library-media bucket this policy actually protects.
--
-- Fix: swap the raw subquery for public.is_platform_admin_user() — already
-- defined `security definer` and already GRANTed EXECUTE to `authenticated`
-- (see greenfield baseline). A security-definer function runs with its
-- owner's privileges, so evaluating it never requires the calling role to
-- hold its own privilege on platform_admins — exactly the pattern every
-- other admin-check RLS policy/function in this schema already follows
-- (is_platform_admin_user() itself is used directly in several other RLS
-- policies in the greenfield baseline). Same boolean result, same
-- authorization behavior (must be an ACTIVE platform_admins row) — this is
-- purely a privilege-evaluation fix, not a security change:
--   * platform_admins itself remains completely inaccessible to
--     `authenticated` — no GRANT was added.
--   * The platform-library-media bucket remains exactly as admin-only as
--     before: only a real active platform admin's is_platform_admin_user()
--     call returns true.
--   * Every other bucket's own policies are untouched.

drop policy if exists "platform library media admin write" on storage.objects;
create policy "platform library media admin write"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'platform-library-media'
  and public.is_platform_admin_user()
)
with check (
  bucket_id = 'platform-library-media'
  and public.is_platform_admin_user()
);

notify pgrst, 'reload schema';
