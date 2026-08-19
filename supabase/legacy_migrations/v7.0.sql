-- BloomOS v7 integration-ready migration
alter table public.shops add column if not exists stripe_connect_account_id text;
alter table public.suppliers add column if not exists stripe_connect_account_id text;
alter table public.suppliers add column if not exists connect_status text default 'NOT_CONNECTED';
create unique index if not exists shops_stripe_connect_account_id_key on public.shops(stripe_connect_account_id) where stripe_connect_account_id is not null;
create unique index if not exists suppliers_stripe_connect_account_id_key on public.suppliers(stripe_connect_account_id) where stripe_connect_account_id is not null;

create table if not exists public.integration_events (
 id uuid primary key default gen_random_uuid(),
 shop_id uuid not null references public.shops(id) on delete cascade,
 provider text not null,
 event_type text not null,
 external_id text,
 status text default 'RECEIVED',
 payload jsonb default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.integration_events enable row level security;
drop policy if exists "integration events shop access" on public.integration_events;
create policy "integration events shop access" on public.integration_events for select using (public.is_shop_member(shop_id));
