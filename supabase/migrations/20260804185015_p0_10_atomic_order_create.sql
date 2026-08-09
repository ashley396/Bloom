-- P0-10: atomic order creation and database-enforced financial defaults.
--
-- Review gate: forward-only source migration. Do not apply to a hosted project
-- until the canonical prerequisite chain has passed twice on isolated staging.

-- Reconcile columns used by the production order handler. Several originated
-- in legacy root SQL files, so this migration cannot assume an empty project
-- received them through the executable supabase/migrations path.
alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists tax_rate numeric(7,3) default 0,
  add column if not exists amount_paid numeric(12,2) not null default 0,
  add column if not exists balance_due numeric(12,2) not null default 0,
  add column if not exists payment_status text not null default 'UNPAID',
  add column if not exists payment_method text,
  add column if not exists paid_at timestamptz,
  add column if not exists customer_type text default 'PERSONAL',
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text,
  add column if not exists delivery_window text,
  add column if not exists delivery_instructions text,
  add column if not exists delivery_miles numeric(10,1) not null default 0,
  add column if not exists drive_minutes numeric(10,1) not null default 0,
  add column if not exists order_source text,
  add column if not exists card_message text,
  add column if not exists arrangement_description text,
  add column if not exists location_type text,
  add column if not exists driver text,
  add column if not exists designer text,
  add column if not exists priority text not null default 'NORMAL',
  add column if not exists design_style text,
  add column if not exists color_palette text,
  add column if not exists preferred_flowers text,
  add column if not exists flower_restrictions text,
  add column if not exists addons text,
  add column if not exists labor_charge numeric(12,2) not null default 0,
  add column if not exists addon_total numeric(12,2) not null default 0,
  add column if not exists discount numeric(12,2) not null default 0,
  add column if not exists estimated_cost numeric(12,2) not null default 0,
  add column if not exists product_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.deliveries
  add column if not exists address text,
  add column if not exists round_trip_miles numeric(10,2) not null default 0,
  add column if not exists drive_minutes numeric(10,2) not null default 0,
  add column if not exists delivery_date date,
  add column if not exists delivery_window text,
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text;

create or replace function public.bloom_enforce_order_financial_integrity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.amount_paid := 0;
    new.balance_due := greatest(0, round(coalesce(new.total, 0), 2));
    new.payment_status := 'UNPAID';
    new.payment_method := null;
    new.paid_at := null;
    return new;
  end if;

  -- Only trusted database/service operations may append to the payment ledger.
  -- Ordinary authenticated updates always preserve the ledger and derive the
  -- balance from the authoritative total.
  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    if round(coalesce(new.total, 0), 2) + 0.005 < round(coalesce(old.amount_paid, 0), 2) then
      raise exception using
        errcode = '23514',
        message = 'Order total cannot be less than payments already recorded';
    end if;

    new.amount_paid := old.amount_paid;
    new.balance_due := greatest(0, round(coalesce(new.total, 0) - coalesce(old.amount_paid, 0), 2));
    new.payment_status := case
      when upper(coalesce(old.payment_status, 'UNPAID')) = 'REFUNDED' then 'REFUNDED'
      when new.balance_due <= 0.005 and coalesce(new.total, 0) > 0 then 'PAID'
      when coalesce(old.amount_paid, 0) > 0 then 'PARTIAL'
      else 'UNPAID'
    end;
    new.payment_method := old.payment_method;
    new.paid_at := case
      when new.payment_status = 'PAID' then coalesce(old.paid_at, now())
      else null
    end;
  end if;

  return new;
end;
$$;

revoke all privileges on function public.bloom_enforce_order_financial_integrity()
  from public, anon, authenticated, service_role;

drop trigger if exists bloom_orders_financial_integrity on public.orders;
create trigger bloom_orders_financial_integrity
before insert or update on public.orders
for each row execute function public.bloom_enforce_order_financial_integrity();

