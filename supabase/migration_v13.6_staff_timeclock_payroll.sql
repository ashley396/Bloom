alter table public.staff add column if not exists hourly_rate numeric(12,2) default 0;
alter table public.staff add column if not exists hire_date date;
alter table public.staff add column if not exists federal_tax_rate numeric(7,4) default 0;
alter table public.staff add column if not exists state_tax_rate numeric(7,4) default 0;
alter table public.staff add column if not exists local_tax_rate numeric(7,4) default 0;
alter table public.staff add column if not exists other_deduction_rate numeric(7,4) default 0;
alter table public.staff add column if not exists fixed_deduction numeric(12,2) default 0;
create table if not exists public.staff_time_entries (id uuid primary key default gen_random_uuid(),shop_id uuid not null references public.shops(id) on delete cascade,staff_id uuid not null references public.staff(id) on delete cascade,clock_in timestamptz not null default now(),clock_out timestamptz,hours_worked numeric(10,2),notes text,created_at timestamptz not null default now());
create index if not exists staff_time_entries_staff_idx on public.staff_time_entries(staff_id,clock_in desc);
