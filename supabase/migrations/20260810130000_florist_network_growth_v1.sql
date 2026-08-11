-- Florist Network v1 — florist-to-florist wire orders + network profiles
-- Referral codes stored on shops metadata via platform_settings shop_referrals json is alternative;
-- we use dedicated tables for wire orders.

create table if not exists public.florist_network_profiles (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  display_name text not null,
  public_slug text unique,
  city text,
  state text,
  accepts_incoming_wires boolean not null default true,
  sends_outgoing_wires boolean not null default true,
  service_zips text[] default '{}',
  wire_fee_percent numeric(5,2) not null default 20,
  wire_fee_flat numeric(12,2) not null default 0,
  bio text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.florist_wire_orders (
  id uuid primary key default gen_random_uuid(),
  wire_number text not null unique,
  sending_shop_id uuid not null references public.shops(id) on delete cascade,
  fulfilling_shop_id uuid not null references public.shops(id) on delete cascade,
  source_order_id uuid references public.orders(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','in_production','out_for_delivery','delivered','declined','cancelled')),
  recipient_name text not null,
  recipient_phone text,
  delivery_address text not null,
  delivery_date date not null,
  delivery_time_window text,
  card_message text,
  arrangement_notes text,
  product_description text not null,
  wire_amount numeric(12,2) not null default 0,
  customer_total numeric(12,2),
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_referral_codes (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  code text not null unique,
  referred_count integer not null default 0,
  rewards_earned_months integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_referral_attributions (
  id uuid primary key default gen_random_uuid(),
  referral_code text not null,
  referrer_shop_id uuid references public.shops(id) on delete set null,
  referred_shop_id uuid not null references public.shops(id) on delete cascade,
  status text not null default 'trial'
    check (status in ('trial','converted','rewarded')),
  created_at timestamptz not null default now(),
  converted_at timestamptz,
  unique (referred_shop_id)
);

create table if not exists public.shop_peak_readiness (
  shop_id uuid not null references public.shops(id) on delete cascade,
  checklist_id text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  primary key (shop_id, checklist_id)
);

create index if not exists idx_florist_wire_orders_sending on public.florist_wire_orders(sending_shop_id, created_at desc);
create index if not exists idx_florist_wire_orders_fulfilling on public.florist_wire_orders(fulfilling_shop_id, created_at desc);
create index if not exists idx_florist_network_profiles_active on public.florist_network_profiles(is_active) where is_active = true;

alter table public.florist_network_profiles enable row level security;
alter table public.florist_wire_orders enable row level security;
alter table public.shop_referral_codes enable row level security;
alter table public.shop_referral_attributions enable row level security;
alter table public.shop_peak_readiness enable row level security;

create policy florist_network_profiles_member on public.florist_network_profiles
  for all using (public.user_has_shop_access(shop_id))
  with check (public.user_has_shop_access(shop_id));

create policy florist_network_profiles_public_read on public.florist_network_profiles
  for select using (is_active = true);

create policy florist_wire_orders_member on public.florist_wire_orders
  for all using (
    public.user_has_shop_access(sending_shop_id) or public.user_has_shop_access(fulfilling_shop_id)
  )
  with check (
    public.user_has_shop_access(sending_shop_id) or public.user_has_shop_access(fulfilling_shop_id)
  );

create policy shop_referral_codes_member on public.shop_referral_codes
  for all using (public.user_has_shop_access(shop_id))
  with check (public.user_has_shop_access(shop_id));

create policy shop_referral_codes_public_validate on public.shop_referral_codes
  for select using (true);

create policy shop_referral_attributions_member on public.shop_referral_attributions
  for select using (
    public.user_has_shop_access(referred_shop_id)
    or public.user_has_shop_access(referrer_shop_id)
  );

create policy shop_peak_readiness_member on public.shop_peak_readiness
  for all using (public.user_has_shop_access(shop_id))
  with check (public.user_has_shop_access(shop_id));

grant select on public.florist_network_profiles to anon, authenticated;
grant all on public.florist_network_profiles to authenticated;
grant all on public.florist_wire_orders to authenticated;
grant all on public.shop_referral_codes to authenticated;
grant select on public.shop_referral_attributions to authenticated;
grant all on public.shop_peak_readiness to authenticated;
