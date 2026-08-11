-- Holiday Command Center, Email Campaigns, and Wedding Workflows (additive).
-- Feature-flagged in Netlify (default OFF). Shop-scoped RLS via is_shop_member.

-- ── Holiday Command Center ───────────────────────────────────────────────────
create table if not exists public.holiday_peaks (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planning'
    check (status in ('planning', 'active', 'paused', 'archived')),
  is_paused boolean not null default false,
  target_orders integer not null default 0 check (target_orders >= 0),
  current_orders integer not null default 0 check (current_orders >= 0),
  alert_threshold integer not null default 80 check (alert_threshold >= 0 and alert_threshold <= 100),
  staff_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holiday_peaks_date_range check (ends_on >= starts_on)
);

create index if not exists holiday_peaks_shop_starts_idx
  on public.holiday_peaks (shop_id, starts_on desc);

alter table public.holiday_peaks enable row level security;

drop policy if exists "holiday peaks shop access" on public.holiday_peaks;
create policy "holiday peaks shop access"
  on public.holiday_peaks
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.holiday_peaks from anon;
grant select, insert, update, delete on table public.holiday_peaks to authenticated;
grant all on table public.holiday_peaks to service_role;

-- ── Email Campaigns ──────────────────────────────────────────────────────────
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  subject text not null,
  preview_text text,
  body_html text not null default '',
  audience_note text,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sent', 'cancelled')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_campaigns_shop_updated_idx
  on public.email_campaigns (shop_id, updated_at desc);

alter table public.email_campaigns enable row level security;

drop policy if exists "email campaigns shop access" on public.email_campaigns;
create policy "email campaigns shop access"
  on public.email_campaigns
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.email_campaigns from anon;
grant select, insert, update, delete on table public.email_campaigns to authenticated;
grant all on table public.email_campaigns to service_role;

-- ── Wedding Workflows ────────────────────────────────────────────────────────
create table if not exists public.wedding_projects (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  couple_names text not null,
  event_date date,
  venue text,
  status text not null default 'inquiry'
    check (status in ('inquiry', 'proposal', 'booked', 'in_production', 'delivered', 'closed')),
  budget_cents integer not null default 0 check (budget_cents >= 0),
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wedding_projects_shop_event_idx
  on public.wedding_projects (shop_id, event_date desc nulls last);

create table if not exists public.wedding_checklist_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  wedding_id uuid not null references public.wedding_projects(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wedding_checklist_wedding_idx
  on public.wedding_checklist_items (wedding_id, sort_order);

alter table public.wedding_projects enable row level security;
alter table public.wedding_checklist_items enable row level security;

drop policy if exists "wedding projects shop access" on public.wedding_projects;
create policy "wedding projects shop access"
  on public.wedding_projects
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

drop policy if exists "wedding checklist shop access" on public.wedding_checklist_items;
create policy "wedding checklist shop access"
  on public.wedding_checklist_items
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.wedding_projects from anon;
revoke all on table public.wedding_checklist_items from anon;
grant select, insert, update, delete on table public.wedding_projects to authenticated;
grant select, insert, update, delete on table public.wedding_checklist_items to authenticated;
grant all on table public.wedding_projects to service_role;
grant all on table public.wedding_checklist_items to service_role;
