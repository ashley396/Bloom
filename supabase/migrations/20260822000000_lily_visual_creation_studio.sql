-- Lily AI Visual Creation Studio — background/flyer generation with
-- revision history and per-shop learned style memory.
--
-- Three additive changes, all following the existing AI-OS v1 pattern
-- (ai_operating_system_v1.sql): tenant-scoped via is_shop_member(shop_id),
-- reuses touch_updated_at(), no new storage bucket, no new RLS helper.
--
--   ai_generated_assets.parent_asset_id — links a revision ("less pink",
--     "make the phone number bigger") back to the asset it revised, so
--     every prior version stays a real, retrievable row instead of being
--     overwritten. Nullable — most assets (a fresh social post, a first
--     generated image) have no parent.
--
--   ai_execution_jobs.conversation_id — lets a follow-up message in the
--     same Lily chat find "the last visual job in this conversation"
--     without guessing from message text. Nullable — jobs started outside
--     a persisted conversation (should not normally happen, but the
--     column must not force one) still insert fine.
--
--   ai_style_memory — one row per shop, a single JSONB column holding
--     both active (promoted) preferences and pending candidates awaiting
--     enough repeated evidence to promote. See _shared/ai-style-memory.js
--     for the shape and the promotion/demotion rules. No candidate ever
--     writes anywhere else — this table is the only place shop style
--     learning lives, and it is fully visible/editable by the florist
--     (the "My Style" screen reads and writes this row directly).

alter table public.ai_generated_assets
  add column if not exists parent_asset_id uuid references public.ai_generated_assets(id) on delete set null;

create index if not exists ai_generated_assets_parent_idx
  on public.ai_generated_assets (parent_asset_id) where parent_asset_id is not null;

alter table public.ai_generated_assets drop constraint if exists ai_generated_assets_asset_type_check;
alter table public.ai_generated_assets add constraint ai_generated_assets_asset_type_check
  check (asset_type in ('social_post', 'image', 'video_concept', 'website_section', 'background', 'flyer'));

alter table public.ai_execution_jobs
  add column if not exists conversation_id uuid references public.lily_conversations(id) on delete set null;

-- The visual-relevant slice of classifyRequest()'s output (visual_op,
-- visual_brief, occasion, traits_used, etc) — small, additive, and lets a
-- retried step (or a later revision) reconstruct real context instead of
-- re-guessing it. Nullable; every non-visual job leaves this empty.
alter table public.ai_execution_jobs
  add column if not exists context jsonb not null default '{}'::jsonb;

create index if not exists ai_execution_jobs_conversation_idx
  on public.ai_execution_jobs (conversation_id, created_at desc) where conversation_id is not null;

create table if not exists public.ai_style_memory (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  -- { <category>: { active: [{text, source, strength, evidence_count,
  --   last_reinforced_at}], candidates: [{text, evidence_count,
  --   last_seen_at}] }, ... } — see DEFAULT_PREFERENCES in
  -- _shared/ai-style-memory.js for the real category list and shape.
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_style_memory enable row level security;

drop policy if exists "ai style memory shop access" on public.ai_style_memory;
create policy "ai style memory shop access"
  on public.ai_style_memory
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.ai_style_memory from anon;
grant select, insert, update, delete on table public.ai_style_memory to authenticated;
grant all on table public.ai_style_memory to service_role;

drop trigger if exists ai_style_memory_touch_updated_at on public.ai_style_memory;
create trigger ai_style_memory_touch_updated_at before update on public.ai_style_memory
for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';
