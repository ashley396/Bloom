-- Bloom v19.1 order workflow hotfix
-- Allows every status used by the Production Board.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
check (status in ('NEW','DESIGNING','READY','OUT_FOR_DELIVERY','COMPLETED'));
