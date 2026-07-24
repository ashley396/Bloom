-- Bloom X v11.3 editable app branding
alter table public.shops add column if not exists app_background_color text default '#f8f3f6';
alter table public.shops add column if not exists app_font text default 'Elegant';
