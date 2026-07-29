-- Run once in Supabase SQL Editor before deploying Bloom v22.1.
alter table public.staff add column if not exists pin_hash text;
comment on column public.staff.pin_hash is 'Salted scrypt employee time-clock PIN hash; never expose to the browser.';
