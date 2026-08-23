-- Florisyn Marketing Studio — Stage B foundation.
--
-- Admin-only (Founding Beta) creative-and-distribution layer for Lily as AI
-- Marketing Director. Every table here is additive and tenant-scoped via the
-- existing is_shop_member(shop_id) pattern — no new RLS helper, no schema
-- redesign. Reuses ai_execution_jobs (job runner), ai_generated_assets
-- (creative output + media), marketing_campaigns (campaign container), and
-- website_media (image/video bytes) rather than duplicating any of them.
--
-- New concepts this migration introduces:
--
--   marketing_brand_brain          — per-shop learned brand voice/style,
--                                    same explicit/inferred/promote-on-
--                                    repetition shape as ai_style_memory
--                                    (see _shared/ai-style-memory.js). One
--                                    row per shop; fully visible/editable.
--
--   marketing_social_connections   — connection STATUS only (platform,
--                                    account label, connected_at,
--                                    expires_at, health). No tokens live
--                                    here — this table is safe to return to
--                                    the browser as-is.
--
--   marketing_social_connection_secrets — the tokens. NOT granted to
--                                    `authenticated` at all — service_role
--                                    only, so no RLS policy can ever leak a
--                                    token to a shop member; only server
--                                    code with the service key can read it.
--
--   marketing_content_items        — one piece of content Lily plans
--                                    (idea → draft → approved → published),
--                                    independent of any one platform.
--
--   marketing_platform_variants    — one row per (content item, platform).
--                                    The "one asset, many tracked variants"
--                                    layer: prevents silently regenerating
--                                    (and re-billing) the same creative for
--                                    every network. Links to
--                                    ai_generated_assets for the actual
--                                    generated media/copy.
--
--   marketing_publishing_jobs      — the reliable-publishing queue: retry
--                                    count, backoff, dead-letter, structured
--                                    error, idempotency key. A row here is
--                                    never silently dropped — see
--                                    Publishing Health Center (Stage E).
--
--   marketing_generation_usage     — the cost ledger. One row per billable
--                                    generation event (estimated at request
--                                    time, corrected to actual once the
--                                    provider returns real cost). This is
--                                    the only place "how much did this cost"
--                                    is ever answered from.
--
--   marketing_avatar_profiles,
--   marketing_voice_profiles       — AI Clone (Digital Twin Studio) provider
--                                    profiles. Both reference a consent
--                                    record; neither can be created without
--                                    one (enforced in application code, not
--                                    just this schema, but the FK makes an
--                                    orphaned profile structurally visible).
--
--   marketing_clone_consent        — the consent audit trail Section 11
--                                    requires: who, what was authorized, for
--                                    which platforms/usage, when, and by
--                                    whom it was revoked (never deleted —
--                                    revocation is a status change, not a
--                                    row removal, so the audit trail stays
--                                    intact).
--
--   marketing_ab_experiments       — hypothesis/variants/metric/duration/
--                                    outcome, explicitly separate from the
--                                    performance_metrics table so a metric
--                                    row is never silently reinterpreted as
--                                    an experiment result.
--
--   marketing_performance_metrics  — real-API-only analytics. `source` is
--                                    constrained to 'platform_api' — there
--                                    is no path in this schema for a
--                                    fabricated or estimated metric to be
--                                    stored as if it were real.
--
-- Admin-only enforcement for Stage B/C/D/E is a SERVER CODE responsibility
-- (platformAdmin(event, ["super_admin"]) from _shared/platform-admin.js),
-- not an RLS concern — every table below still uses the normal
-- is_shop_member(shop_id) shop-membership policy, the same as every other
-- shop-scoped table, so a later non-admin rollout needs zero schema change.

-- ── Brand Brain ─────────────────────────────────────────────────────────

create table if not exists public.marketing_brand_brain (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  -- Same shape family as ai_style_memory.preferences: { <category>: {
  --   traits: [{text, polarity, source, active, evidence_count,
  --   last_signal_at}] } }. Categories are brand-specific (voice_tone,
  --   preferred_words, avoided_words, cta_style, content_density,
  --   audience_description, posting_personality, ...) — see
  --   _shared/marketing-brand-brain.js for the authoritative category list.
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_brand_brain enable row level security;

drop policy if exists "marketing brand brain shop access" on public.marketing_brand_brain;
create policy "marketing brand brain shop access"
  on public.marketing_brand_brain
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_brand_brain from anon;
grant select, insert, update, delete on table public.marketing_brand_brain to authenticated;
grant all on table public.marketing_brand_brain to service_role;

drop trigger if exists marketing_brand_brain_touch_updated_at on public.marketing_brand_brain;
create trigger marketing_brand_brain_touch_updated_at before update on public.marketing_brand_brain
for each row execute function public.touch_updated_at();

-- ── Social connections (status) + secrets (tokens, service_role only) ────

create table if not exists public.marketing_social_connections (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  platform text not null check (
    platform in ('facebook', 'instagram', 'tiktok', 'linkedin', 'pinterest', 'google_business', 'youtube')
  ),
  status text not null default 'not_connected' check (
    status in ('not_connected', 'connecting', 'connected', 'needs_reauth', 'error', 'disconnected')
  ),
  account_label text,
  external_account_id text,
  connected_at timestamptz,
  expires_at timestamptz,
  last_error text,
  last_checked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, platform)
);

