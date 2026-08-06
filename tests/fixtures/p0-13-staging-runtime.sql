-- Appended after the P0-12 runtime matrix and before its final ROLLBACK.

reset role;

do $$
declare
  n bigint;
begin
  select count(*) into n
  from pg_policies
  where schemaname = 'public'
    and tablename = any(array[
      'customers','orders','inventory','expenses','products','product_recipes',
      'deliveries','suppliers','payments','order_status_history','audit_events',
      'staff','staff_time_entries','shops','shop_members','profiles',
      'shop_subscriptions','ai_shop_profiles','shop_hours'
    ]);
  if n <> 28 then raise exception 'expected 28 consolidated policies, found %', n; end if;

  select count(*) into n
  from pg_policies
  where schemaname = 'public'
    and 'public' = any(roles)
    and tablename = any(array[
      'customers','orders','inventory','expenses','products','product_recipes',
      'deliveries','suppliers','payments','order_status_history','audit_events',
      'staff','staff_time_entries','shops','shop_members','profiles',
      'shop_subscriptions','ai_shop_profiles','shop_hours'
    ]);
  if n <> 0 then raise exception 'PUBLIC policies survived consolidation: %', n; end if;

  if has_function_privilege('authenticated', 'public.create_additional_shop_atomic(uuid,jsonb)', 'EXECUTE') then
    raise exception 'authenticated can execute server-only add-shop RPC';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.shop_settings'::regclass) then
    raise exception 'shop_settings RLS is disabled';
  end if;
  if has_table_privilege('anon', 'public.shop_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.shop_settings', 'SELECT') then
    raise exception 'shop_settings is directly exposed';
  end if;
end
$$;

-- An active manager can update its own shop but cannot self-enroll elsewhere.
insert into public.shop_members (shop_id, user_id, role, status)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'manager',
  'active'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare n bigint;
begin
  update public.shops set tagline = 'Manager verified'
  where id = '10000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'active manager could not update own shop'; end if;

  begin
    insert into public.shop_members (shop_id, user_id, role, status)
    values (
      '10000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000004',
      'owner',
      'active'
    );
    raise exception 'cross-shop self-enrollment unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- A user with no profile/shop can complete the full onboarding operation once.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
do $$
declare
  created_shop uuid;
  n bigint;
begin
  created_shop := public.complete_florist_onboarding(
    'P0-13 Atomic Onboarding', 'P0-13 User', '555-0100',
    'p013-onboarding@example.invalid', null, '1 Test Way', null,
    'Testville', 'KY', '40000', 'America/New_York', 6, 12,
    'P0-13 Atomic Onboarding', 'warm', null, null
  );

  select count(*) into n from public.shop_members
  where shop_id = created_shop and user_id = '00000000-0000-0000-0000-000000000005'
    and role = 'owner' and status = 'active';
  if n <> 1 then raise exception 'atomic onboarding membership missing'; end if;
  select count(*) into n from public.shop_hours where shop_id = created_shop;
  if n <> 7 then raise exception 'atomic onboarding hours %', n; end if;
  select count(*) into n from public.audit_events
  where shop_id = created_shop and event_type = 'shop.onboarding_completed';
  if n <> 1 then raise exception 'atomic onboarding audit %', n; end if;
end
$$;

-- The additional-shop RPC is service-only and commits both required rows.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
  result jsonb;
  created_shop uuid;
  n bigint;
begin
  result := public.create_additional_shop_atomic(
    '00000000-0000-0000-0000-000000000001',
    '{"name":"P0-13 Additional Shop","phone":"555-0130"}'::jsonb
  );
  created_shop := (result->>'id')::uuid;
  select count(*) into n from public.shop_members
  where shop_id = created_shop
    and user_id = '00000000-0000-0000-0000-000000000001'
    and role = 'owner' and status = 'active';
  if n <> 1 then raise exception 'atomic additional-shop membership missing'; end if;
end
$$;

reset role;
select jsonb_build_object(
  'status', 'passed',
  'policies', 28,
  'public_policies', 0,
  'self_enrollment', 'denied',
  'manager_update', 'allowed',
  'onboarding', 'atomic',
  'additional_shop', 'service_atomic'
) as p0_13_result;

rollback;
