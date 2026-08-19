-- P0-13: consolidate closed-beta RLS and close self-enrollment/onboarding gaps.
--
-- The Supabase CLI binary crashes with SIGTRAP in the current sandbox, so this
-- uniquely versioned shell was created locally after the required CLI attempt.
-- Forward-only source migration; hosted apply requires the reviewed production
-- preflight, persistent staging rehearsal, backup/PITR gate, and Ashley's approval.

-- Manager authorization is deliberately separate from owner-only membership
-- administration. Legacy role constraints use `manager`; some older databases
-- may also contain `admin`, so both are accepted for management operations.
create or replace function public.user_can_manage_shop(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    target_shop_id is not null
    and exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = target_shop_id
        and sm.user_id = auth.uid()
        and coalesce(sm.status, 'active') = 'active'
        and coalesce(sm.role, 'staff') in ('owner', 'manager', 'admin')
    );
$$;

revoke all privileges on function public.user_can_manage_shop(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.user_can_manage_shop(uuid)
  to authenticated, service_role;

-- Keep the signup trigger compatible with the production shops shape. Both
-- owner columns are populated and membership is explicitly active.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_shop_id uuid;
begin
  insert into public.shops (owner_user_id, owner_id, name)
  values (
    new.id,
    new.id,
    coalesce(new.raw_user_meta_data->>'shop_name', 'My Flower Shop')
  )
  returning id into new_shop_id;

  insert into public.profiles (id, full_name, default_shop_id)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new_shop_id);

  insert into public.shop_members (shop_id, user_id, role, status)
  values (new_shop_id, new.id, 'owner', 'active');

  return new;
end;
$$;

revoke all privileges on function public.handle_new_user()
  from public, anon, authenticated, service_role;

