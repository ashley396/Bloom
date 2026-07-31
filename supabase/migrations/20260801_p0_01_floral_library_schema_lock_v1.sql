-- P0-01 — Global schema exposure lock for Floral Library tables.
-- Forward-only. Does not rewrite prior migration history.
-- Does not depend on Community migrations or Community helper functions.
--
-- Targets:
--   public.bloom_floral_library_master
--   public.bloom_library_import_batches

-- Independent admin predicate for this lock (owned by P0-01; not a Community helper).
create or replace function public.is_active_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.active = true
  );
$$;

revoke all on function public.is_active_platform_admin() from public;
revoke all on function public.is_active_platform_admin() from anon;
grant execute on function public.is_active_platform_admin() to authenticated;
grant execute on function public.is_active_platform_admin() to service_role;

-- ---------------------------------------------------------------------------
-- bloom_floral_library_master
-- ---------------------------------------------------------------------------
alter table public.bloom_floral_library_master enable row level security;

-- Remove the prior broad SELECT policy that allowed unrestricted reads.
drop policy if exists "floral library master read" on public.bloom_floral_library_master;
drop policy if exists "floral library master select approved" on public.bloom_floral_library_master;
drop policy if exists "floral library master admin insert" on public.bloom_floral_library_master;
drop policy if exists "floral library master admin update" on public.bloom_floral_library_master;
drop policy if exists "floral library master admin delete" on public.bloom_floral_library_master;

-- Ordinary authenticated florists: approved starter/catalog records only.
-- Active platform admins may also read unapproved rows for quality review.
create policy "floral library master select approved"
  on public.bloom_floral_library_master
  for select
  to authenticated
  using (
    review_status in ('approved_starter', 'approved')
    or public.is_active_platform_admin()
  );

-- Platform administration writes via explicitly authorized platform_admins path.
create policy "floral library master admin insert"
  on public.bloom_floral_library_master
  for insert
  to authenticated
  with check (public.is_active_platform_admin());

create policy "floral library master admin update"
  on public.bloom_floral_library_master
  for update
  to authenticated
  using (public.is_active_platform_admin())
  with check (public.is_active_platform_admin());

create policy "floral library master admin delete"
  on public.bloom_floral_library_master
  for delete
  to authenticated
  using (public.is_active_platform_admin());

revoke all on table public.bloom_floral_library_master from public;
revoke all on table public.bloom_floral_library_master from anon;
revoke all on table public.bloom_floral_library_master from authenticated;
grant select, insert, update, delete on table public.bloom_floral_library_master to authenticated;
grant select, insert, update, delete on table public.bloom_floral_library_master to service_role;

-- ---------------------------------------------------------------------------
-- bloom_library_import_batches
-- Service-role / platform import processing only.
-- No anon access. No ordinary authenticated access. No open write policy.
-- ---------------------------------------------------------------------------
alter table public.bloom_library_import_batches enable row level security;

drop policy if exists "library import batches open" on public.bloom_library_import_batches;
drop policy if exists "library import batches all" on public.bloom_library_import_batches;
drop policy if exists "library import batches select" on public.bloom_library_import_batches;
drop policy if exists "library import batches write" on public.bloom_library_import_batches;

-- Intentionally no policies for anon/authenticated → default deny under RLS.
-- service_role bypasses RLS (BYPASSRLS) for authorized import processing.

revoke all on table public.bloom_library_import_batches from public;
revoke all on table public.bloom_library_import_batches from anon;
revoke all on table public.bloom_library_import_batches from authenticated;
grant select, insert, update, delete on table public.bloom_library_import_batches to service_role;
