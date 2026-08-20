-- Switching Barrier Register Wave 6: Stripe Terminal (card-present payments).
-- Mirrors stripe_connect_account_id exactly — one column, same pattern,
-- no new table. A Terminal reader/Location belongs to the shop's own
-- Connect account (payment-terminal.js manages it there directly), so
-- this only needs to remember which Location Florisyn already created
-- for this shop, the same way stripe_connect_account_id remembers which
-- Connect account it already created.

alter table public.shops add column if not exists stripe_terminal_location_id text;
