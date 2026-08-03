-- Greenfield bridge — align shop_members.status allowlist with Community R1 expectations.
-- Foundation v1 creates status check (invited, active, suspended) without 'removed'.
-- Community R1 requires exactly (active, invited, suspended, removed) and aborts otherwise.
-- Safe to re-run. Apply after foundation (and before Community R1).

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'shop_members'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.shop_members drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from public.shop_members
    where status not in ('active', 'invited', 'suspended', 'removed')
  ) then
    alter table public.shop_members
      add constraint shop_members_status_check
      check (status in ('active', 'invited', 'suspended', 'removed'));
  else
    raise exception
      'greenfield-shop-members-status-align aborted: incompatible shop_members.status values present';
  end if;
end $$;
