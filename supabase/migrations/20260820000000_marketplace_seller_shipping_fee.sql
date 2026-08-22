-- Real shipping cost enforcement, replacing the never-wired
-- marketplace_shipping_profiles table (freeform JSON "rules" a seller
-- typed into a textarea, with no listing ever linked to a profile and
-- no checkout code ever reading it — so a configured shipping rate had
-- zero effect on what a buyer actually paid).
--
-- Instead of inventing a schema for that freeform JSON, this extends the
-- marketplace_seller_profiles storefront row that already carries
-- minimum_order_amount, pickup_available, etc. — the one real, working
-- per-seller policy record checkout already reads.

alter table public.marketplace_seller_profiles
  add column if not exists shipping_flat_fee numeric,
  add column if not exists free_shipping_over numeric;

alter table public.marketplace_seller_profiles
  drop constraint if exists marketplace_seller_profiles_shipping_flat_fee_check;
alter table public.marketplace_seller_profiles
  add constraint marketplace_seller_profiles_shipping_flat_fee_check
    check (shipping_flat_fee is null or shipping_flat_fee >= 0);

alter table public.marketplace_seller_profiles
  drop constraint if exists marketplace_seller_profiles_free_shipping_over_check;
alter table public.marketplace_seller_profiles
  add constraint marketplace_seller_profiles_free_shipping_over_check
    check (free_shipping_over is null or free_shipping_over >= 0);
