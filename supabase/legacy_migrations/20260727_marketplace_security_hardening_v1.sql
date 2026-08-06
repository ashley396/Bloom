-- Marketplace verification security hardening (review before apply).
-- Tightens SECURITY DEFINER functions and revokes anon execute where appropriate.

alter function public.is_shop_member(uuid) set search_path = public;
revoke all on function public.is_shop_member(uuid) from anon;
revoke all on function public.is_shop_member(uuid) from public;
grant execute on function public.is_shop_member(uuid) to authenticated;
grant execute on function public.is_shop_member(uuid) to service_role;

alter function public.marketplace_verification_set_updated_at() set search_path = public;
revoke all on function public.marketplace_verification_set_updated_at() from anon;
revoke all on function public.marketplace_verification_set_updated_at() from public;
grant execute on function public.marketplace_verification_set_updated_at() to authenticated;
grant execute on function public.marketplace_verification_set_updated_at() to service_role;

alter function public.marketplace_verification_tax_secrets_set_updated_at() set search_path = public;
revoke all on function public.marketplace_verification_tax_secrets_set_updated_at() from anon;
revoke all on function public.marketplace_verification_tax_secrets_set_updated_at() from public;
grant execute on function public.marketplace_verification_tax_secrets_set_updated_at() to authenticated;
grant execute on function public.marketplace_verification_tax_secrets_set_updated_at() to service_role;

do $$
begin
  if to_regprocedure('public.marketplace_verification_is_owner()') is not null then
    execute 'alter function public.marketplace_verification_is_owner() set search_path = public';
    execute 'revoke all on function public.marketplace_verification_is_owner() from anon';
    execute 'revoke all on function public.marketplace_verification_is_owner() from public';
    execute 'grant execute on function public.marketplace_verification_is_owner() to authenticated';
    execute 'grant execute on function public.marketplace_verification_is_owner() to service_role';
  end if;
end $$;
