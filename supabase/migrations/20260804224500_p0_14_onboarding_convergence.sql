-- P0-14: make Auth-triggered default shops converge to the complete onboarding state.
--
-- Real HTTP staging proof showed that handle_new_user() creates a profile and
-- default shop before this RPC runs. The prior existing-shop branch updated the
-- shop but skipped its subscription, AI profile, settings, and seven hours.

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

  insert into public.shop_members (shop_id, user_id, role, status)
  values (v_shop_id, v_user_id, 'owner', 'active')
  on conflict (shop_id, user_id) do nothing;

  insert into public.profiles (id, full_name, default_shop_id)
  values (v_user_id, p_full_name, v_shop_id)
  on conflict (id) do update
    set full_name = coalesce(excluded.full_name, public.profiles.full_name),
        default_shop_id = excluded.default_shop_id,
        updated_at = now();

  insert into public.shop_subscriptions (shop_id, plan_code, status, trial_ends_at)
  values (v_shop_id, 'trial', 'trialing', now() + interval '14 days')
  on conflict (shop_id) do nothing;

  insert into public.ai_shop_profiles (
    shop_id, lily_enabled, rose_enabled, shop_tone, delivery_notes, marketing_notes
  ) values (
    v_shop_id, true, true,
    coalesce(p_shop_tone, 'warm, capable, florist-friendly'),
    p_delivery_notes, p_marketing_notes
  )
  on conflict (shop_id) do update
    set shop_tone = excluded.shop_tone,
        delivery_notes = excluded.delivery_notes,
        marketing_notes = excluded.marketing_notes,
        updated_at = now();

  insert into public.shop_settings (
    shop_id, tax_rate, default_delivery_fee, timezone, currency, receipt_header
  ) values (
    v_shop_id, coalesce(p_tax_rate, 0), coalesce(p_delivery_fee, 0),
    coalesce(nullif(p_timezone, ''), 'America/New_York'), 'USD',
    coalesce(nullif(p_receipt_header, ''), btrim(p_shop_name))
  )
  on conflict (shop_id) do update
    set tax_rate = excluded.tax_rate,
        default_delivery_fee = excluded.default_delivery_fee,
        timezone = excluded.timezone,
        currency = excluded.currency,
        receipt_header = excluded.receipt_header,
        updated_at = now();

  for day_index in 0..6 loop
    insert into public.shop_hours (shop_id, weekday, is_closed, opens_at, closes_at)
    values (
      v_shop_id,
      day_index,
      day_index = 0,
      case when day_index = 0 then null else time '09:00' end,
      case when day_index = 0 then null else time '17:00' end
    )
    on conflict (shop_id, weekday) do nothing;
  end loop;

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

notify pgrst, 'reload schema';
