-- Digital Twin result lifecycle — closes the gap the previous pass left
-- open: a completed HeyGen/ElevenLabs render kicks off a job and a
-- correlation row (marketing_clone_video_jobs), but nothing yet turns a
-- verified completion into a real ai_generated_assets record, linked back
-- to its source Personal Brand concept, the avatar/voice profile and
-- consent grant that authorized it, and (where appropriate) a real
-- Marketing Studio content_item awaiting human review.
--
-- NOT APPLIED to any live Supabase project by this session — committed to
-- the repository only, per the standing rule every prior migration in
-- this repo has followed. Purely additive: every new column is nullable
-- (or has a safe default) and every existing column/constraint is left
-- exactly as-is.

alter table public.marketing_clone_video_jobs
  add column if not exists source_asset_id uuid references public.ai_generated_assets(id) on delete set null,
  add column if not exists resulting_asset_id uuid references public.ai_generated_assets(id) on delete set null,
  add column if not exists avatar_profile_id uuid references public.marketing_avatar_profiles(id) on delete set null,
  add column if not exists voice_profile_id uuid references public.marketing_voice_profiles(id) on delete set null,
  add column if not exists consent_id uuid references public.marketing_clone_consent(id) on delete set null,
  add column if not exists usage text check (
    usage is null or usage in ('social_video', 'website_video', 'voicemail_greeting', 'ads')
  ),
  add column if not exists platform text check (
    platform is null or platform in ('facebook', 'instagram', 'tiktok', 'linkedin', 'pinterest', 'google_business', 'youtube')
  ),
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists finalized_at timestamptz;

create index if not exists marketing_clone_video_jobs_source_asset_idx
  on public.marketing_clone_video_jobs (source_asset_id) where source_asset_id is not null;

create index if not exists marketing_clone_video_jobs_resulting_asset_idx
  on public.marketing_clone_video_jobs (resulting_asset_id) where resulting_asset_id is not null;

notify pgrst, 'reload schema';
