-- Florist Community: Arrangement Share permissions.
--
-- Every Arrangement Share post could previously be saved to another
-- florist's library or imported as a shop product with zero say from the
-- creator — no permission field existed at all. The creator now
-- explicitly chooses how far their design may travel, and separately
-- whether their original PHOTOGRAPH may be reused (recipe/design reuse
-- never implies photo reuse). Defaults are the most restrictive option in
-- both cases: never assume commercial permission.
--
-- share_permission is an escalating scope — each tier includes everything
-- below it, kept as a single control (not five separate toggles) so
-- sharing stays easy for a florist who just wants to post a photo:
--   inspiration_only  — view/save the post itself for inspiration only
--   save_to_library   — may save the arrangement into their own library
--   allow_recreation  — may recreate the design
--   allow_shop_use    — may import it as a shop product
--   allow_website_use — may publish a customized version through their storefront
--
-- Safe to re-run.

alter table public.florist_community_posts
  add column if not exists share_permission text not null default 'inspiration_only',
  add column if not exists allow_photo_use boolean not null default false;

alter table public.florist_community_posts
  drop constraint if exists florist_community_posts_share_permission_check;

alter table public.florist_community_posts
  add constraint florist_community_posts_share_permission_check
  check (share_permission in (
    'inspiration_only',
    'save_to_library',
    'allow_recreation',
    'allow_shop_use',
    'allow_website_use'
  ));

comment on column public.florist_community_posts.share_permission is
  'Creator-controlled ceiling on how an Arrangement Share post may be reused by other florists. Ordered least to most permissive; each tier includes everything below it. Enforced server-side in netlify/functions/florist-community.js.';
comment on column public.florist_community_posts.allow_photo_use is
  'Whether other florists may reuse the creator''s ORIGINAL PHOTOGRAPH, not just recreate the design. Orthogonal to share_permission — recreation rights never imply photo reuse rights.';

notify pgrst, 'reload schema';
