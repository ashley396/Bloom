-- Appended after the complete executable migration chain.
-- The caller must send this as one statement batch; the final ROLLBACK is
-- mandatory so the isolated staging project returns to its empty state.

insert into public.shops (id, owner_user_id, owner_id, name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'P0-12 Shop A'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'P0-12 Shop B');

insert into public.shop_members (shop_id, user_id, role, status) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'owner', 'active'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'manager', 'suspended');

insert into public.profiles (id, full_name, default_shop_id) values
  ('00000000-0000-0000-0000-000000000001', 'P0-12 A', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002', 'P0-12 B', '10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003', 'P0-12 Suspended', '10000000-0000-0000-0000-000000000001');

insert into public.shop_subscriptions (shop_id, plan_code, status) values
  ('10000000-0000-0000-0000-000000000001', 'trial', 'trialing'),
  ('10000000-0000-0000-0000-000000000002', 'trial', 'trialing');
insert into public.ai_shop_profiles (shop_id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');
insert into public.shop_hours (shop_id, weekday, is_closed) values
  ('10000000-0000-0000-0000-000000000001', 1, false),
  ('10000000-0000-0000-0000-000000000002', 1, false);

insert into public.customers (id, shop_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A Customer'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'B Customer');
insert into public.inventory (id, shop_id, name, quantity) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A Rose', 10),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'B Rose', 10);
insert into public.expenses (id, shop_id, category, amount) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A Expense', 10),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'B Expense', 10);
insert into public.products (id, shop_id, name) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A Product'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'B Product');
insert into public.product_recipes (id, shop_id, product_id, inventory_id, ingredient_name) values
  ('51000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'A Rose'),
  ('51000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'B Rose');
insert into public.suppliers (id, shop_id, name) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A Supplier'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'B Supplier');
insert into public.orders (id, shop_id, order_number, customer_name, total) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'P012-A', 'A Customer', 25),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'P012-B', 'B Customer', 25);
insert into public.deliveries (id, shop_id, order_id, address) values
  ('71000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'A Address'),
  ('71000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'B Address');
insert into public.payments (id, shop_id, order_id, amount, method, idempotency_key) values
  ('72000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 5, 'Cash', 'p012-a'),
  ('72000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 5, 'Cash', 'p012-b');
insert into public.order_status_history (shop_id, order_id, to_status) values
  ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'NEW'),
  ('10000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'NEW');
insert into public.audit_events (shop_id, event_type) values
  ('10000000-0000-0000-0000-000000000001', 'p012_seed'),
  ('10000000-0000-0000-0000-000000000002', 'p012_seed');
insert into public.staff (id, shop_id, name, pin_hash) values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A Staff', 'must-not-leak'),
  ('80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'B Staff', 'must-not-leak');
insert into public.staff_time_entries (shop_id, staff_id) values
  ('10000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002');

-- Catalog contract: all release tables use RLS; staff is service-only; the
-- ordinary order table has no authenticated INSERT privilege.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'customers','orders','inventory','expenses','products','product_recipes',
    'deliveries','suppliers','payments','order_status_history','audit_events',
    'staff','staff_time_entries','shops','shop_members','profiles',
    'shop_subscriptions','ai_shop_profiles','shop_hours'
  ] loop
    if not coalesce((
      select c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name
    ), false) then
      raise exception 'RLS missing for %', table_name;
    end if;
    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
       or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
       or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then
      raise exception 'anonymous privilege leaked for %', table_name;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.staff', 'SELECT')
     or has_table_privilege('authenticated', 'public.staff_time_entries', 'SELECT') then
    raise exception 'staff data exposed to authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.orders', 'INSERT') then
    raise exception 'direct authenticated order insert is still available';
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null
     and (
       has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE')
     ) then
    raise exception 'RLS event trigger still has Data API execution grants';
  end if;
end
$$;

-- Shop A can see exactly its own row in each browser-reachable domain.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare n bigint;
begin
  select count(*) into n from public.customers; if n <> 1 then raise exception 'A customers %', n; end if;
  select count(*) into n from public.orders; if n <> 1 then raise exception 'A orders %', n; end if;
  select count(*) into n from public.inventory; if n <> 1 then raise exception 'A inventory %', n; end if;
  select count(*) into n from public.expenses; if n <> 1 then raise exception 'A expenses %', n; end if;
  select count(*) into n from public.products; if n <> 1 then raise exception 'A products %', n; end if;
  select count(*) into n from public.product_recipes; if n <> 1 then raise exception 'A recipes %', n; end if;
  select count(*) into n from public.deliveries; if n <> 1 then raise exception 'A deliveries %', n; end if;
  select count(*) into n from public.suppliers; if n <> 1 then raise exception 'A suppliers %', n; end if;
  select count(*) into n from public.payments; if n <> 1 then raise exception 'A payments %', n; end if;
  select count(*) into n from public.order_status_history; if n <> 1 then raise exception 'A history %', n; end if;
  select count(*) into n from public.audit_events; if n <> 1 then raise exception 'A audit %', n; end if;
  select count(*) into n from public.shops; if n <> 1 then raise exception 'A shops %', n; end if;
  select count(*) into n from public.shop_members; if n <> 2 then raise exception 'A memberships %', n; end if;
  select count(*) into n from public.shop_subscriptions; if n <> 1 then raise exception 'A subscriptions %', n; end if;
  select count(*) into n from public.ai_shop_profiles; if n <> 1 then raise exception 'A ai profile %', n; end if;
  select count(*) into n from public.shop_hours; if n <> 1 then raise exception 'A hours %', n; end if;

  begin
    insert into public.customers (shop_id, name)
    values ('10000000-0000-0000-0000-000000000002', 'Forbidden');
    raise exception 'cross-shop customer insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  update public.customers set notes = 'forbidden'
  where id = '20000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'cross-shop customer update affected % rows', n; end if;

  begin
    insert into public.orders (shop_id, order_number, customer_name)
    values ('10000000-0000-0000-0000-000000000001', 'FORBIDDEN-DIRECT', 'Direct');
    raise exception 'direct order insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.payments (shop_id, order_id, amount, method, idempotency_key)
    values ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, 'Cash', 'forbidden');
    raise exception 'direct payment insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform count(*) from public.staff;
    raise exception 'direct staff read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  perform public.create_order_atomic(
    '10000000-0000-0000-0000-000000000001',
    '{"customer_name":"A RPC","subtotal":20,"fulfillment":"PICKUP"}'::jsonb
  );
  begin
    perform public.create_order_atomic(
      '10000000-0000-0000-0000-000000000002',
      '{"customer_name":"Cross Shop","subtotal":20,"fulfillment":"PICKUP"}'::jsonb
    );
    raise exception 'cross-shop order RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- Shop B sees its own rows, including after Shop A's RPC activity.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
declare n bigint;
begin
  select count(*) into n from public.customers; if n <> 1 then raise exception 'B customers %', n; end if;
  select count(*) into n from public.orders; if n <> 1 then raise exception 'B orders %', n; end if;
  select count(*) into n from public.inventory; if n <> 1 then raise exception 'B inventory %', n; end if;
  select count(*) into n from public.expenses; if n <> 1 then raise exception 'B expenses %', n; end if;
  select count(*) into n from public.products; if n <> 1 then raise exception 'B products %', n; end if;
  select count(*) into n from public.product_recipes; if n <> 1 then raise exception 'B recipes %', n; end if;
  select count(*) into n from public.deliveries; if n <> 1 then raise exception 'B deliveries %', n; end if;
  select count(*) into n from public.suppliers; if n <> 1 then raise exception 'B suppliers %', n; end if;
  select count(*) into n from public.payments; if n <> 1 then raise exception 'B payments %', n; end if;
  select count(*) into n from public.order_status_history; if n <> 1 then raise exception 'B history %', n; end if;
  select count(*) into n from public.audit_events; if n <> 1 then raise exception 'B audit %', n; end if;
  select count(*) into n from public.shops; if n <> 1 then raise exception 'B shops %', n; end if;
  select count(*) into n from public.shop_members; if n <> 1 then raise exception 'B memberships %', n; end if;
  select count(*) into n from public.shop_subscriptions; if n <> 1 then raise exception 'B subscriptions %', n; end if;
  select count(*) into n from public.ai_shop_profiles; if n <> 1 then raise exception 'B ai profile %', n; end if;
  select count(*) into n from public.shop_hours; if n <> 1 then raise exception 'B hours %', n; end if;
end
$$;

-- A suspended member cannot read or write Shop A data.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
do $$
declare n bigint;
begin
  select count(*) into n from public.customers; if n <> 0 then raise exception 'suspended customers %', n; end if;
  select count(*) into n from public.orders; if n <> 0 then raise exception 'suspended orders %', n; end if;
  select count(*) into n from public.inventory; if n <> 0 then raise exception 'suspended inventory %', n; end if;
  select count(*) into n from public.payments; if n <> 0 then raise exception 'suspended payments %', n; end if;
  begin
    insert into public.inventory (shop_id, name)
    values ('10000000-0000-0000-0000-000000000001', 'Forbidden suspended');
    raise exception 'suspended insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.customers;
    raise exception 'anonymous customer read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

select jsonb_build_object(
  'status', 'passed',
  'release_tables', 19,
  'shop_a_runtime_domains', 15,
  'shop_b_runtime_domains', 15,
  'suspended_denials', 5,
  'anonymous_denials', 1,
  'staff_direct_access', 'denied',
  'order_insert', 'rpc_only',
  'payment_write', 'server_only'
) as p0_12_result;

rollback;
