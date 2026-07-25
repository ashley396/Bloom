-- Bloom v9.0.5: allow manually created delivery stops to store a destination address.
alter table public.deliveries
  add column if not exists address text;

notify pgrst, 'reload schema';
