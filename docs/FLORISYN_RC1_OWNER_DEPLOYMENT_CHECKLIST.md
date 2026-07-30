# Florisyn RC1 — Owner Deployment Checklist

**For:** Ashley (owner)  
**Branch to deploy:** `release/florisyn-foundation-daily-loop-v3`  
**Rule:** Complete sections **in order**. Do not deploy until “Before deployment” is fully checked.  
**Never paste secret values** into chat or tickets — only confirm Present / Live / Verified.

Full engineering report: `docs/FLORISYN_RC1_FINAL_READINESS_REPORT.md`

---

## Before deployment

### Backup and record keeping

- [ ] **Supabase backup** completed — record date/time: ________________
- [ ] **Current Netlify deploy ID** recorded (rollback target): ________________
- [ ] **Current production commit** recorded (pre-release): ________________
- [ ] **RC1 release commit SHA** recorded: ________________

### Confirm environment variables (Netlify → Production)

Check each item is **Present** and correct mode. Do not write secret values here.

| Variable | Status (Present / Missing / Test / Live) |
|----------|------------------------------------------|
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` | |
| `SITE_URL` (canonical HTTPS production URL) | |
| `STRIPE_SECRET_KEY` (**must be Live** `sk_live_…` for production) | |
| `STRIPE_PUBLISHABLE_KEY` (if used) | |
| `STRIPE_ORDER_WEBHOOK_SECRET` | |
| `STRIPE_WEBHOOK_SECRET` (subscriptions, if used) | |

- [ ] All **required** rows above are **Present**
- [ ] Stripe is **Live Mode** — not test keys

### Confirm Supabase Auth URLs

In Supabase Dashboard → **Authentication** → **URL Configuration**:

- [ ] **Site URL** = your production Florisyn URL (same as `SITE_URL`)
- [ ] **Redirect URLs** include:
  - [ ] `https://<your-domain>/verify-email`
  - [ ] `https://<your-domain>/reset-password`
  - [ ] `https://<your-domain>/login` (if required by your setup)
- [ ] No production email link will point to `localhost`

### Confirm feature flags (must stay off for RC1)

In Netlify env — unset or explicitly `false`:

- [ ] `REACT_ORDERS_PREVIEW` = false
- [ ] `VOICE_WAKE` = false
- [ ] `INVENTORY_AI_INTAKE` = false
- [ ] `WEBSITE_STUDIO_V2` = false

(Optional: verify after deploy via `GET /.netlify/functions/production-health`)

### Confirm Stripe webhook (Dashboard)

- [ ] Webhook URL: `https://<your-domain>/.netlify/functions/stripe-order-webhook`
- [ ] Events include: `checkout.session.completed`, `checkout.session.async_payment_succeeded`
- [ ] Signing secret copied to Netlify `STRIPE_ORDER_WEBHOOK_SECRET`

### Confirm migration files ready (do not run yet)

- [ ] `supabase/migrations/20260730_foundation_daily_loop_v1.sql` reviewed
- [ ] `supabase/migrations/20260730_delivery_proofs_storage.sql` reviewed
- [ ] Rollback files noted: `supabase/rollback/` (emergency only)

### Confirm storage design (do not create manually unless skipping SQL)

- [ ] Bucket name will be: `delivery-proofs`
- [ ] Will be **private** (not public)
- [ ] Max file size: **5 MB**
- [ ] Allowed types: JPEG, PNG, WebP, HEIC, HEIF

---

## Deployment

### Step 1 — Database (Supabase SQL Editor)

Run **in this exact order**:

1. - [ ] **Backup confirmed** (again — do not skip)
2. - [ ] Run `20260730_foundation_daily_loop_v1.sql`
3. - [ ] Run post-migration checks (from readiness report §4):
   ```sql
   select to_regclass('public.order_status_history');
   select column_name from information_schema.columns
     where table_name = 'deliveries' and column_name = 'proof_photo_url';
   ```
4. - [ ] Run `20260730_delivery_proofs_storage.sql`
5. - [ ] Supabase → **Storage** → confirm `delivery-proofs` exists, **Public = OFF**, 5 MB limit

### Step 2 — One Netlify production deploy

- [ ] Deploy branch: `release/florisyn-foundation-daily-loop-v3`
- [ ] **Publish** production (one deploy only)
- [ ] Record **deploy ID**: ________________
- [ ] Record **deploy time**: ________________

---

## After deployment — smoke tests

Run on **production**. Mark **Pass** or **Fail**. **Roll back immediately** on any **Release-blocking** failure.

### Authentication (release-blocking)

| # | Test | Pass | Fail | Blocks? |
|---|------|------|------|---------|
| 1 | Sign up → verification email arrives | ☐ | ☐ | **Yes** |
| 2 | Verification link opens production URL (not localhost) | ☐ | ☐ | **Yes** |
| 3 | Sign in → Today / POS loads | ☐ | ☐ | **Yes** |
| 4 | Sign out works | ☐ | ☐ | No |

### Tenant isolation (release-blocking)

| # | Test | Pass | Fail | Blocks? |
|---|------|------|------|---------|
| 5 | User A cannot see User B’s shop orders/customers | ☐ | ☐ | **Yes** |

### Customers

| # | Test | Pass | Fail | Blocks? |
|---|------|------|------|---------|
| 6 | Create customer | ☐ | ☐ | **Yes** |
| 7 | Duplicate phone/email rejected | ☐ | ☐ | **Yes** |
| 8 | Contact preference saves | ☐ | ☐ | No |

### Orders & payments

| # | Test | Pass | Fail | Blocks? |
|---|------|------|------|---------|
| 9 | Create order | ☐ | ☐ | **Yes** |
| 10 | Tax calculates correctly | ☐ | ☐ | No |
| 11 | Routes to Payment Center | ☐ | ☐ | **Yes** |
| 12 | Move order across board columns + history shows | ☐ | ☐ | No |
| 13 | Stripe payment (test or authorized live) succeeds | ☐ | ☐ | **Yes** |

### Delivery proof (only after storage migration)

| # | Test | Pass | Fail | Blocks? |
|---|------|------|------|---------|
| 14 | Upload valid photo on delivery | ☐ | ☐ | No* |
| 15 | Oversized/invalid file rejected | ☐ | ☐ | No |
| 16 | Failed upload does **not** mark Delivered | ☐ | ☐ | **Yes** if using proof |

\*Required if proof capture is enabled for RC1.

### Inventory

| # | Test | Pass | Fail | Blocks? |
|---|------|------|------|---------|
| 17 | Create/update inventory item | ☐ | ☐ | No |
| 18 | Use First / freshness filter works | ☐ | ☐ | No |

### UI regression (release-blocking for Today)

| # | Test | Pass | Fail | Blocks? |
|---|------|------|------|---------|
| 19 | Today page loads — no redesign breakage | ☐ | ☐ | **Yes** |
| 20 | Orders board loads | ☐ | ☐ | **Yes** |
| 21 | Mobile bottom navigation works | ☐ | ☐ | No |

---

## If something fails

1. **Stop** — do not continue smoke tests for release-blocking failures  
2. **Netlify** → Deploys → **Publish** previous deploy ID (from backup step)  
3. Note failure in: ________________  
4. Contact engineering with deploy ID + failing step number  

Database rollback is **last resort** only — see `docs/STACKED_RELEASE_ROLLBACK.md`.

---

## Sign-off

| | Name | Date |
|---|------|------|
| Migrations applied | | |
| Deploy published | | |
| Smoke tests passed | | |
| **RC1 accepted** | | |

---

*Plain-language owner checklist for one controlled RC1 production deployment. No secrets. 2026-07-30.*
