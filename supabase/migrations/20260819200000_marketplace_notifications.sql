-- Florisyn Wholesale Marketplace: real notifications.
--
-- The vision doc's NOTIFICATIONS section calls out exactly two events
-- this migration wires up for real: "a saved flower is back in stock"
-- and "a supplier updated an order". Both are genuine, trigger-driven
-- events with real data behind them — no fabricated reminders, no
-- cron-based guesses. Same shape and RLS pattern as
-- florist_community_notifications (20260819160000): select-own,
-- mark-read-own, and no INSERT policy — a notification is always about
-- someone else's action, so it's written server-side via the
-- service-role client, never by the acting user's own RLS-scoped client.
create table if not exists public.marketplace_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('order_status_changed', 'back_in_stock')),
  listing_id uuid references public.marketplace_listings(id) on delete cascade,
  order_id uuid references public.marketplace_wholesale_orders(id) on delete cascade,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_notifications_recipient_idx
  on public.marketplace_notifications (recipient_user_id, created_at desc);

alter table public.marketplace_notifications enable row level security;

drop policy if exists "marketplace notifications select own" on public.marketplace_notifications;
create policy "marketplace notifications select own" on public.marketplace_notifications
  for select using (recipient_user_id = auth.uid());

drop policy if exists "marketplace notifications mark read" on public.marketplace_notifications;
create policy "marketplace notifications mark read" on public.marketplace_notifications
  for update using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());

notify pgrst, 'reload schema';
