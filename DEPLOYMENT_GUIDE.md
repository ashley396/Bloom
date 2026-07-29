# Deployment guide — Bloom 1.0 RC1

## Preconditions

- Node 20+ for local checks
- Netlify site connected to `release-candidate-v1`
- Supabase project with backups enabled

## Steps

1. **Review SQL** — Follow [SQL_MIGRATION_ORDER.md](./SQL_MIGRATION_ORDER.md). Apply on staging first. Do not apply to production without sign-off.
2. **Environment** — Set variables per [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md).
3. **Verify build** — `npm run check` and `node --test tests/*.test.js`.
4. **Deploy branch** — Deploy `release-candidate-v1` to a staging Netlify URL (not production main).
5. **Health** — `GET /.netlify/functions/health` and `/.netlify/functions/production-health`.
6. **Admin** — Command Center → **Beta toolkit** → confirm migration probes and checklist.
7. **Florist smoke** — Login → order → inventory → marketplace verification path.
8. **Beta invite** — Use [BETA_TEST_PLAN.md](./BETA_TEST_PLAN.md).

## Do not (RC1 policy)

- Merge to `main` without beta completion
- Apply SQL without review
- Force-push or auto-deploy production main

## Rollback

- Netlify: redeploy previous successful deploy
- Database: Supabase PITR / backup restore (see `docs/production/BACKUP-RECOVERY.md`)
