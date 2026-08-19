-- Florist Network wire ratings — the trust signal legacy wire services
-- (Teleflora, FTD, BloomNet) provide via "quality guarantee" programs
-- that Florisyn's directory didn't have: after a wire order is delivered,
-- each side can rate the other. Shown as an average + count on the
-- partner directory (netlify/functions/florist-network.js, action=partners).
--
-- Immutable by design (no update/delete policy) — same reasoning as an
-- audit log: a rating shouldn't be quietly edited after the fact.

create table if not exists public.florist_wire_ratings (
  id uuid primary key default gen_random_uuid(),
  wire_id uuid not null references public.florist_wire_orders(id) on delete cascade,
  rater_shop_id uuid not null references public.shops(id) on delete cascade,
  ratee_shop_id uuid not null references public.shops(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (wire_id, rater_shop_id)
);

create index if not exists idx_florist_wire_ratings_ratee on public.florist_wire_ratings(ratee_shop_id);
create index if not exists idx_florist_wire_ratings_wire on public.florist_wire_ratings(wire_id);

alter table public.florist_wire_ratings enable row level security;

-- Any active shop member can insert a rating, but only as their own shop
-- (rater_shop_id must be a shop they belong to) — see canRateWire() in
-- lib/florist-network/wire-orders.js for the "wire must be delivered"
-- rule, enforced in the Netlify function since it needs to read the
-- related wire's status.
create policy florist_wire_ratings_insert on public.florist_wire_ratings
  for insert
  with check (public.user_has_shop_access(rater_shop_id));

-- Ratings are a network-wide trust signal, same as the profile directory
-- itself (florist_network_profiles_public_read) — readable by any active
-- shop member, not just the two shops involved in that particular wire.
create policy florist_wire_ratings_public_read on public.florist_wire_ratings
  for select using (true);