create index if not exists marketing_social_connections_shop_idx
  on public.marketing_social_connections (shop_id);

alter table public.marketing_social_connections enable row level security;

drop policy if exists "marketing social connections shop access" on public.marketing_social_connections;
create policy "marketing social connections shop access"
  on public.marketing_social_connections
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_social_connections from anon;
grant select, insert, update, delete on table public.marketing_social_connections to authenticated;
grant all on table public.marketing_social_connections to service_role;

drop trigger if exists marketing_social_connections_touch_updated_at on public.marketing_social_connections;
create trigger marketing_social_connections_touch_updated_at before update on public.marketing_social_connections
for each row execute function public.touch_updated_at();

-- Tokens. Deliberately NOT granted to `authenticated` or `anon` at all — no
-- RLS policy, however written, could leak a token through this table,
-- because the role running the query never has table-level access to begin
-- with. Only server code holding the service-role key can reach this.
create table if not exists public.marketing_social_connection_secrets (
  connection_id uuid primary key references public.marketing_social_connections(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  scope text,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_social_connection_secrets enable row level security;

-- No policy is created on purpose: RLS is enabled with zero policies, which
-- denies every row to every role subject to RLS. service_role bypasses RLS
-- entirely (as it does everywhere else in this schema), which is the only
-- intended access path.
revoke all on table public.marketing_social_connection_secrets from anon;
revoke all on table public.marketing_social_connection_secrets from authenticated;
grant all on table public.marketing_social_connection_secrets to service_role;

drop trigger if exists marketing_social_connection_secrets_touch_updated_at on public.marketing_social_connection_secrets;
create trigger marketing_social_connection_secrets_touch_updated_at before update on public.marketing_social_connection_secrets
for each row execute function public.touch_updated_at();

-- ── Content items + per-platform variants ────────────────────────────────

create table if not exists public.marketing_content_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  content_type text not null check (
    content_type in ('image_post', 'reel', 'short_video', 'long_video', 'story', 'carousel', 'text_post')
  ),
  title text not null default '',
  brief text,
  status text not null default 'idea' check (
    status in ('idea', 'generating', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'failed', 'archived')
  ),
  uses_ai_clone boolean not null default false,
  requires_human_approval boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_content_items_shop_status_idx
  on public.marketing_content_items (shop_id, status, updated_at desc);

create index if not exists marketing_content_items_campaign_idx
  on public.marketing_content_items (campaign_id) where campaign_id is not null;

alter table public.marketing_content_items enable row level security;

drop policy if exists "marketing content items shop access" on public.marketing_content_items;
create policy "marketing content items shop access"
  on public.marketing_content_items
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_content_items from anon;
grant select, insert, update, delete on table public.marketing_content_items to authenticated;
grant all on table public.marketing_content_items to service_role;

drop trigger if exists marketing_content_items_touch_updated_at on public.marketing_content_items;
create trigger marketing_content_items_touch_updated_at before update on public.marketing_content_items
for each row execute function public.touch_updated_at();

create table if not exists public.marketing_platform_variants (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  content_item_id uuid not null references public.marketing_content_items(id) on delete cascade,
  platform text not null check (
    platform in ('facebook', 'instagram', 'tiktok', 'linkedin', 'pinterest', 'google_business', 'youtube')
  ),
  asset_id uuid references public.ai_generated_assets(id) on delete set null,
  caption text,
  hashtags text[] not null default '{}',
  ai_disclosure_required boolean not null default false,
  status text not null default 'pending' check (
    status in ('pending', 'ready', 'scheduled', 'publishing', 'published', 'failed', 'canceled')
  ),
  scheduled_at timestamptz,
  published_at timestamptz,
  external_post_id text,
  external_permalink text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, platform)
);

create index if not exists marketing_platform_variants_shop_status_idx
  on public.marketing_platform_variants (shop_id, status, scheduled_at);

create index if not exists marketing_platform_variants_content_item_idx
  on public.marketing_platform_variants (content_item_id);

alter table public.marketing_platform_variants enable row level security;

drop policy if exists "marketing platform variants shop access" on public.marketing_platform_variants;
create policy "marketing platform variants shop access"
  on public.marketing_platform_variants
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_platform_variants from anon;
grant select, insert, update, delete on table public.marketing_platform_variants to authenticated;
grant all on table public.marketing_platform_variants to service_role;

drop trigger if exists marketing_platform_variants_touch_updated_at on public.marketing_platform_variants;
create trigger marketing_platform_variants_touch_updated_at before update on public.marketing_platform_variants
for each row execute function public.touch_updated_at();

-- ── Reliable publishing queue ─────────────────────────────────────────────

create table if not exists public.marketing_publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  platform_variant_id uuid not null references public.marketing_platform_variants(id) on delete cascade,
  idempotency_key text not null unique,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'succeeded', 'failed', 'dead_letter', 'canceled')
  ),
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_publishing_jobs_status_next_attempt_idx
  on public.marketing_publishing_jobs (status, next_attempt_at);

