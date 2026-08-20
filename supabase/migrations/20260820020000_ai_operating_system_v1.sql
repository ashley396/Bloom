-- Florisyn AI Operating System v1 — Lily/Bud/Rose/Daisy shared execution
-- and generated-asset layer (Phase 2/4/5 of the AI-OS rebuild).
--
-- Two new tables, both tenant-scoped via the existing is_shop_member(shop_id)
-- pattern used by marketing_campaigns/website_media/etc:
--
--   ai_execution_jobs    — one row per multi-step AI task Lily plans and
--                          runs (e.g. "Homecoming campaign for Facebook and
--                          website"). Tracks real execution state so a job
--                          where 6 of 7 steps succeed is never reported as
--                          either fully done or fully lost.
--
--   ai_generated_assets  — one row per finished creative asset (a social
--                          post, a generated image, a video concept/script/
--                          storyboard). This is a metadata/relationship
--                          layer, not a competing storage system: actual
--                          image bytes reuse the existing public
--                          website-media bucket + website_media table
--                          (media_id below); this table only adds AI
--                          provenance (provider/model/prompt) and links the
--                          asset to the job and campaign that produced it.
--
-- No new storage bucket. No new RLS helper. Reuses touch_updated_at() and
-- is_shop_member(), same as every other shop-scoped table in this schema.

create table if not exists public.ai_execution_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  persona text not null default 'Lily' check (persona in ('Lily', 'Bud', 'Rose', 'Daisy')),
  job_type text not null,
  title text not null default '',
  status text not null default 'planned' check (
    status in (
      'planned',
      'running',
      'waiting_for_user',
      'waiting_for_approval',
      'completed',
      'partially_completed',
      'failed'
    )
  ),
  request_text text,
  -- Ordered step list: [{id, tool, label, status, result, error}, ...].
  -- `status` per step reuses the same job-status vocabulary above (minus
  -- 'planned'/'partially_completed', which only make sense at the job
  -- level) so a UI can render one consistent set of state badges.
  plan jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_execution_jobs_shop_updated_idx
  on public.ai_execution_jobs (shop_id, updated_at desc);

create index if not exists ai_execution_jobs_campaign_idx
  on public.ai_execution_jobs (campaign_id) where campaign_id is not null;

alter table public.ai_execution_jobs enable row level security;

drop policy if exists "ai execution jobs shop access" on public.ai_execution_jobs;
create policy "ai execution jobs shop access"
  on public.ai_execution_jobs
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.ai_execution_jobs from anon;
grant select, insert, update, delete on table public.ai_execution_jobs to authenticated;
grant all on table public.ai_execution_jobs to service_role;

drop trigger if exists ai_execution_jobs_touch_updated_at on public.ai_execution_jobs;
create trigger ai_execution_jobs_touch_updated_at before update on public.ai_execution_jobs
for each row execute function public.touch_updated_at();

create table if not exists public.ai_generated_assets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  persona text not null default 'Lily' check (persona in ('Lily', 'Bud', 'Rose', 'Daisy')),
  job_id uuid references public.ai_execution_jobs(id) on delete set null,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  asset_type text not null check (
    asset_type in ('social_post', 'image', 'video_concept', 'website_section')
  ),
  provider text not null default 'cloudflare',
  model text not null,
  prompt text,
  -- Structured generated content for text/JSON assets (post copy, video
  -- concept/script/storyboard/captions, website section draft). Images
  -- store their bytes in website_media/the website-media bucket instead —
  -- media_id below points at that row; content may still carry the image's
  -- alt text / visual brief even when media_id is set.
  content jsonb,
  media_id uuid references public.website_media(id) on delete set null,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists ai_generated_assets_shop_created_idx
  on public.ai_generated_assets (shop_id, created_at desc);

create index if not exists ai_generated_assets_job_idx
  on public.ai_generated_assets (job_id) where job_id is not null;

create index if not exists ai_generated_assets_campaign_idx
  on public.ai_generated_assets (campaign_id) where campaign_id is not null;

alter table public.ai_generated_assets enable row level security;

drop policy if exists "ai generated assets shop access" on public.ai_generated_assets;
create policy "ai generated assets shop access"
  on public.ai_generated_assets
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.ai_generated_assets from anon;
grant select, insert, update, delete on table public.ai_generated_assets to authenticated;
grant all on table public.ai_generated_assets to service_role;

notify pgrst, 'reload schema';
