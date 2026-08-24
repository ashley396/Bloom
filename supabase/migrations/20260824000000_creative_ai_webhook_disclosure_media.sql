-- Creative AI engineering pass: HeyGen webhook job correlation, AI-content
-- disclosure/provenance metadata, and master/derived media-asset tracking.
--
-- NOT APPLIED to any live Supabase project by this session — this file is
-- committed to the repository only, per the standing "no production
-- Supabase changes without explicit approval" rule. Apply only when
-- explicitly authorized, the same way every prior Marketing Studio
-- migration in this repo has been handled.

-- ── Inbound webhook event ledger (provider-independent) ──────────────────

create table if not exists public.marketing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text not null,
  external_job_id text not null,
  idempotency_key text not null unique,
  payload_hash text not null,
  signature_valid boolean not null default false,
  raw_payload jsonb,
  status text not null default 'received' check (
    status in ('received', 'processed', 'failed', 'rejected')
  ),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists marketing_webhook_events_provider_job_idx
  on public.marketing_webhook_events (provider, external_job_id);

create index if not exists marketing_webhook_events_status_idx
  on public.marketing_webhook_events (status, received_at);

-- Inbound webhooks are verified by cryptographic signature, never by a
-- shop-member JWT — there is no browser-reachable identity to check RLS
-- against, so (matching the platform_admins precedent in
-- FUNCTION-ACCESS-TIERS.md) this table gets NO anon/authenticated grants
-- at all. Only the service-role client (used exclusively by
-- heygen-webhook.js, itself an unauthenticated-by-necessity endpoint
-- whose trust comes entirely from HMAC verification) can touch it.
alter table public.marketing_webhook_events enable row level security;
revoke all on table public.marketing_webhook_events from anon, authenticated;
grant all on table public.marketing_webhook_events to service_role;

-- ── Avatar-video job correlation (provider-independent) ──────────────────

create table if not exists public.marketing_clone_video_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  provider text not null,
  provider_job_id text not null,
  source text not null default 'preview' check (source in ('preview', 'content_generation')),
  content_item_id uuid references public.marketing_content_items(id) on delete set null,
  platform_variant_id uuid references public.marketing_platform_variants(id) on delete set null,
  status text not null default 'rendering' check (
    status in ('rendering', 'completed', 'failed')
  ),
  result_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_job_id)
);

create index if not exists marketing_clone_video_jobs_shop_idx
  on public.marketing_clone_video_jobs (shop_id, status);

alter table public.marketing_clone_video_jobs enable row level security;

drop policy if exists "marketing clone video jobs shop access" on public.marketing_clone_video_jobs;
create policy "marketing clone video jobs shop access"
  on public.marketing_clone_video_jobs
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_clone_video_jobs from anon;
grant select, insert, update, delete on table public.marketing_clone_video_jobs to authenticated;
grant all on table public.marketing_clone_video_jobs to service_role;

drop trigger if exists marketing_clone_video_jobs_touch_updated_at on public.marketing_clone_video_jobs;
create trigger marketing_clone_video_jobs_touch_updated_at before update on public.marketing_clone_video_jobs
for each row execute function public.touch_updated_at();

-- ── AI-content disclosure/provenance metadata on platform variants ───────
-- Extends the ai_disclosure_required column that already existed
-- (Stage B foundation migration) rather than creating a parallel table —
-- disclosure is inherently per-platform-variant, which is exactly what
-- that table already models.

alter table public.marketing_platform_variants
  add column if not exists ai_content_type text check (
    ai_content_type is null or ai_content_type in ('none', 'avatar_video', 'generative_video', 'generative_image', 'voice_only')
  ),
  add column if not exists avatar_used boolean not null default false,
  add column if not exists voice_used boolean not null default false,
  add column if not exists generative_video_used boolean not null default false,
  add column if not exists generative_image_used boolean not null default false,
  add column if not exists human_edited boolean not null default false,
  add column if not exists disclosure_method text,
  add column if not exists disclosure_applied boolean not null default false,
  add column if not exists disclosure_policy_version text,
  add column if not exists disclosure_checked_at timestamptz;

-- ── Master/derived media asset tracking ───────────────────────────────────
-- Extends ai_generated_assets (AI-OS v1) rather than a new table — a
-- derived (reframed/captioned/thumbnailed) asset is still fundamentally an
-- asset row, just one that references its parent instead of a fresh
-- provider generation.

-- Rebuilding as a strict superset of the Lily Visual Creation Studio
-- migration's set (social_post, image, video_concept, website_section,
-- background, flyer) plus this pass's two new kinds (video, voice) — never
-- drop a type an existing feature already relies on.
alter table public.ai_generated_assets
  drop constraint if exists ai_generated_assets_asset_type_check;

alter table public.ai_generated_assets
  add constraint ai_generated_assets_asset_type_check check (
    asset_type in ('social_post', 'image', 'video_concept', 'website_section', 'background', 'flyer', 'video', 'voice')
  );

-- NOTE: parent_asset_id ALREADY EXISTS on this table as of the Lily Visual
-- Creation Studio migration (20260822000000), where it links a revision
-- ("less pink", "try a taller vase") to the asset it revised. That existing
-- usage never sets a transformation_type — it is a same-kind sibling
-- generation, not a deterministic transform of a master. `add column if
-- not exists` below is therefore a no-op for parent_asset_id specifically
-- (kept only so this migration is self-describing/idempotent on a fresh
-- database); this migration must NOT redefine or narrow that column's
-- existing on-delete behavior or meaning.
alter table public.ai_generated_assets
  add column if not exists parent_asset_id uuid references public.ai_generated_assets(id) on delete set null,
  add column if not exists transformation_type text check (
    transformation_type is null or transformation_type in ('reframe', 'transcode', 'caption_burn', 'thumbnail', 'trim')
  ),
  add column if not exists generation_usage_id uuid references public.marketing_generation_usage(id) on delete set null;

create index if not exists ai_generated_assets_parent_idx
  on public.ai_generated_assets (parent_asset_id) where parent_asset_id is not null;

-- A row carrying a transformation_type is, by definition, a deterministic
-- transform of a master asset, so it must always reference that master via
-- parent_asset_id — a transformation can never be orphaned. This is
-- deliberately ONE-DIRECTIONAL: it does NOT require the reverse (a bare
-- parent_asset_id with no transformation_type stays valid), because Lily's
-- pre-existing revision-chain rows use parent_asset_id alone and must keep
-- working unchanged.
alter table public.ai_generated_assets
  drop constraint if exists ai_generated_assets_master_derived_consistency;
alter table public.ai_generated_assets
  add constraint ai_generated_assets_master_derived_consistency check (
    transformation_type is null or parent_asset_id is not null
  );
