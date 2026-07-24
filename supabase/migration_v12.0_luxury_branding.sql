-- Bloom X v12.0 Luxury Edition
alter table public.shops add column if not exists sidebar_color text default '#30232d';
alter table public.shops add column if not exists header_color text default '#ffffff';
alter table public.shops add column if not exists dashboard_image_url text;
