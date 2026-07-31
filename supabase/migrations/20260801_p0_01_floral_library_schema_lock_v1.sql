-- P0-01 / R1 — Floral Library schema exposure lock (least-privilege role alignment).
-- Forward-only. Does not rewrite prior migration history beyond this lock file.
-- Does not depend on Community migrations or Community helper functions.
--
-- Targets:
--   public.bloom_floral_library_master
--   public.bloom_library_import_batches
--
-- Closed beta: only an active super_admin receives elevated master visibility.
-- Authenticated JWT clients cannot mutate master rows; service_role only.

-- Retire the obsolete P0-01 generic helper so it cannot remain callable.
drop function if exists public.is_active_platform_admin();

-- Capability-specific helper: unapproved master visibility for active super_admin only.
create or replace function public.can_read_unapproved_floral_library_master()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.platform_admins as pa
      where pa.user_id = auth.uid()
        and pa.active = true
        and lower(pa.role) = 'super_admin'
    );
$$;

revoke all on function public.can_read_unapproved_floral_library_master() from public;
revoke all on function public.can_read_unapproved_floral_library_master() from anon;
grant execute on function public.can_read_unapproved_floral_library_master() to authenticated;
grant execute on function public.can_read_unapproved_floral_library_master() to service_role;

-- ---------------------------------------------------------------------------
-- bloom_floral_library_master
-- ---------------------------------------------------------------------------
alter table public.bloom_floral_library_master enable row level security;

drop policy if exists "floral library master read" on public.bloom_floral_library_master;
drop policy if exists "floral library master select approved" on public.bloom_floral_library_master;
drop policy if exists "floral library master admin insert" on public.bloom_floral_library_master;
drop policy if exists "floral library master admin update" on public.bloom_floral_library_master;
drop policy if exists "floral library master admin delete" on public.bloom_floral_library_master;

-- Authenticated SELECT only:
--   - approved_starter / approved for ordinary users
--   - plus unapproved rows for active super_admin
create policy "floral library master select approved"
  on public.bloom_floral_library_master
  for select
  to authenticated
  using (
    review_status in ('approved_starter', 'approved')
    or public.can_read_unapproved_floral_library_master()
  );

-- No authenticated INSERT/UPDATE/DELETE policies.
-- Master mutations require a separately reviewed service-role workflow.

revoke all on table public.bloom_floral_library_master from public;
revoke all on table public.bloom_floral_library_master from anon;
revoke all on table public.bloom_floral_library_master from authenticated;
grant select on table public.bloom_floral_library_master to authenticated;
grant select, insert, update, delete on table public.bloom_floral_library_master to service_role;

-- ---------------------------------------------------------------------------
-- bloom_library_import_batches
-- Service-role / platform import processing only.
-- No PUBLIC/anon/authenticated access. Zero JWT policies.
-- ---------------------------------------------------------------------------
alter table public.bloom_library_import_batches enable row level security;

drop policy if exists "library import batches open" on public.bloom_library_import_batches;
drop policy if exists "library import batches all" on public.bloom_library_import_batches;
drop policy if exists "library import batches select" on public.bloom_library_import_batches;
drop policy if exists "library import batches write" on public.bloom_library_import_batches;

revoke all on table public.bloom_library_import_batches from public;
revoke all on table public.bloom_library_import_batches from anon;
revoke all on table public.bloom_library_import_batches from authenticated;
grant select, insert, update, delete on table public.bloom_library_import_batches to service_role;
