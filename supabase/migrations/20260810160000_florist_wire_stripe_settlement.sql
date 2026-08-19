-- Florist Network wire payments — Stripe Connect settlement at launch (Florisyn fee $0).

alter table public.florist_wire_orders
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending_payment', 'paid', 'refunded')),
  add column if not exists stripe_checkout_session_id text,
  add column if not exists paid_at timestamptz;

create index if not exists idx_florist_wire_orders_payment
  on public.florist_wire_orders (sending_shop_id, payment_status);

comment on column public.florist_wire_orders.payment_status is
  'Stripe Connect settlement from sending shop to fulfilling shop. Florisyn application fee is always 0.';
