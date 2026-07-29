# SQL migration order — Bloom 1.0 RC1

**Review every file before apply. Forward-only. Take a backup first.**

1. `supabase/migration_floravia_saas_foundation_v1.sql` (or existing base if already live)
2. `supabase/migrations/20260727_marketplace_verification_production_v1.sql`
3. `supabase/migrations/20260728_marketplace_milestone_v2.sql`
4. `supabase/migrations/20260728_wholesale_seller_v1.sql`
5. `supabase/migrations/20260728_command_center_v1.sql`
6. `supabase/migrations/20260728_lily_ai_platform_v1.sql` (optional Lily server history)
7. `supabase/migrations/20260728_release_candidate_v1.sql` (beta feedback inbox)
8. `supabase/migrations/20260728_bloom_rc1_instant_websites.sql`
9. `supabase/migrations/20260728_bloom_rc1_1_storefront.sql`
10. `supabase/migrations/20260728_bloom_rc1_2_commerce.sql`
11. Payment hub / experience migrations as needed for your branch (see `docs/PAYMENTS_LIVE_WIRING_v1_3.md`)

After apply, Admin → **Beta toolkit** should show **applied** for probed tables.

## Rollback

Do not run destructive down migrations. Restore backup or ship forward-fix migration.
