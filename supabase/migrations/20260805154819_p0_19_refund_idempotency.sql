-- P0-19: atomic, idempotent payment refunds.

alter table public.payment_hub_refunds
  add column if not exists idempotency_key text,
  add column if not exists updated_at timestamptz not null default now();

update public.payment_hub_refunds
set idempotency_key = 'legacy:' || id::text
where idempotency_key is null or btrim(idempotency_key) = '';

alter table public.payment_hub_refunds
  alter column idempotency_key set not null;

create unique index if not exists payment_hub_refunds_shop_idempotency_uidx
  on public.payment_hub_refunds (shop_id, idempotency_key);

create unique index if not exists payment_hub_refunds_provider_ref_uidx
  on public.payment_hub_refunds (provider_id, provider_ref)
  where provider_ref is not null;

drop policy if exists "payment hub refunds shop access" on public.payment_hub_refunds;
drop policy if exists "refunds tenant read" on public.payment_hub_refunds;
create policy "refunds tenant read"
  on public.payment_hub_refunds
  for select
  to authenticated
  using ((select public.is_shop_member(shop_id)));

revoke insert, update, delete on public.payment_hub_refunds from anon, authenticated;
grant select on public.payment_hub_refunds to authenticated;

create or replace function public.reserve_payment_refund(
  p_shop_id uuid,
  p_payment_id uuid,
  p_idempotency_key text,
  p_amount numeric,
  p_reason text,
  p_notes text,
  p_actor_user_id uuid,
  p_provider_id text default 'stripe'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.payments%rowtype;
  refund_row public.payment_hub_refunds%rowtype;
  reserved_amount numeric(12,2);
  requested_amount numeric(12,2);
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Refund idempotency key is required';
  end if;
  if length(p_idempotency_key) > 255 then
    raise exception 'Refund idempotency key is too long';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Refund amount must be greater than zero';
  end if;

  requested_amount := round(p_amount, 2);
  select * into payment_row
  from public.payments
  where id = p_payment_id and shop_id = p_shop_id
  for update;

  if not found then raise exception 'Payment not found'; end if;
  if payment_row.status not in ('SUCCEEDED', 'PARTIALLY_REFUNDED') then
    raise exception 'Payment is not refundable';
  end if;

  select * into refund_row
  from public.payment_hub_refunds
  where shop_id = p_shop_id and idempotency_key = btrim(p_idempotency_key);

  if found then
    if refund_row.payment_id is distinct from p_payment_id
       or refund_row.amount is distinct from requested_amount then
      raise exception 'Refund idempotency key conflicts with an existing request';
    end if;
    if refund_row.status = 'failed' then
      update public.payment_hub_refunds
      set status = 'pending', updated_at = now()
      where id = refund_row.id
      returning * into refund_row;
    end if;
    return jsonb_build_object('refund', to_jsonb(refund_row), 'duplicate', true);
  end if;

  select coalesce(sum(amount), 0) into reserved_amount
  from public.payment_hub_refunds
  where shop_id = p_shop_id
    and payment_id = p_payment_id
    and status in ('pending', 'completed');

  if requested_amount > payment_row.amount - reserved_amount + 0.005 then
    raise exception 'Refund exceeds remaining refundable balance';
  end if;

  insert into public.payment_hub_refunds (
    shop_id, provider_id, payment_id, amount, reason, notes, status,
    partial, actor_user_id, idempotency_key, metadata
  ) values (
    p_shop_id,
    coalesce(nullif(btrim(p_provider_id), ''), 'stripe'),
    p_payment_id,
    requested_amount,
    coalesce(nullif(btrim(p_reason), ''), 'customer_request'),
    nullif(btrim(p_notes), ''),
    'pending',
    requested_amount < payment_row.amount,
    p_actor_user_id,
    btrim(p_idempotency_key),
    jsonb_build_object('payment_intent_id', payment_row.processor_payment_intent_id)
  ) returning * into refund_row;

  return jsonb_build_object('refund', to_jsonb(refund_row), 'duplicate', false);
end;
$$;

create or replace function public.complete_payment_refund(
  p_shop_id uuid,
  p_refund_id uuid,
  p_provider_ref text,
  p_provider_status text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_row public.payment_hub_refunds%rowtype;
  payment_row public.payments%rowtype;
  new_refunded numeric(12,2);
begin
  select * into refund_row
  from public.payment_hub_refunds
  where id = p_refund_id and shop_id = p_shop_id
  for update;
  if not found then raise exception 'Refund reservation not found'; end if;
  if refund_row.status = 'completed' then
    return jsonb_build_object('refund', to_jsonb(refund_row), 'duplicate', true);
  end if;
  if refund_row.status <> 'pending' then raise exception 'Refund reservation is not pending'; end if;

  select * into payment_row from public.payments
  where id = refund_row.payment_id and shop_id = p_shop_id
  for update;
  if not found then raise exception 'Payment not found'; end if;

  new_refunded := round(coalesce(payment_row.refunded_amount, 0) + refund_row.amount, 2);
  if new_refunded > payment_row.amount + 0.005 then
    raise exception 'Refund completion exceeds payment amount';
  end if;

  update public.payments
  set refunded_amount = new_refunded,
      status = case when new_refunded >= amount - 0.005 then 'REFUNDED' else 'PARTIALLY_REFUNDED' end
  where id = payment_row.id;

  update public.payment_hub_refunds
  set provider_ref = p_provider_ref,
      status = 'completed',
      metadata = metadata || jsonb_build_object('provider_status', p_provider_status),
      updated_at = now()
  where id = refund_row.id
  returning * into refund_row;

  return jsonb_build_object('refund', to_jsonb(refund_row), 'duplicate', false);
end;
$$;

create or replace function public.fail_payment_refund(
  p_shop_id uuid,
  p_refund_id uuid,
  p_error_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_row public.payment_hub_refunds%rowtype;
begin
  update public.payment_hub_refunds
  set status = 'failed',
      metadata = metadata || jsonb_build_object('last_error_code', left(coalesce(p_error_code, 'provider_error'), 64)),
      updated_at = now()
  where id = p_refund_id and shop_id = p_shop_id and status = 'pending'
  returning * into refund_row;
  if not found then raise exception 'Pending refund reservation not found'; end if;
  return to_jsonb(refund_row);
end;
$$;

revoke all on function public.reserve_payment_refund(uuid,uuid,text,numeric,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.complete_payment_refund(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.fail_payment_refund(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_payment_refund(uuid,uuid,text,numeric,text,text,uuid,text) to service_role;
grant execute on function public.complete_payment_refund(uuid,uuid,text,text) to service_role;
grant execute on function public.fail_payment_refund(uuid,uuid,text) to service_role;