create index if not exists marketing_publishing_jobs_shop_idx
  on public.marketing_publishing_jobs (shop_id);

alter table public.marketing_publishing_jobs enable row level security;

drop policy if exists "marketing publishing jobs shop access" on public.marketing_publishing_jobs;
create policy "marketing publishing jobs shop access"
  on public.marketing_publishing_jobs
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_publishing_jobs from anon;
grant select, insert, update, delete on table public.marketing_publishing_jobs to authenticated;
grant all on table public.marketing_publishing_jobs to service_role;

drop trigger if exists marketing_publishing_jobs_touch_updated_at on public.marketing_publishing_jobs;
create trigger marketing_publishing_jobs_touch_updated_at before update on public.marketing_publishing_jobs
for each row execute function public.touch_updated_at();

-- ── Cost ledger ────────────────────────────────────────────────────────

create table if not exists public.marketing_generation_usage (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  job_id uuid references public.ai_execution_jobs(id) on delete set null,
  content_item_id uuid references public.marketing_content_items(id) on delete set null,
  provider text not null,
  purpose text not null check (
    purpose in ('image', 'video', 'avatar_video', 'voice', 'copy', 'other')
  ),
  unit_type text not null check (unit_type in ('image', 'second', 'character', 'request')),
  units numeric not null default 0,
  estimated_cost_cents int,
  actual_cost_cents int,
  currency text not null default 'USD',
  status text not null default 'estimated' check (status in ('estimated', 'actual', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists marketing_generation_usage_shop_created_idx
  on public.marketing_generation_usage (shop_id, created_at desc);

create index if not exists marketing_generation_usage_job_idx
  on public.marketing_generation_usage (job_id) where job_id is not null;

alter table public.marketing_generation_usage enable row level security;

drop policy if exists "marketing generation usage shop access" on public.marketing_generation_usage;
create policy "marketing generation usage shop access"
  on public.marketing_generation_usage
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_generation_usage from anon;
grant select, insert, update, delete on table public.marketing_generation_usage to authenticated;
grant all on table public.marketing_generation_usage to service_role;

-- ── AI Clone: consent, avatar, voice ──────────────────────────────────────

create table if not exists public.marketing_clone_consent (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  person_name text not null,
  consent_version text not null default 'v1',
  avatar_permission boolean not null default false,
  voice_permission boolean not null default false,
  approved_usage text[] not null default '{}',
  approved_platforms text[] not null default '{}',
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  audit jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_clone_consent_shop_idx
  on public.marketing_clone_consent (shop_id);

alter table public.marketing_clone_consent enable row level security;

drop policy if exists "marketing clone consent shop access" on public.marketing_clone_consent;
create policy "marketing clone consent shop access"
  on public.marketing_clone_consent
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_clone_consent from anon;
grant select, insert, update, delete on table public.marketing_clone_consent to authenticated;
grant all on table public.marketing_clone_consent to service_role;

drop trigger if exists marketing_clone_consent_touch_updated_at on public.marketing_clone_consent;
create trigger marketing_clone_consent_touch_updated_at before update on public.marketing_clone_consent
for each row execute function public.touch_updated_at();

create table if not exists public.marketing_avatar_profiles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  consent_id uuid not null references public.marketing_clone_consent(id) on delete restrict,
  provider text not null,
  provider_profile_id text,
  status text not null default 'training' check (
    status in ('training', 'ready', 'failed', 'suspended', 'deleted')
  ),
  display_name text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_avatar_profiles_shop_idx
  on public.marketing_avatar_profiles (shop_id);

alter table public.marketing_avatar_profiles enable row level security;

drop policy if exists "marketing avatar profiles shop access" on public.marketing_avatar_profiles;
create policy "marketing avatar profiles shop access"
  on public.marketing_avatar_profiles
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_avatar_profiles from anon;
grant select, insert, update, delete on table public.marketing_avatar_profiles to authenticated;
grant all on table public.marketing_avatar_profiles to service_role;

drop trigger if exists marketing_avatar_profiles_touch_updated_at on public.marketing_avatar_profiles;
create trigger marketing_avatar_profiles_touch_updated_at before update on public.marketing_avatar_profiles
for each row execute function public.touch_updated_at();

create table if not exists public.marketing_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  consent_id uuid not null references public.marketing_clone_consent(id) on delete restrict,
  provider text not null,
  provider_profile_id text,
  status text not null default 'training' check (
    status in ('training', 'ready', 'failed', 'suspended', 'deleted')
  ),
  display_name text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_voice_profiles_shop_idx
  on public.marketing_voice_profiles (shop_id);

alter table public.marketing_voice_profiles enable row level security;

drop policy if exists "marketing voice profiles shop access" on public.marketing_voice_profiles;
create policy "marketing voice profiles shop access"
  on public.marketing_voice_profiles
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_voice_profiles from anon;
grant select, insert, update, delete on table public.marketing_voice_profiles to authenticated;
grant all on table public.marketing_voice_profiles to service_role;

drop trigger if exists marketing_voice_profiles_touch_updated_at on public.marketing_voice_profiles;
create trigger marketing_voice_profiles_touch_updated_at before update on public.marketing_voice_profiles
for each row execute function public.touch_updated_at();

-- ── A/B experiments + performance metrics ─────────────────────────────────

create table if not exists public.marketing_ab_experiments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  hypothesis text not null,
  -- [{label, content_item_id}, ...]
  variants jsonb not null default '[]'::jsonb,
  metric text not null,
  duration_days int not null default 7,
  status text not null default 'draft' check (
    status in ('draft', 'running', 'completed', 'inconclusive', 'canceled')
  ),
  -- {winner, confidence, raw_metrics, notes} — only ever filled from real
  -- fetched metrics, never estimated.
  outcome jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_ab_experiments_shop_idx
  on public.marketing_ab_experiments (shop_id, status);

alter table public.marketing_ab_experiments enable row level security;

drop policy if exists "marketing ab experiments shop access" on public.marketing_ab_experiments;
create policy "marketing ab experiments shop access"
  on public.marketing_ab_experiments
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_ab_experiments from anon;
grant select, insert, update, delete on table public.marketing_ab_experiments to authenticated;
grant all on table public.marketing_ab_experiments to service_role;

drop trigger if exists marketing_ab_experiments_touch_updated_at on public.marketing_ab_experiments;
create trigger marketing_ab_experiments_touch_updated_at before update on public.marketing_ab_experiments
for each row execute function public.touch_updated_at();

create table if not exists public.marketing_performance_metrics (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  platform_variant_id uuid references public.marketing_platform_variants(id) on delete cascade,
  platform text not null check (
    platform in ('facebook', 'instagram', 'tiktok', 'linkedin', 'pinterest', 'google_business', 'youtube')
  ),
  metric_name text not null,
  raw_value numeric not null,
  normalized_value numeric,
  -- Real-API-only guardrail: this column has exactly one legal value.
  -- There is no "estimated" or "modeled" source for a performance metric —
  -- an estimate belongs in marketing_generation_usage, never here.
  source text not null default 'platform_api' check (source = 'platform_api'),
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists marketing_performance_metrics_variant_idx
  on public.marketing_performance_metrics (platform_variant_id, metric_name, fetched_at desc);

create index if not exists marketing_performance_metrics_shop_idx
  on public.marketing_performance_metrics (shop_id, fetched_at desc);

alter table public.marketing_performance_metrics enable row level security;

drop policy if exists "marketing performance metrics shop access" on public.marketing_performance_metrics;
create policy "marketing performance metrics shop access"
  on public.marketing_performance_metrics
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_performance_metrics from anon;
grant select, insert, update, delete on table public.marketing_performance_metrics to authenticated;
grant all on table public.marketing_performance_metrics to service_role;

notify pgrst, 'reload schema';
