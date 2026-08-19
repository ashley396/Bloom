-- Marketing Campaigns (additive). Feature-flagged in Netlify (default ON).
-- Shop-scoped RLS via is_shop_member, same pattern as holiday_weddings_email_v1.
--
-- A campaign is the connective layer Marketing was missing: Email
-- Campaigns, Holiday peaks, and (later) social/text/promotion content each
-- attach to one campaign_id instead of living as disconnected tools with
-- no shared plan, dates, audience, or status.

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  goal text,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'scheduled', 'active', 'completed', 'paused')),
  starts_on date,
  ends_on date,
  audience_note text,
  product_ids uuid[] not null default '{}',
  promotion jsonb,
  channels text[] not null default '{}',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_campaigns_date_range check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index if not exists marketing_campaigns_shop_updated_idx
  on public.marketing_campaigns (shop_id, updated_at desc);

alter table public.marketing_campaigns enable row level security;

drop policy if exists "marketing campaigns shop access" on public.marketing_campaigns;
create policy "marketing campaigns shop access"
  on public.marketing_campaigns
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_campaigns from anon;
grant select, insert, update, delete on table public.marketing_campaigns to authenticated;
grant all on table public.marketing_campaigns to service_role;

-- Let existing Email Campaigns and Holiday peaks optionally attach to a
-- campaign without breaking anything that already exists standalone
-- (nullable, ON DELETE SET NULL — deleting a campaign never deletes the
-- content that was drafted under it).
alter table public.email_campaigns
  add column if not exists campaign_id uuid references public.marketing_campaigns(id) on delete set null;

alter table public.holiday_peaks
  add column if not exists campaign_id uuid references public.marketing_campaigns(id) on delete set null;

create index if not exists email_campaigns_campaign_idx
  on public.email_campaigns (campaign_id) where campaign_id is not null;

create index if not exists holiday_peaks_campaign_idx
  on public.holiday_peaks (campaign_id) where campaign_id is not null;
