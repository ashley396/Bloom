-- Launch hardening: enforce active membership in tenant RLS and keep private
-- employee records accessible only to active owners/managers.

alter table public.shop_members
  add column if not exists status text;

update public.shop_members
set status = 'active'
where status is null;

alter table public.shop_members
  alter column status set default 'active',
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shop_members'::regclass
      and conname = 'shop_members_status_check'
  ) then
    alter table public.shop_members
      add constraint shop_members_status_check
      check (status in ('invited', 'active', 'suspended')) not valid;
  end if;
end
$$;

alter table public.shop_members
  validate constraint shop_members_status_check;

create or replace function public.is_shop_member(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.shop_members
      where shop_id = target_shop
        and user_id = auth.uid()
        and status = 'active'
    );
$$;

revoke all on function public.is_shop_member(uuid) from public;
revoke all on function public.is_shop_member(uuid) from anon;
grant execute on function public.is_shop_member(uuid) to authenticated;
grant execute on function public.is_shop_member(uuid) to service_role;

create or replace function public.is_shop_staff_manager(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.shop_members
      where shop_id = target_shop
        and user_id = auth.uid()
        and status = 'active'
        and role in ('owner', 'manager')
    );
$$;

revoke all on function public.is_shop_staff_manager(uuid) from public;
revoke all on function public.is_shop_staff_manager(uuid) from anon;
grant execute on function public.is_shop_staff_manager(uuid) to authenticated;
grant execute on function public.is_shop_staff_manager(uuid) to service_role;

drop policy if exists "staff shop access" on public.staff;
drop policy if exists "staff owner manager access" on public.staff;
create policy "staff owner manager access" on public.staff
  for all
  to authenticated
  using (public.is_shop_staff_manager(shop_id))
  with check (public.is_shop_staff_manager(shop_id));

drop policy if exists "staff time entries shop access" on public.staff_time_entries;
drop policy if exists "staff time entries owner manager access" on public.staff_time_entries;
create policy "staff time entries owner manager access" on public.staff_time_entries
  for all
  to authenticated
  using (public.is_shop_staff_manager(shop_id))
  with check (public.is_shop_staff_manager(shop_id));
