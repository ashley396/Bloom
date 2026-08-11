-- Florist Network: Florisyn takes $0 on wire sales — default partner relay fees to zero.

alter table public.florist_network_profiles
  alter column wire_fee_percent set default 0;

comment on column public.florist_network_profiles.wire_fee_percent is
  'Optional partner-to-partner relay percent (not a Florisyn fee). Florisyn platform fee is always 0.';

update public.florist_network_profiles
set wire_fee_percent = 0
where wire_fee_percent = 20 and wire_fee_flat = 0;
