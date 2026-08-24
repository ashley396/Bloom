-- Personal Brand Studio — native Marketing Studio capability that lets
-- Lily learn how a florist wants THEMSELVES represented (not just how
-- their shop's brand should look). See docs/production/ (this pass) for
-- the full directive this implements.
--
-- NOT APPLIED to any live Supabase project by this session — committed to
-- the repository only, per the standing "no production Supabase changes
-- without explicit approval" rule carried through every prior Marketing
-- Studio migration in this repo.
--
-- Deliberately reuses rather than duplicates:
--   - ai_generated_assets       — founder concepts persist here (new
--                                 'founder_concept' asset_type, added as a
--                                 superset — every prior asset_type value
--                                 is preserved unchanged) with the SAME
--                                 parent_asset_id semantics protected in
--                                 20260824000000 (a Digital Twin video
--                                 generated from an approved founder
--                                 concept links via bare parent_asset_id,
--                                 same as a Lily revision — no
--                                 transformation_type, since it's a new
--                                 generation of the same concept, not a
--                                 deterministic transform of it).
--   - marketing_clone_consent   — the AI-avatar/voice/publish consent
--                                 dimensions (4, 5, 6 in Section 6 of the
--                                 directive) are already exactly this
--                                 table's shape (avatar_permission/
--                                 voice_permission/approved_usage/
--                                 approved_platforms, independently
--                                 revocable). Personal Brand Studio never
--                                 re-implements that — it only adds the
--                                 reference-photo-specific consent
--                                 dimensions (1, 2, 3: store / use for
--                                 image generation / use for avatar
--                                 generation) that didn't exist before,
--                                 as columns on the new reference-photo
--                                 table below.
--   - marketing_content_items,
--     marketing_platform_variants — an approved founder concept becomes a
--                                 real content_item + platform variants
--                                 through the EXISTING plan/generate/
--                                 publish pipeline (Stage C/D/E), not a
--                                 parallel one.

create table if not exists public.marketing_personal_brand_profiles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references public.shops(id) on delete cascade,
  display_name text not null default '',
  founder_title text not null default '',
  founder_story text not null default '',
  -- How this florist wants their founder content to read by default —
  -- Lily commands ("make this appropriate for LinkedIn") can still
  -- override per-request; this is only the standing default.
  professional_casual_balance text not null default 'balanced' check (
    professional_casual_balance in ('professional', 'balanced', 'casual')
  ),
  humor_level text not null default 'light' check (
    humor_level in ('serious', 'light', 'playful')
  ),
  -- Learned presentation-preference traits (clothing/colors/environment/
  -- flowers/props/framing/lighting/expression/personality) — same
  -- explicit-writes-immediately / inferred-promotes-after-repetition shape
  -- as ai-style-memory.js and marketing-brand-brain.js. See
  -- _shared/personal-brand-memory.js.
  preferences jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_personal_brand_profiles enable row level security;

drop policy if exists "personal brand profiles shop access" on public.marketing_personal_brand_profiles;
create policy "personal brand profiles shop access"
  on public.marketing_personal_brand_profiles
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_personal_brand_profiles from anon;
grant select, insert, update, delete on table public.marketing_personal_brand_profiles to authenticated;
grant all on table public.marketing_personal_brand_profiles to service_role;

drop trigger if exists marketing_personal_brand_profiles_touch_updated_at on public.marketing_personal_brand_profiles;
create trigger marketing_personal_brand_profiles_touch_updated_at before update on public.marketing_personal_brand_profiles
for each row execute function public.touch_updated_at();

-- ── Reference photo library (Section 5/6) ─────────────────────────────────
-- Deliberately three independent consent booleans, not one blanket
-- checkbox (Section 6): storing a photo, using it for direct image
-- generation (e.g. Photo Studio face-preserving edits), and using it to
-- train an avatar are three different permissions a florist can grant or
-- withhold separately. A row can exist with consented_to_store=true and
-- both use-flags false — "keep this on file, but don't use it for
-- anything yet."

create table if not exists public.marketing_personal_brand_reference_photos (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  media_url text not null,
  media_path text,
  label text not null default 'approved_likeness_reference' check (
    label in ('approved_likeness_reference', 'favorite_reference', 'professional_reference', 'casual_reference', 'do_not_use')
  ),
  consented_to_store boolean not null default false,
  allow_image_generation boolean not null default false,
  allow_avatar_generation boolean not null default false,
  consent_recorded_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_personal_brand_reference_photos_shop_idx
  on public.marketing_personal_brand_reference_photos (shop_id);

alter table public.marketing_personal_brand_reference_photos enable row level security;

drop policy if exists "personal brand reference photos shop access" on public.marketing_personal_brand_reference_photos;
create policy "personal brand reference photos shop access"
  on public.marketing_personal_brand_reference_photos
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_personal_brand_reference_photos from anon;
grant select, insert, update, delete on table public.marketing_personal_brand_reference_photos to authenticated;
grant all on table public.marketing_personal_brand_reference_photos to service_role;

drop trigger if exists marketing_personal_brand_reference_photos_touch_updated_at on public.marketing_personal_brand_reference_photos;
create trigger marketing_personal_brand_reference_photos_touch_updated_at before update on public.marketing_personal_brand_reference_photos
for each row execute function public.touch_updated_at();

-- ── Structured quality feedback (Section 14) ──────────────────────────────
-- Append-only by design (no update/delete beyond standard shop-member CRUD
-- grants for correction) — this is a signal log, not a mutable settings
-- row; recordPersonalBrandFeedbackSignal() (application code) is what
-- turns repeated feedback into a learned trait via the same memory engine.

create table if not exists public.marketing_personal_brand_feedback (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  asset_id uuid not null references public.ai_generated_assets(id) on delete cascade,
  reason text not null check (
    reason in (
      'doesnt_look_like_me', 'face_wrong', 'hair_wrong', 'outfit_wrong', 'expression_wrong',
      'too_artificial', 'wrong_setting', 'wrong_flowers', 'wrong_personality',
      'too_formal', 'too_casual', 'love_this'
    )
  ),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists marketing_personal_brand_feedback_asset_idx
  on public.marketing_personal_brand_feedback (asset_id);

alter table public.marketing_personal_brand_feedback enable row level security;

drop policy if exists "personal brand feedback shop access" on public.marketing_personal_brand_feedback;
create policy "personal brand feedback shop access"
  on public.marketing_personal_brand_feedback
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

revoke all on table public.marketing_personal_brand_feedback from anon;
grant select, insert, update, delete on table public.marketing_personal_brand_feedback to authenticated;
grant all on table public.marketing_personal_brand_feedback to service_role;

-- ── ai_generated_assets: one new, additive asset_type ─────────────────────
-- Rebuilt as a strict superset of every prior migration's set (see
-- 20260824000000's own superset rebuild) — never drops a type an existing
-- feature relies on.
alter table public.ai_generated_assets
  drop constraint if exists ai_generated_assets_asset_type_check;

alter table public.ai_generated_assets
  add constraint ai_generated_assets_asset_type_check check (
    asset_type in (
      'social_post', 'image', 'video_concept', 'website_section', 'background', 'flyer', 'video', 'voice',
      'founder_concept'
    )
  );

notify pgrst, 'reload schema';
