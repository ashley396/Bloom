-- Florisyn Foundation v1 — daily operating loop (additive, non-destructive)
-- Apply after existing RC migrations. Safe to re-run (IF NOT EXISTS / guarded alters).

-- ---------------------------------------------------------------------------
-- Order statuses — expand without breaking legacy values
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status in (
    'NEW', 'PENDING', 'CONFIRMED',
    'DESIGNING', 'READY', 'PICKUP_READY',
    'OUT_FOR_DELIVERY', 'DELIVERED',
    'COMPLETED', 'ON_HOLD', 'ISSUE', 'CANCELLED'
  )
);

comment on column public.orders.status is
  'Florist workflow status. Legacy NEW maps to PENDING in UI.';

-- ---------------------------------------------------------------------------
-- Order status history (timestamped, auditable)
-- ---------------------------------------------------------------------------
create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists order_status_history_order_idx
  on public.order_status_history (shop_id, order_id, created_at desc);

alter table public.order_status_history enable row level security;

drop policy if exists "order_status_history shop members" on public.order_status_history;
create policy "order_status_history shop members" on public.order_status_history
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- ---------------------------------------------------------------------------
-- Delivery proof-of-delivery fields
-- ---------------------------------------------------------------------------
alter table public.deliveries add column if not exists proof_photo_url text;
alter table public.deliveries add column if not exists signature_name text;
alter table public.deliveries add column if not exists proof_captured_at timestamptz;
alter table public.deliveries add column if not exists round_trip_origin text;
alter table public.deliveries add column if not exists round_trip_returned_at timestamptz;

comment on column public.deliveries.round_trip_origin is
  'Shop address used as round-trip start/end for mileage calculation.';

-- ---------------------------------------------------------------------------
-- Customer soft-delete + contact preferences (if columns missing)
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists deleted_at timestamptz;
alter table public.customers add column if not exists contact_preferences jsonb default '{}'::jsonb;
alter table public.customers add column if not exists is_house_account boolean default false;

-- ---------------------------------------------------------------------------
-- Inventory freshness / use-first (optional, non-breaking)
-- ---------------------------------------------------------------------------
alter table public.inventory add column if not exists received_at date;
alter table public.inventory add column if not exists use_by date;
alter table public.inventory add column if not exists color text;
alter table public.inventory add column if not exists markup_multiplier numeric(6,2) default 3.0;
alter table public.inventory add column if not exists item_kind text default 'flower';

comment on column public.inventory.markup_multiplier is
  'Default markup (e.g. 3.0 = 3× wholesale). Editable per item.';

-- ---------------------------------------------------------------------------
-- Shop-scoped audit events (if not already present from RC migrations)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_shop_idx
  on public.audit_events (shop_id, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists "audit_events shop members read" on public.audit_events;
create policy "audit_events shop members read" on public.audit_events
  for select using (public.is_shop_member(shop_id));

drop policy if exists "audit_events shop members insert" on public.audit_events;
create policy "audit_events shop members insert" on public.audit_events
  for insert with check (public.is_shop_member(shop_id));
