-- HQ admin-command-center: ensure service_role can read/write platform tables.
-- Production was returning 42501 permission denied on several HQ tables.
-- Idempotent: grants only when the relation exists.

do $$
declare
  t text;
  hq_tables text[] := array[
    'shops',
    'shop_members',
    'shop_subscriptions',
    'shop_subscription_events',
    'shop_admin_config',
    'orders',
    'payments',
    'marketplace_listings',
    'marketplace_seller_profiles',
    'marketplace_wholesale_orders',
    'marketplace_verification_applications',
    'platform_announcements',
    'platform_support_items',
    'platform_feature_flags',
    'platform_admin_audit',
    'platform_admins',
    'platform_ai_usage_daily',
    'platform_beta_feedback',
    'bloom_customer_subscriptions',
    'payment_hub_payment_links',
    'payment_hub_recovery_attempts',
    'payment_hub_recurring_runs',
    'payment_hub_provider_events',
    'payment_hub_refunds'
  ];
begin
  foreach t in array hq_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format(
        'grant select, insert, update, delete on table public.%I to service_role',
        t
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
