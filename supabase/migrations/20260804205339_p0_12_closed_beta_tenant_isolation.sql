-- P0-12: deterministic grants and tenant isolation for the closed-beta scope.
--
-- This is a forward-only source migration. It is not a production migration
-- package and must not be applied to a hosted project without the release gate.

-- Every browser-reachable release table is RLS protected, even when an older
-- project was created with different Data API defaults.
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.inventory enable row level security;
alter table public.expenses enable row level security;
alter table public.products enable row level security;
alter table public.product_recipes enable row level security;
alter table public.deliveries enable row level security;
alter table public.suppliers enable row level security;
alter table public.payments enable row level security;
alter table public.order_status_history enable row level security;
alter table public.audit_events enable row level security;
alter table public.staff enable row level security;
alter table public.staff_time_entries enable row level security;

-- Some Supabase projects contain a platform-installed DDL event-trigger helper
-- in public. Event triggers do not need Data API execution rights. Reconcile it
-- conditionally so greenfield projects without the helper remain compatible.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all privileges on function public.rls_auto_enable()
      from public, anon, authenticated, service_role;
  end if;
end
$$;

-- Core tables were enabled for RLS in the greenfield baseline but had no
-- policies. Install explicit active-member policies. Order INSERT remains RPC
-- only so create_order_atomic is the single authenticated creation boundary.
drop policy if exists "customers active shop access" on public.customers;
create policy "customers active shop access"
on public.customers for all to authenticated
using (public.is_shop_member(shop_id))
with check (public.is_shop_member(shop_id));

drop policy if exists "orders active shop select" on public.orders;
create policy "orders active shop select"
on public.orders for select to authenticated
using (public.is_shop_member(shop_id));

drop policy if exists "orders active shop update" on public.orders;
create policy "orders active shop update"
on public.orders for update to authenticated
using (public.is_shop_member(shop_id))
with check (public.is_shop_member(shop_id));

drop policy if exists "orders active shop delete" on public.orders;
create policy "orders active shop delete"
on public.orders for delete to authenticated
using (public.is_shop_member(shop_id));

drop policy if exists "inventory active shop access" on public.inventory;
create policy "inventory active shop access"
on public.inventory for all to authenticated
using (public.is_shop_member(shop_id))
with check (public.is_shop_member(shop_id));

drop policy if exists "expenses active shop access" on public.expenses;
create policy "expenses active shop access"
on public.expenses for all to authenticated
using (public.is_shop_member(shop_id))
with check (public.is_shop_member(shop_id));

-- Staff records include PIN hashes and payroll fields. They are intentionally
-- not exposed to authenticated Data API callers. The verified owner/manager
-- Netlify route uses the server client and always scopes operations by shop_id.
drop policy if exists "staff shop access" on public.staff;
drop policy if exists "staff time entries shop access" on public.staff_time_entries;

-- Make Data API exposure deterministic. Anonymous clients receive no direct
-- table access to any private closed-beta relation.
revoke all privileges on table
  public.customers,
  public.orders,
  public.inventory,
  public.expenses,
  public.products,
  public.product_recipes,
  public.deliveries,
  public.suppliers,
  public.payments,
  public.order_status_history,
  public.audit_events,
  public.staff,
  public.staff_time_entries,
  public.shops,
  public.shop_members,
  public.profiles,
  public.shop_subscriptions,
  public.ai_shop_profiles,
  public.shop_hours
from anon;

-- Reconcile authenticated privileges to the minimum required by the current
-- user-scoped Netlify functions. RLS remains the row authorization boundary.
revoke all privileges on table
  public.customers,
  public.orders,
  public.inventory,
  public.expenses,
  public.products,
  public.product_recipes,
  public.deliveries,
  public.suppliers,
  public.payments,
  public.order_status_history,
  public.audit_events,
  public.staff,
  public.staff_time_entries,
  public.shops,
  public.shop_members,
  public.profiles,
  public.shop_subscriptions,
  public.ai_shop_profiles,
  public.shop_hours
from authenticated;

grant select, insert, update, delete on table public.customers to authenticated;
grant select, update, delete on table public.orders to authenticated;
grant select, insert, update, delete on table public.inventory to authenticated;
grant select, insert, update, delete on table public.expenses to authenticated;
grant select, insert, update, delete on table public.products to authenticated;
grant select, insert, update, delete on table public.product_recipes to authenticated;
grant select, insert, update, delete on table public.deliveries to authenticated;
grant select, insert, update, delete on table public.suppliers to authenticated;
grant select on table public.payments to authenticated;
grant select, insert, update, delete on table public.order_status_history to authenticated;
grant select, insert on table public.audit_events to authenticated;
grant select, update on table public.shops to authenticated;
grant select, insert, update, delete on table public.shop_members to authenticated;
grant select, update on table public.profiles to authenticated;
grant select on table public.shop_subscriptions to authenticated;
grant select, update on table public.ai_shop_profiles to authenticated;
grant select, insert, update, delete on table public.shop_hours to authenticated;

-- Defense-in-depth: the atomic order RPC must remain the only authenticated
-- INSERT route even if this migration is replayed after other grant changes.
revoke insert on table public.orders from authenticated;

notify pgrst, 'reload schema';
