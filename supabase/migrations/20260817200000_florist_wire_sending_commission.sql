-- Fixes a real financial-correctness gap in the Florist Network: the
-- sending florist (the shop that takes the customer's payment and wires
-- the order to a partner shop to fulfill) had no way to keep a negotiated
-- commission. The fulfilling shop always received 100% of the wire
-- amount and the sending shop received 0% — contradicting how F2F wire
-- relationships actually work (the sending shop keeps an agreed cut for
-- bringing in the sale, e.g. 20%, and the fulfilling shop keeps the rest,
-- e.g. 80% — negotiated between the two shops, never a cut to Florisyn).
--
-- sending_shop_percent is captured per wire order (not just read live off
-- the sending shop's profile default) so a later profile change never
-- silently changes the deal on an order already sent.
alter table public.florist_wire_orders
  add column if not exists sending_shop_percent numeric(5,2) not null default 20
    check (sending_shop_percent >= 0 and sending_shop_percent <= 100);
