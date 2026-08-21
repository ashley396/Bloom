-- Florisyn pre-launch QA pass: the signup form (auth-signup.js) already
-- collects business_phone/business_address/business_city/business_state/
-- business_zip and sends every one of them to Supabase Auth as user
-- metadata (raw_user_meta_data) — but handle_new_user(), the trigger that
-- actually creates the new shop row, only ever read shop_name and
-- full_name out of that metadata. Everything else the florist just typed
-- was silently discarded the moment the account was created — a real
-- "data the user provided vanishes" bug, not a missing feature: the data
-- was already collected and already in hand, just never written down.
--
-- Purely additive: existing shops are untouched, and a signup that omits
-- any of these fields behaves exactly as before (nullif keeps blanks as
-- SQL null, same as the columns' own default).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_shop_id uuid;
begin
  insert into public.shops (
    owner_user_id, owner_id, name,
    phone, address_line_1, city, state, postal_code
  )
  values (
    new.id,
    new.id,
    coalesce(new.raw_user_meta_data->>'shop_name', 'My Flower Shop'),
    nullif(btrim(new.raw_user_meta_data->>'business_phone'), ''),
    nullif(btrim(new.raw_user_meta_data->>'business_address'), ''),
    nullif(btrim(new.raw_user_meta_data->>'business_city'), ''),
    nullif(btrim(new.raw_user_meta_data->>'business_state'), ''),
    nullif(btrim(new.raw_user_meta_data->>'business_zip'), '')
  )
  returning id into new_shop_id;

  insert into public.profiles (id, full_name, default_shop_id)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new_shop_id);

  insert into public.shop_members (shop_id, user_id, role, status)
  values (new_shop_id, new.id, 'owner', 'active');

  return new;
end;
$$;
