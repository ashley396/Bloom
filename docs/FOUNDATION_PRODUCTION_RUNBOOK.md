# Florisyn Foundation v1 — Production Runbook

**Branch:** `build/florisyn-foundation-v1`  
**Do not run steps 4–6 until steps 1–3 are complete and reviewed.**

---

## Prerequisites

- Supabase project admin access
- Netlify site admin access
- Stripe dashboard access (confirm test vs live mode)
- Fresh database backup capability

---

## Safe release order

```
1. Backup (Supabase + note current Netlify deploy ID)
2. Staging/clone migration test (recommended)
3. Apply migration to production
4. Verify schema + RLS
5. Deploy application (single build)
6. Health + smoke tests
7. Monitor 24h — rollback if critical failure
```

**Critical:** Apply migration **before** or **with** the application deploy that expects `order_status_history`. The app degrades gracefully if the table is missing (warn log only), but you should apply migration first for full functionality.

---

## Step 1 — Backup

### Supabase

1. Dashboard → **Database** → **Backups**
2. Confirm latest scheduled backup or trigger manual backup
3. Record backup timestamp: `________________`

### Netlify

1. Dashboard → **Deploys**
2. Record current published deploy ID/URL: `________________`
3. Ensure deploy is **locked** or note rollback target

### Git

- Backup branch: `backup/florisyn-pre-foundation-20260730-1415`
- Pre-foundation commit: `3fd33de`

---

## Step 2 — Staging migration test (recommended)

If a staging Supabase project or branch exists:

```bash
# From repo root — requires Supabase CLI linked to staging
supabase db push --db-url "$STAGING_DATABASE_URL"
# OR paste supabase/migrations/20260730_foundation_daily_loop_v1.sql in SQL editor
```

Verify:

```sql
select count(*) from information_schema.tables
  where table_name = 'order_status_history';

select conname from pg_constraint
  where conname = 'orders_status_check';
```

---

## Step 3 — Apply production migration

**File:** `supabase/migrations/20260730_foundation_daily_loop_v1.sql`

```bash
# Option A: Supabase CLI (production linked)
supabase db push

# Option B: SQL editor (after backup)
# Paste entire migration file → Run
```

Post-apply checks:

```sql
-- Status constraint includes legacy NEW
select pg_get_constraintdef(oid) from pg_constraint
  where conname = 'orders_status_check';

-- RLS enabled
select relname, relrowsecurity from pg_class
  where relname in ('order_status_history', 'audit_events');
```

---

## Step 4 — Verify environment variables (Netlify)

Required:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Database |
| `SUPABASE_ANON_KEY` | Client auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only |
| `SITE_URL` | Auth emails + checkout return URLs |

Payments (if using card checkout):

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | `sk_test_` or `sk_live_` — **owner confirms mode** |
| `STRIPE_ORDER_WEBHOOK_SECRET` | Order webhook signature |
| `STRIPE_WEBHOOK_SECRET` | If using shared webhook endpoint |

Optional AI:

| Variable | Purpose |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN` | Lily/Rose online |

---

## Step 5 — Deploy application (single controlled build)

### Recommended: Netlify Dashboard (no CLI required)

1. Netlify → **Deploys** → **Trigger deploy**
2. Branch: `build/florisyn-foundation-v1`
3. Wait for build success
4. **Publish deploy** (if not auto-published)

### Alternative: Git push (if continuous deploy enabled)

```bash
git push origin build/florisyn-foundation-v1
# Netlify builds from connected branch — still ONE deploy only
```

### Netlify CLI (if installed locally)

```bash
npm install -g netlify-cli   # if not installed
netlify login
netlify link                 # once per machine
netlify deploy --prod        # deploys current checked-out branch
```

**Note:** `netlify deploy --prod --branch=...` is **not** a standard Netlify CLI flag. Deploy from the checked-out branch or use the dashboard branch deploy.

This repository's `netlify.toml` has **no build command** — publish directory is `public/` with functions in `netlify/functions/`. Build is essentially packaging static files + bundling functions.

---

## Step 6 — Post-deploy verification

### Automated health

```bash
curl -s "https://<your-site>/.netlify/functions/production-health" | jq .
curl -s "https://<your-site>/.netlify/functions/ai-status" | jq .
```

Expected:

- `production-health`: `ok: true` (if core env set), `ai.state` honest, no secret values in JSON
- `ai-status`: `configuration_required` or `online` — never fake online without credentials

### Manual smoke checklist

1. Login / logout
2. Today page — visual unchanged
3. Create order → lands on **Payment Center**
4. Edit existing order → saves
5. Invoices nav → list loads
6. Settings → AI status shows honest state
7. Staff list — no pay rates; private file requires PIN
8. (If Stripe test keys) Complete test card payment

---

## Rollback procedures

### Application rollback (fast)

1. Netlify → Deploys → select pre-foundation deploy → **Publish deploy**
2. Or publish from branch `backup/florisyn-pre-foundation-20260730-1415`

### Database rollback

**Preferred:** Supabase point-in-time restore to backup from Step 1.

**Emergency manual SQL:** `supabase/migrations/20260730_foundation_daily_loop_v1_rollback.sql`

⚠️ Read rollback file header before running. Does not delete orders/customers. Drops `order_status_history` and added columns.

### Combined rollback order

1. Roll back Netlify deploy first (immediate user-facing fix)
2. Restore database if migration was applied and caused issues

---

## Supabase Auth URL configuration

After setting production `SITE_URL`:

| Setting | Value |
|---------|-------|
| Site URL | `https://<production-domain>` |
| Redirect URLs | `https://<production-domain>/verify-email**` |
| | `https://<production-domain>/reset-password**` |
| Preview (optional) | `https://deploy-preview-*--*.netlify.app/**` |

---

## Monitoring (first 24 hours)

- Netlify function error rate
- `production-health` endpoint
- Supabase advisors (security)
- Stripe webhook delivery log (if payments enabled)

---

## Contacts / escalation

- Migration failure → restore backup; do not re-run forward migration until root cause found
- Payment failure → verify Stripe mode + webhook secret; orders remain editable manually
- AI offline → expected if Cloudflare not configured; POS unaffected

---

*Owner-controlled production step — one deploy, one migration, full rollback path documented.*
