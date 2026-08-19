# Backup and recovery

## Database backup (Supabase)

1. Enable **daily backups** on paid plans or export via `pg_dump` for self-managed.
2. Before each migration batch: **Database → Backups → Create backup** (or PITR snapshot).
3. Store migration filenames and apply timestamp in your change log.

## Restore

1. Supabase Dashboard → **Database → Backups → Restore** (or PITR to timestamp).
2. Re-run Netlify deploy if functions depend on new schema (match migration state to code tag).
3. Verify `GET /.netlify/functions/health` and `production-health`.

## Staging bundle rollback proof

Run this locally before publishing a staging bundle:

```bash
npm run verify:rollback-proof
npm run check
node --test tests/*.test.js
npm --prefix frontend run build
```

Record before deploy:

| Item | Value |
|------|-------|
| Git branch | `beta/august10-stabilization` |
| Git commit | current `git rev-parse --short=7 HEAD` |
| Netlify site | `florisyn-staging` |
| Previous published deploy ID | Owner records in Netlify UI |
| Supabase backup/PITR timestamp | Owner records in Supabase |

Rollback order for staging incidents:

1. **Application first:** Netlify → Deploys → publish the previous known-good deploy ID.
2. **Config second:** restore env vars from the secure vault if the incident is configuration-only.
3. **Database last:** use Supabase backup/PITR only for data corruption or failed migration state.

Do not forward-apply rollback SQL. Rollback SQL files are emergency references only.

## Environment recovery

1. Re-create Netlify env vars from secure vault (see ENVIRONMENT.md).
2. Redeploy `redesign-v22` (or release tag) without merging if hotfix branch.
3. Run admin **System health** and **Beta readiness** checklist.

## Disaster recovery (high level)

| Scenario | Action |
|----------|--------|
| Supabase unavailable | Show maintenance banner; POS read-only if cached |
| Netlify outage | Status page; no schema changes until restored |
| Leaked service role | Rotate key in Supabase; update Netlify; audit `audit_events` |

## Migration rollback

Do **not** delete production tables. Forward-fix with a new idempotent migration. Restore backup only if data corruption occurred.
