-- Florist Network: default 80/20 partner split, optional reference photo on wires

alter table public.florist_network_profiles
  alter column wire_fee_percent set default 20;

comment on column public.florist_network_profiles.wire_fee_percent is
  'Percent kept by the sending florist on wire orders (default 20). Fulfilling florist receives the remainder.';

alter table public.florist_wire_orders
  add column if not exists relay_fee_percent numeric(5,2),
  add column if not exists reference_photo_url text;

comment on column public.florist_wire_orders.relay_fee_percent is
  'Sending shop relay fee percent for this wire (defaults to profile or 20).';
comment on column public.florist_wire_orders.reference_photo_url is
  'Optional customer reference photo storage path for the requested arrangement.';
