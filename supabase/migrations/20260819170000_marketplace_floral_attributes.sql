-- Florisyn Wholesale Marketplace: floral-specific product attributes.
--
-- The marketplace data model up to this point treats every listing like
-- generic ecommerce (product_name/unit/price/available_quantity). Wholesale
-- flowers are bought and sold on different terms — variety, color, stem
-- length, grade, grower, bunch/box/case quantities, per-unit pricing, and
-- time-sensitive availability. This migration adds that vocabulary as
-- additive, nullable columns so every existing listing keeps working
-- unchanged; the new fields simply go unset until a seller fills them in.
alter table public.marketplace_listings add column if not exists variety text;
alter table public.marketplace_listings add column if not exists color text;
alter table public.marketplace_listings add column if not exists stem_length_in numeric;
alter table public.marketplace_listings add column if not exists grade text;
alter table public.marketplace_listings add column if not exists grower_name text;
alter table public.marketplace_listings add column if not exists origin text;

-- Bunch/box/case are how flowers are actually packed and sold; a stem-level
-- price is optional on top of whichever pack size the seller lists at.
alter table public.marketplace_listings add column if not exists stems_per_bunch numeric;
alter table public.marketplace_listings add column if not exists bunches_per_box numeric;
alter table public.marketplace_listings add column if not exists case_quantity numeric;
alter table public.marketplace_listings add column if not exists price_per_stem numeric;
alter table public.marketplace_listings add column if not exists price_per_bunch numeric;
alter table public.marketplace_listings add column if not exists price_per_box numeric;
alter table public.marketplace_listings add column if not exists price_per_case numeric;

-- Fresh flowers are not permanently-available inventory. availability_status
-- captures the real state; available_from/available_until and
-- seasonal_months carry the dates when that state is time-bound.
alter table public.marketplace_listings add column if not exists availability_status text not null default 'available_now';
alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_availability_status_check;
alter table public.marketplace_listings
  add constraint marketplace_listings_availability_status_check
  check (availability_status in (
    'available_now', 'scheduled', 'seasonal', 'preorder', 'limited', 'sold_out'
  ));
alter table public.marketplace_listings add column if not exists available_from date;
alter table public.marketplace_listings add column if not exists available_until date;
alter table public.marketplace_listings add column if not exists seasonal_months integer[];
alter table public.marketplace_listings add column if not exists lead_time_days numeric;

-- Location/fulfillment: allows_shipping/allows_local_pickup already exist;
-- these narrow pickup/delivery to where the product actually is.
alter table public.marketplace_listings add column if not exists delivery_region text;
alter table public.marketplace_listings add column if not exists pickup_city text;
alter table public.marketplace_listings add column if not exists pickup_state text;

-- Honest substitution guidance for the buyer, set by the seller — not an
-- AI guess about what's interchangeable with what.
alter table public.marketplace_listings add column if not exists substitution_note text;

create index if not exists marketplace_listings_variety_idx
  on public.marketplace_listings (variety);
create index if not exists marketplace_listings_availability_status_idx
  on public.marketplace_listings (availability_status);
