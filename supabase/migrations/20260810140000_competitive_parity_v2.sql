-- Florisyn competitive parity v2: server quotes, recipe deduct on fulfill, wholesale order tracking

create table if not exists public.pos_quotes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  customer_id uuid references public.customers(id) on delete set null,
  note text,
  cart jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_quotes_shop_id_idx on public.pos_quotes (shop_id, updated_at desc);

alter table public.pos_quotes enable row level security;

drop policy if exists pos_quotes_shop_member on public.pos_quotes;
create policy pos_quotes_shop_member on public.pos_quotes
  for all
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

revoke all on table public.pos_quotes from anon;
grant select, insert, update, delete on table public.pos_quotes to authenticated;
grant all on table public.pos_quotes to service_role;

-- Optional: skip recipe deduction at order create when shop defers to fulfill time
create or replace function public.create_order_atomic(p_shop_id uuid, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_delivery public.deliveries%rowtype;
  v_customer_name text;
  v_fulfillment text;
  v_delivery_address text;
  v_subtotal numeric(12,2);
  v_tax numeric(12,2);
  v_delivery_fee numeric(12,2);
  v_total numeric(12,2);
  v_tax_rate numeric(7,3);
  v_labor numeric(12,2);
  v_addons numeric(12,2);
  v_discount numeric(12,2);
  v_product_id uuid;
  v_recipe record;
  v_stock record;
  v_needed numeric;
  v_available numeric;
  v_wanted text;
  v_adjustments jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_skip_recipe boolean := coalesce((p_order->>'skip_recipe_deduction')::boolean, false);
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not public.is_shop_member(p_shop_id) then
    raise exception using errcode = '42501', message = 'Shop membership required';
  end if;

  v_customer_name := coalesce(nullif(btrim(p_order->>'customer_name'), ''), 'Walk-in Customer');
  v_fulfillment := case when upper(coalesce(p_order->>'fulfillment', 'PICKUP')) = 'DELIVERY' then 'DELIVERY' else 'PICKUP' end;
  v_delivery_address := nullif(p_order->>'delivery_address', '');
  v_labor := greatest(0, coalesce(nullif(p_order->>'labor_charge', '')::numeric, 0));
  v_addons := greatest(0, coalesce(nullif(p_order->>'addon_total', '')::numeric, 0));
  v_discount := greatest(0, coalesce(nullif(p_order->>'discount', '')::numeric, 0));
  v_subtotal := greatest(0, round(coalesce(nullif(p_order->>'subtotal', '')::numeric, 0) + v_labor + v_addons - v_discount, 2));
  v_tax_rate := greatest(0, coalesce(nullif(p_order->>'tax_rate', '')::numeric, 0));
  v_tax := greatest(0, round(v_subtotal * (v_tax_rate / 100), 2));
  v_delivery_fee := greatest(0, coalesce(nullif(p_order->>'delivery_fee', '')::numeric, 0));
  v_total := greatest(0, round(v_subtotal + v_tax + v_delivery_fee, 2));
  v_product_id := nullif(p_order->>'product_id', '')::uuid;

  insert into public.orders (
    user_id, shop_id, order_number, customer_id, customer_name, customer_phone, occasion,
    fulfillment, delivery_address, delivery_date, status, subtotal, tax, delivery_fee, total,
    notes, tax_rate, amount_paid, balance_due, payment_status, payment_method, customer_type,
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
    'PENDING', v_subtotal, v_tax, v_delivery_fee, v_total, nullif(p_order->>'notes', ''),
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

  if not v_skip_recipe and v_product_id is not null then
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

notify pgrst, 'reload schema';
