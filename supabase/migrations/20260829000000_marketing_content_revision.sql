-- Marketing Studio conversational revision loop.
--
-- 1. `ai_generated_assets.asset_type` bug fix: the Lily Creative Style
--    Learning pass (previous commit on this branch) started persisting a
--    real "social_copy" asset for every text_post generation — a genuine,
--    previously-untested-against-the-real-constraint gap, since the fake
--    Supabase client used in Node tests never enforces check constraints.
--    Rebuilt as a strict superset of every prior migration's set (same
--    pattern 20260824000000/20260825000000 already established) — never
--    drops a type an existing feature relies on.
-- 2. Revisions reuse the SAME asset_type as whatever they're revising
--    (image/social_copy/video_concept) — no new asset_type needed. They
--    reuse the pre-existing `parent_asset_id` column (added
--    20260822000000) for the version chain; nothing new there either.

alter table public.ai_generated_assets
  drop constraint if exists ai_generated_assets_asset_type_check;

alter table public.ai_generated_assets
  add constraint ai_generated_assets_asset_type_check check (
    asset_type in (
      'social_post', 'image', 'video_concept', 'website_section', 'background', 'flyer', 'video', 'voice',
      'founder_concept', 'social_copy'
    )
  );

notify pgrst, 'reload schema';
