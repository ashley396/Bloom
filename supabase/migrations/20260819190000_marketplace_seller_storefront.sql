-- Florisyn Wholesale Marketplace: a real wholesaler storefront.
--
-- The vision doc's "WHOLESALER STOREFRONTS" section: a florist should be
-- able to open a supplier and see location, delivery area, pickup
-- information, ordering policies, contact/support info, and featured
-- products — not just a name and bio. marketplace_seller_profiles today
-- only has display_name/bio/website/minimum_order_amount. This migration
-- adds the rest as additive, nullable columns; every existing seller
-- profile keeps working unchanged until they fill these in.
alter table public.marketplace_seller_profiles add column if not exists location_city text;
alter table public.marketplace_seller_profiles add column if not exists location_state text;
alter table public.marketplace_seller_profiles add column if not exists location_country text;
alter table public.marketplace_seller_profiles add column if not exists delivery_area text;
alter table public.marketplace_seller_profiles add column if not exists delivery_radius_miles numeric;
alter table public.marketplace_seller_profiles add column if not exists pickup_available boolean not null default false;
alter table public.marketplace_seller_profiles add column if not exists pickup_address text;
alter table public.marketplace_seller_profiles add column if not exists pickup_hours text;
alter table public.marketplace_seller_profiles add column if not exists ordering_policy text;
alter table public.marketplace_seller_profiles add column if not exists order_deadline_note text;
alter table public.marketplace_seller_profiles add column if not exists contact_email text;
alter table public.marketplace_seller_profiles add column if not exists contact_phone text;

-- Seller-curated, not algorithmic — the seller explicitly picks which of
-- their own published listings to feature; Florisyn never invents a
-- "featured" ranking on their behalf.
alter table public.marketplace_seller_profiles add column if not exists featured_listing_ids uuid[] not null default '{}';
