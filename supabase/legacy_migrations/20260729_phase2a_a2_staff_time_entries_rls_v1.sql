-- Phase 2A Bundle A2 — tenant RLS for staff time clock (review before apply).
-- Safe on repeat: enables RLS + shop-scoped policy using existing is_shop_member().

alter table public.staff_time_entries enable row level security;

drop policy if exists "staff time entries shop access" on public.staff_time_entries;
create policy "staff time entries shop access" on public.staff_time_entries
  for all
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