create or replace function public.create_order_atomic(
  p_shop_id uuid,
  p_order jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_claim_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    case
      when nullif(current_setting('request.jwt.claims', true), '') is not null
        then current_setting('request.jwt.claims', true)::jsonb->>'role'
      else null
    end,
    ''
  );
  v_order public.orders%rowtype;
  v_delivery public.deliveries%rowtype;
  v_recipe public.product_recipes%rowtype;
  v_stock public.inventory%rowtype;
  v_product_id uuid;
  v_fulfillment text;
  v_customer_name text;
  v_delivery_address text;
  v_flowers numeric(12,2);
  v_labor numeric(12,2);
  v_addons numeric(12,2);
  v_discount numeric(12,2);
  v_subtotal numeric(12,2);
  v_tax_rate numeric(7,3);
  v_tax numeric(12,2);
  v_delivery_fee numeric(12,2);
  v_total numeric(12,2);
  v_needed numeric(12,2);
  v_available numeric(12,2);
  v_wanted text;
  v_adjustments jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  if p_shop_id is null or p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception using errcode = '22023', message = 'A shop and order object are required';
  end if;

  if v_actor is null then
    if v_claim_role <> 'service_role' then
      raise exception using errcode = '42501', message = 'Authentication is required';
    end if;
  elsif not exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = p_shop_id
      and sm.user_id = v_actor
      and sm.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Shop access denied';
  end if;

  if p_order ?| array['shop_id','user_id','order_number','amount_paid','balance_due','payment_status','payment_method','paid_at'] then
    raise exception using errcode = '22023', message = 'Order contains server-controlled fields';
  end if;

  v_customer_name := btrim(coalesce(p_order->>'customer_name', ''));
  if v_customer_name = '' then
    raise exception using errcode = '22023', message = 'Customer name is required';
  end if;

  v_fulfillment := upper(coalesce(nullif(p_order->>'fulfillment', ''), 'PICKUP'));
  if v_fulfillment not in ('PICKUP', 'DELIVERY') then
    raise exception using errcode = '22023', message = 'Fulfillment must be PICKUP or DELIVERY';
  end if;
  v_delivery_address := nullif(btrim(coalesce(p_order->>'delivery_address', '')), '');
  if v_fulfillment = 'DELIVERY' and v_delivery_address is null then
    raise exception using errcode = '22023', message = 'Delivery address is required';
  end if;

  v_flowers := greatest(0, coalesce(nullif(p_order->>'subtotal', '')::numeric, 0));
  v_labor := greatest(0, coalesce(nullif(p_order->>'labor_charge', '')::numeric, 0));
  v_addons := greatest(0, coalesce(nullif(p_order->>'addon_total', '')::numeric, 0));
  v_discount := greatest(0, coalesce(nullif(p_order->>'discount', '')::numeric, 0));
  v_subtotal := greatest(0, round(v_flowers + v_labor + v_addons - v_discount, 2));
  v_tax_rate := greatest(0, least(100, coalesce(nullif(p_order->>'tax_rate', '')::numeric, 0)));
  v_tax := round(v_subtotal * (v_tax_rate / 100), 2);
  v_delivery_fee := greatest(0, round(coalesce(nullif(p_order->>'delivery_fee', '')::numeric, 0), 2));
  v_total := round(v_subtotal + v_tax + v_delivery_fee, 2);
  v_product_id := nullif(p_order->>'product_id', '')::uuid;

  insert into public.orders (
    user_id, shop_id, order_number, customer_id, customer_name,
    customer_phone, occasion, fulfillment, delivery_address, delivery_date,
    status, subtotal, tax, delivery_fee, total, notes, tax_rate,
    amount_paid, balance_due, payment_status, payment_method, customer_type,
    recipient_name, recipient_phone, delivery_window, delivery_instructions,
    delivery_miles, drive_minutes, order_source, card_message,
    arrangement_description, location_type, driver, designer, priority,
    design_style, color_palette, preferred_flowers, flower_restrictions,
    addons, labor_charge, addon_total, discount, estimated_cost, product_id,
    metadata
  ) values (
    v_actor, p_shop_id, 'BLM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    nullif(p_order->>'customer_id', '')::uuid, left(v_customer_name, 120),
    nullif(p_order->>'customer_phone', ''), nullif(p_order->>'occasion', ''),
    v_fulfillment, v_delivery_address, nullif(p_order->>'delivery_date', '')::date,
    'NEW', v_subtotal, v_tax, v_delivery_fee, v_total, nullif(p_order->>'notes', ''),
    v_tax_rate, 0, v_total, 'UNPAID', null,
    coalesce(nullif(p_order->>'customer_type', ''), 'PERSONAL'),
    nullif(p_order->>'recipient_name', ''), nullif(p_order->>'recipient_phone', ''),
    nullif(p_order->>'delivery_window', ''), nullif(p_order->>'delivery_instructions', ''),
    greatest(0, coalesce(nullif(p_order->>'delivery_miles', '')::numeric, 0)),
    greatest(0, coalesce(nullif(p_order->>'drive_minutes', '')::numeric, 0)),
    nullif(p_order->>'order_source', ''), nullif(p_order->>'card_message', ''),
    nullif(p_order->>'arrangement_description', ''), nullif(p_order->>'location_type', ''),
    nullif(p_order->>'driver', ''), nullif(p_order->>'designer', ''),
    coalesce(nullif(p_order->>'priority', ''), 'NORMAL'),
    nullif(p_order->>'design_style', ''), nullif(p_order->>'color_palette', ''),
    nullif(p_order->>'preferred_flowers', ''), nullif(p_order->>'flower_restrictions', ''),
    nullif(p_order->>'addons', ''), v_labor, v_addons, v_discount,
    greatest(0, coalesce(nullif(p_order->>'estimated_cost', '')::numeric, 0)),
    v_product_id, coalesce(p_order->'metadata', '{}'::jsonb)
  ) returning * into v_order;

  insert into public.order_status_history (
    shop_id, order_id, from_status, to_status, changed_by, note
  ) values (
    p_shop_id, v_order.id, null, v_order.status, v_actor, 'Order created'
  );

  insert into public.audit_events (
    shop_id, actor_user_id, event_type, entity_type, entity_id, metadata
  ) values (
    p_shop_id, v_actor, 'order_created', 'order', v_order.id::text,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'total', v_order.total,
      'payment_status', v_order.payment_status
    )
  );

  if v_fulfillment = 'DELIVERY' then
    insert into public.deliveries (
      shop_id, order_id, address, driver, status, notes, round_trip_miles,
      drive_minutes, delivery_date, delivery_window, recipient_name, recipient_phone
    ) values (
      p_shop_id, v_order.id, v_delivery_address, nullif(p_order->>'driver', ''),
      'PENDING', nullif(p_order->>'delivery_instructions', ''),
      greatest(0, coalesce(nullif(p_order->>'delivery_miles', '')::numeric, 0)),
      greatest(0, coalesce(nullif(p_order->>'drive_minutes', '')::numeric, 0)),
      nullif(p_order->>'delivery_date', '')::date, nullif(p_order->>'delivery_window', ''),
      nullif(p_order->>'recipient_name', ''), nullif(p_order->>'recipient_phone', '')
    ) returning * into v_delivery;
  end if;

  if v_product_id is not null then
    for v_recipe in
      select pr.*
      from public.product_recipes pr
      where pr.shop_id = p_shop_id and pr.product_id = v_product_id
      order by pr.id
    loop
      v_needed := greatest(0, coalesce(v_recipe.quantity, 0));
      if v_needed = 0 then
        continue;
      end if;

      if v_recipe.inventory_id is not null then
        select i.* into v_stock
        from public.inventory i
        where i.id = v_recipe.inventory_id
          and i.shop_id = p_shop_id
          and i.deleted_at is null
        for update;
      else
        v_wanted := btrim(regexp_replace(lower(coalesce(v_recipe.ingredient_name, '')), '[^a-z0-9]+', ' ', 'g'));
        select i.* into v_stock
        from public.inventory i
        where i.shop_id = p_shop_id
          and i.deleted_at is null
          and (
            btrim(regexp_replace(lower(coalesce(i.color, '') || ' ' || coalesce(i.name, '')), '[^a-z0-9]+', ' ', 'g')) = v_wanted
            or btrim(regexp_replace(lower(coalesce(i.name, '')), '[^a-z0-9]+', ' ', 'g')) = v_wanted
          )
        order by i.id
        limit 1
        for update;
      end if;

      if not found then
        v_warnings := v_warnings || jsonb_build_array(v_recipe.ingredient_name || ': not found in inventory');
        continue;
      end if;

      v_available := greatest(0, coalesce(v_stock.quantity, 0));
      if v_available + 0.0001 < v_needed then
        v_warnings := v_warnings || jsonb_build_array(
          v_stock.name || ': recipe needed ' || v_needed || ', but only ' || v_available || ' was available'
        );
        continue;
      end if;

      update public.inventory
      set quantity = quantity - v_needed
      where id = v_stock.id and shop_id = p_shop_id
      returning * into v_stock;

      v_adjustments := v_adjustments || jsonb_build_array(jsonb_build_object(
        'id', v_stock.id,
        'name', v_stock.name,
        'used', v_needed,
        'before', v_available,
        'after', v_stock.quantity,
        'unit', v_stock.unit
      ));
    end loop;
  end if;

  return jsonb_build_object(
    'item', to_jsonb(v_order),
    'delivery', case when v_delivery.id is null then null else to_jsonb(v_delivery) end,
    'inventoryAdjustments', v_adjustments,
    'inventoryWarnings', v_warnings
  );
end;
$$;

revoke all privileges on function public.create_order_atomic(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_order_atomic(uuid, jsonb)
  to authenticated, service_role;

-- Signed-in application clients must use create_order_atomic so the order and
-- its required operational side effects cannot be split across transactions.
revoke insert on table public.orders from authenticated;

notify pgrst, 'reload schema';