-- Onboarding is one atomic database boundary. It replaces the legacy endpoint's
-- seven independent writes and fixes the live owner_id/owner_user_id mismatch.
create or replace function public.complete_florist_onboarding(
  p_shop_name text,
  p_full_name text default null,
  p_phone text default null,
  p_email text default null,
  p_website text default null,
  p_address_line_1 text default null,
  p_address_line_2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_timezone text default 'America/New_York',
  p_tax_rate numeric default 0,
  p_delivery_fee numeric default 0,
  p_receipt_header text default null,
  p_shop_tone text default 'warm, capable, florist-friendly',
  p_delivery_notes text default null,
  p_marketing_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_shop_id uuid;
  v_shop_slug text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'You must be signed in.';
  end if;
  if nullif(btrim(p_shop_name), '') is null then
    raise exception using errcode = '22023', message = 'Shop name is required.';
  end if;
  if coalesce(p_tax_rate, 0) < 0 or coalesce(p_tax_rate, 0) > 100 then
    raise exception using errcode = '22023', message = 'Tax rate must be between 0 and 100.';
  end if;
  if coalesce(p_delivery_fee, 0) < 0 then
    raise exception using errcode = '22023', message = 'Delivery fee cannot be negative.';
  end if;

  select profile.default_shop_id
    into v_shop_id
  from public.profiles profile
  where profile.id = v_user_id;

  if v_shop_id is null then
    v_shop_slug := trim(both '-' from regexp_replace(lower(p_shop_name), '[^a-z0-9]+', '-', 'g'))
      || '-' || left(v_user_id::text, 6);

    insert into public.shops (
      name, slug, owner_user_id, owner_id, onboarding_complete, phone, email,
      website, address_line_1, address_line_2, city, state, postal_code,
      timezone, tax_rate, default_delivery_fee, receipt_header
    ) values (
      btrim(p_shop_name), v_shop_slug, v_user_id, v_user_id, true, p_phone, p_email,
      p_website, p_address_line_1, p_address_line_2, p_city, p_state,
      p_postal_code, coalesce(nullif(p_timezone, ''), 'America/New_York'),
      coalesce(p_tax_rate, 0), coalesce(p_delivery_fee, 0),
      coalesce(nullif(p_receipt_header, ''), btrim(p_shop_name))
    ) returning id into v_shop_id;

    insert into public.shop_members (shop_id, user_id, role, status)
    values (v_shop_id, v_user_id, 'owner', 'active');

    insert into public.profiles (id, full_name, default_shop_id)
    values (v_user_id, p_full_name, v_shop_id)
    on conflict (id) do update
      set full_name = coalesce(excluded.full_name, public.profiles.full_name),
          default_shop_id = excluded.default_shop_id,
          updated_at = now();

    insert into public.shop_subscriptions (shop_id, plan_code, status, trial_ends_at)
    values (v_shop_id, 'trial', 'trialing', now() + interval '14 days')
    on conflict do nothing;

    insert into public.ai_shop_profiles (
      shop_id, lily_enabled, rose_enabled, shop_tone,
      delivery_notes, marketing_notes
    ) values (
      v_shop_id, true, true,
      coalesce(p_shop_tone, 'warm, capable, florist-friendly'),
      p_delivery_notes, p_marketing_notes
    ) on conflict do nothing;

    insert into public.shop_settings (
      shop_id, tax_rate, default_delivery_fee, timezone, currency, receipt_header
    ) values (
      v_shop_id, coalesce(p_tax_rate, 0), coalesce(p_delivery_fee, 0),
      coalesce(nullif(p_timezone, ''), 'America/New_York'), 'USD',
      coalesce(nullif(p_receipt_header, ''), btrim(p_shop_name))
    ) on conflict do nothing;

    for day_index in 0..6 loop
      insert into public.shop_hours (shop_id, weekday, is_closed, opens_at, closes_at)
      values (
        v_shop_id,
        day_index,
        day_index = 0,
        case when day_index = 0 then null else time '09:00' end,
        case when day_index = 0 then null else time '17:00' end
      );
    end loop;
  else
    if not public.user_can_manage_shop(v_shop_id) then
      raise exception using errcode = '42501', message = 'Only an owner or manager can complete setup.';
    end if;

    update public.shops
    set name = btrim(p_shop_name),
        onboarding_complete = true,
        phone = p_phone,
        email = p_email,
        website = p_website,
        address_line_1 = p_address_line_1,
        address_line_2 = p_address_line_2,
        city = p_city,
        state = p_state,
        postal_code = p_postal_code,
        timezone = coalesce(nullif(p_timezone, ''), timezone),
        tax_rate = coalesce(p_tax_rate, tax_rate),
        default_delivery_fee = coalesce(p_delivery_fee, default_delivery_fee),
        receipt_header = coalesce(nullif(p_receipt_header, ''), receipt_header),
        updated_at = now()
    where id = v_shop_id;
  end if;

  insert into public.audit_events (
    shop_id, actor_user_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_shop_id, v_user_id, 'shop.onboarding_completed', 'shop', v_shop_id::text,
    jsonb_build_object('source', 'complete_florist_onboarding')
  );

  return v_shop_id;
end;
$$;

revoke all privileges on function public.complete_florist_onboarding(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_florist_onboarding(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, text, text, text, text
) to authenticated, service_role;

-- Additional-shop creation remains behind the Netlify server-key gate. The
-- database operation is service-role-only and creates the shop plus owner
-- membership atomically.
create or replace function public.create_additional_shop_atomic(
  p_owner_id uuid,
  p_shop jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claim_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    case
      when nullif(current_setting('request.jwt.claims', true), '') is not null
        then current_setting('request.jwt.claims', true)::jsonb->>'role'
      else null
    end,
    ''
  );
  v_shop public.shops%rowtype;
begin
  if v_claim_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization is required';
  end if;
  if p_owner_id is null or p_shop is null or jsonb_typeof(p_shop) <> 'object' then
    raise exception using errcode = '22023', message = 'An owner and shop object are required';
  end if;
  if not exists (select 1 from auth.users where id = p_owner_id) then
    raise exception using errcode = '23503', message = 'Owner account does not exist';
  end if;
  if nullif(btrim(p_shop->>'name'), '') is null then
    raise exception using errcode = '22023', message = 'Shop name is required';
  end if;

  insert into public.shops (owner_id, owner_user_id, name, phone, email, address)
  values (
    p_owner_id,
    p_owner_id,
    left(btrim(p_shop->>'name'), 160),
    nullif(p_shop->>'phone', ''),
    nullif(p_shop->>'email', ''),
    nullif(p_shop->>'address', '')
  ) returning * into v_shop;

  insert into public.shop_members (shop_id, user_id, role, status)
  values (v_shop.id, p_owner_id, 'owner', 'active');

  return to_jsonb(v_shop);
end;
$$;

revoke all privileges on function public.create_additional_shop_atomic(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_additional_shop_atomic(uuid, jsonb)
  to service_role;

-- Remove every historical policy from the closed-beta tables before creating
-- the single reviewed policy set. This is intentionally dynamic so obsolete
-- policy names cannot survive on drifted production databases.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'customers','orders','inventory','expenses','products','product_recipes',
        'deliveries','suppliers','payments','order_status_history','audit_events',
        'staff','staff_time_entries','shops','shop_members','profiles',
        'shop_subscriptions','ai_shop_profiles','shop_hours','shop_settings'
      ])
  loop
    execute format('drop policy %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end
$$;

create policy "customers active shop access" on public.customers
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy "orders active shop select" on public.orders
  for select to authenticated using (public.is_shop_member(shop_id));
create policy "orders active shop update" on public.orders
  for update to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
create policy "orders active shop delete" on public.orders
  for delete to authenticated using (public.is_shop_member(shop_id));

create policy "inventory active shop access" on public.inventory
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
create policy "expenses active shop access" on public.expenses
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
create policy "products active shop access" on public.products
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
create policy "recipes active shop access" on public.product_recipes
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
create policy "deliveries active shop access" on public.deliveries
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
create policy "suppliers active shop access" on public.suppliers
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy "payments active shop select" on public.payments
  for select to authenticated using (public.is_shop_member(shop_id));
create policy "history active shop select" on public.order_status_history
  for select to authenticated using (public.is_shop_member(shop_id));
create policy "history active shop insert" on public.order_status_history
  for insert to authenticated with check (public.is_shop_member(shop_id));
create policy "audit active shop select" on public.audit_events
  for select to authenticated using (public.is_shop_member(shop_id));
create policy "audit active shop insert" on public.audit_events
  for insert to authenticated with check (public.is_shop_member(shop_id));

create policy "shops active member select" on public.shops
  for select to authenticated
  using (public.is_shop_member(id) or owner_id = auth.uid() or owner_user_id = auth.uid());
create policy "shops active manager update" on public.shops
  for update to authenticated
  using (public.user_can_manage_shop(id))
  with check (public.user_can_manage_shop(id));

create policy "members self or owner select" on public.shop_members
  for select to authenticated
  using (user_id = auth.uid() or public.user_is_shop_owner(shop_id));
create policy "members owner insert" on public.shop_members
  for insert to authenticated with check (public.user_is_shop_owner(shop_id));
create policy "members owner update" on public.shop_members
  for update to authenticated
  using (public.user_is_shop_owner(shop_id))
  with check (public.user_is_shop_owner(shop_id));
create policy "members owner delete" on public.shop_members
  for delete to authenticated using (public.user_is_shop_owner(shop_id));

create policy "profiles own select" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles own update" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "subscriptions active shop select" on public.shop_subscriptions
  for select to authenticated using (public.is_shop_member(shop_id));
create policy "ai profile active shop select" on public.ai_shop_profiles
  for select to authenticated using (public.is_shop_member(shop_id));
create policy "ai profile manager update" on public.ai_shop_profiles
  for update to authenticated
  using (public.user_can_manage_shop(shop_id))
  with check (public.user_can_manage_shop(shop_id));
create policy "shop hours active shop select" on public.shop_hours
  for select to authenticated using (public.is_shop_member(shop_id));
create policy "shop hours manager access" on public.shop_hours
  for all to authenticated
  using (public.user_can_manage_shop(shop_id))
  with check (public.user_can_manage_shop(shop_id));

-- Staff and time entries intentionally receive no browser policy. Their route
-- verifies owner/manager and uses the server client without exposing PIN hashes.

-- Restate the exact table boundary after policy replacement.
revoke all privileges on table
  public.customers, public.orders, public.inventory, public.expenses,
  public.products, public.product_recipes, public.deliveries, public.suppliers,
  public.payments, public.order_status_history, public.audit_events,
  public.staff, public.staff_time_entries, public.shops, public.shop_members,
  public.profiles, public.shop_subscriptions, public.ai_shop_profiles,
  public.shop_hours, public.shop_settings
from anon;

revoke insert on table public.orders from authenticated;
revoke all privileges on table public.staff, public.staff_time_entries from authenticated;
revoke all privileges on table public.shop_settings from authenticated;

notify pgrst, 'reload schema';
