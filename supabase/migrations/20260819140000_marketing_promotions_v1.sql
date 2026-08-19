-- Marketing Promotions (additive). Feature-flagged in Netlify (default ON).
-- Shop-scoped RLS via is_shop_member, same pattern as marketing_campaigns_v1.
--
-- This is a promotion DEFINITION and activation-safety layer, not a
-- checkout-time coupon-code redemption engine — Florisyn's storefront
-- checkout already accepts a raw numeric discount (bloom-storefront-
-- commerce.js), and building real code-lookup/redemption/stacking rules
-- against live checkout is separate, higher-risk work. This table lets a
-- florist define and review a promotion (type, value, dates, which real
-- products it covers) before marking it active, matching the required
-- safety preview — without inventing a second, competing discount engine.

create table if not exists public.marketing_promotions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  name text not null,
  promo_type text not null
    check (promo_type in ('percentage_off', 'dollar_off', 'free_delivery', 'minimum_purchase')),
  value numeric(12,2) not null default 0 check (value >= 0),
  description text,
  starts_on date,
  ends_on date,
  product_ids uuid[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'active', 'ended')),
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_promotions_date_range check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint marketing_promotions_percentage_range check (promo_type != 'percentage_off' or value <= 100)
);

create index if not exists marketing_promotions_shop_updated_idx
  on public.marketing_promotions (shop_id, updated_at desc);

alter table public.marketing_promotions enable row level security;

drop policy if exists "marketing promotions shop access" on public.marketing_promotions;
create policy "marketing promotions shop access"
  on public.marketing_promotions
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_promotions from anon;
grant select, insert, update, delete on table public.marketing_promotions to authenticated;
grant all on table public.marketing_promotions to service_role;
