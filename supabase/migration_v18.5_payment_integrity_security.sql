-- Bloom v18.5 — Payment Integrity & Security
create extension if not exists pgcrypto;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('Stripe','Cash','Check','Gift Card','Store Credit','Other')),
  status text not null default 'SUCCEEDED' check (status in ('PENDING','SUCCEEDED','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
  processor text,
  processor_session_id text,
  processor_payment_intent_id text,
  idempotency_key text not null,
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  refunded_amount numeric(12,2) not null default 0 check (refunded_amount >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (shop_id, idempotency_key),
  unique (processor, processor_session_id)
);
create index if not exists payments_shop_received_idx on public.payments(shop_id, received_at desc);
create index if not exists payments_order_idx on public.payments(order_id, received_at);
alter table public.payments enable row level security;
drop policy if exists "members read payments" on public.payments;
create policy "members read payments" on public.payments for select using (public.user_has_shop_access(shop_id));

alter table public.orders add column if not exists paid_at timestamptz;

create or replace function public.post_order_payment(
  p_shop_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text,
  p_actor_user_id uuid default null,
  p_processor text default null,
  p_processor_session_id text default null,
  p_processor_payment_intent_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  o public.orders%rowtype;
  existing public.payments%rowtype;
  payment_row public.payments%rowtype;
  new_paid numeric(12,2);
  new_balance numeric(12,2);
  new_status text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;
  select * into o from public.orders where id=p_order_id and shop_id=p_shop_id for update;
  if not found then raise exception 'Order not found'; end if;
  select * into existing from public.payments where shop_id=p_shop_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('payment',to_jsonb(existing),'order',to_jsonb(o),'duplicate',true); end if;
  new_balance := greatest(0, coalesce(o.total,0)-coalesce(o.amount_paid,0));
  if p_amount > new_balance + 0.005 then raise exception 'Payment exceeds remaining balance'; end if;
  insert into public.payments(shop_id,order_id,customer_id,amount,method,status,processor,processor_session_id,processor_payment_intent_id,idempotency_key,received_by,metadata)
  values(p_shop_id,p_order_id,o.customer_id,round(p_amount,2),p_method,'SUCCEEDED',p_processor,p_processor_session_id,p_processor_payment_intent_id,p_idempotency_key,p_actor_user_id,coalesce(p_metadata,'{}'::jsonb))
  returning * into payment_row;
  new_paid := least(coalesce(o.total,0), coalesce(o.amount_paid,0)+round(p_amount,2));
  new_balance := greatest(0,coalesce(o.total,0)-new_paid);
  new_status := case when new_balance <= 0.005 then 'PAID' else 'PARTIAL' end;
  update public.orders set amount_paid=new_paid,balance_due=new_balance,payment_status=new_status,payment_method=p_method,paid_at=case when new_status='PAID' then coalesce(paid_at,now()) else null end
  where id=o.id returning * into o;
  insert into public.audit_events(shop_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_shop_id,p_actor_user_id,'payment.received','order',p_order_id::text,jsonb_build_object('payment_id',payment_row.id,'amount',p_amount,'method',p_method));
  return jsonb_build_object('payment',to_jsonb(payment_row),'order',to_jsonb(o),'duplicate',false);
end $$;
revoke all on function public.post_order_payment(uuid,uuid,numeric,text,text,uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.post_order_payment(uuid,uuid,numeric,text,text,uuid,text,text,text,jsonb) to service_role;
