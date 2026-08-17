-- Website Studio X: a dedicated body/heading text color, alongside the
-- existing primary_color/accent_color fields on shops. Same convention as
-- those columns (see 20260804000000_greenfield_baseline.sql).
alter table public.shops add column if not exists text_color text not null default '#2c2230';
