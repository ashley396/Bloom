# Migration order (review only — do not apply without approval)

Apply in Supabase SQL editor or CLI **after backup**. Forward-only; use new migration files to fix mistakes.

1. Base SaaS / core tables (legacy foundation migrations if greenfield)
2. `20260727_marketplace_verification_production_v1.sql`
3. `20260728_marketplace_milestone_v2.sql`
4. `20260728_wholesale_seller_v1.sql`
5. `20260728_command_center_v1.sql`
6. `20260728_lily_ai_platform_v1.sql` (optional server-side Lily history)

## Rollback guidance

- Supabase: restore from **point-in-time recovery** or nightly backup — do not run destructive `DOWN` scripts in production.
- Netlify: redeploy previous successful deploy from deploy history.
- Secrets: rotate keys if service role was exposed.

## Pre-apply checklist

- [ ] Backup taken (see BACKUP-RECOVERY.md)
- [ ] Migration reviewed in PR
- [ ] Staging apply succeeded
- [ ] RLS policies verified for new tables
