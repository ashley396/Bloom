-- Canonical greenfield shop-members status contract.
-- Community security requires the removed state in addition to the original
-- foundation states. Abort if any unexpected historical state is present.

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_definition.conname
    from pg_constraint constraint_definition
    join pg_class relation_definition
      on relation_definition.oid = constraint_definition.conrelid
    join pg_namespace schema_definition
      on schema_definition.oid = relation_definition.relnamespace
    where schema_definition.nspname = 'public'
      and relation_definition.relname = 'shop_members'
      and constraint_definition.contype = 'c'
      and pg_get_constraintdef(constraint_definition.oid) ilike '%status%'
  loop
    execute format(
      'alter table public.shop_members drop constraint %I',
      constraint_row.conname
    );
  end loop;

  if exists (
    select 1
    from public.shop_members
    where status not in ('active', 'invited', 'suspended', 'removed')
  ) then
    raise exception
      'canonical baseline aborted: incompatible shop_members.status value';
  end if;

  alter table public.shop_members
    add constraint shop_members_status_check
    check (status in ('active', 'invited', 'suspended', 'removed'));
end $$;
