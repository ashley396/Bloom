# Florisyn Public Launch Guide

Use this checklist before opening Florisyn to paying florists. It covers **everything that ships at launch** on branch `cursor/florisyn-enterprise-platform-64dc` (PR #56).

---

## What goes live at launch

| Area | What florists get |
|------|-------------------|
| **Core POS** | Orders, customers, inventory, products, payments, invoices, staff, reports |
| **Deliveries** | Dispatch board, proof of delivery, route optimizer |
| **Marketplace** | Wholesale browse + multi-item checkout (Stripe Connect to sellers) |
| **Florist Network** | Partner directory, wire orders, **$0 Florisyn fee**, Stripe wire pay or offline |
| **Florist Community** | Profiles, posts, encourage, comments, moderation (active members only) |
| **Holiday Command** | Peak readiness (Mother's Day checklist) |
| **Email Campaigns** | Draft/schedule/send when Resend is configured |
| **Wedding Workflows** | Proposals, checklists, timelines |
| **Business OS** | Subscriptions, loyalty, finance hub, Lily coach |
| **AI** | Lily, Rose, BloomShot (cloud AI optional) |
| **Website** | Instant Website / Website Studio v1 (not full v2 editor) |
| **Migration wizard** | CSV import for customers, inventory, orders |
| **Pricing** | $59 / $99 / $149 public tiers |

**Intentionally not at launch** (stay off unless you explicitly enable):

| Flag | Why |
|------|-----|
| `FLORISYN_FLAG_VOICE_WAKE` | Always-on mic — not production-ready |
| `FLORISYN_FLAG_WEBSITE_STUDIO_V2` | Full visual editor — future phase |
| `FLORISYN_FLAG_INVENTORY_AI_INTAKE` | Experimental intake |
| `FLORISYN_FLAG_REACT_ORDERS_PREVIEW` | Dev preview only |

---

## Step 1 — Back up Supabase

1. Supabase Dashboard → **Database → Backups** → create a manual backup (or confirm PITR).
2. Record backup time and project ref in your change log.

---

## Step 2 — Apply database migrations

Apply **in order**. Stop on any error.

### If this is a **new** project (greenfield)

Run the full chain under `supabase/migrations/`:

1. `20260804000000_greenfield_baseline.sql` (includes Florist Community schema + RLS)
2. `20260804171338_p0_09d_function_acl_hardening.sql`
3. `20260804185015_p0_10_atomic_order_create.sql`
4. `20260804205339_p0_12_closed_beta_tenant_isolation.sql`
5. `20260804223000_p0_13_policy_consolidation.sql`
6. `20260804224500_p0_14_onboarding_convergence.sql`
7. `20260805154819_p0_19_refund_idempotency.sql`
8. `20260808210000_holiday_weddings_email_v1.sql`
9. `20260810130000_florist_network_growth_v1.sql`
10. `20260810140000_competitive_parity_v2.sql` (POS quotes, production reports, etc.)
11. `20260810150000_florist_network_zero_platform_fee.sql`
12. `20260810160000_florist_wire_stripe_settlement.sql`

**Apply method:** Supabase SQL Editor (paste one file at a time) or `supabase db push` if your project uses the CLI.

### If you already applied an **older** baseline

Apply only migrations **after** your last applied version from the list above.

### Verify after apply

- Table `florist_community_posts` exists
- Table `florist_wire_orders` has columns `payment_status`, `paid_at`
- Table `pos_quotes` exists
- Storage bucket `florist-community` exists with **public = false**

---

## Step 3 — Configure Netlify environment variables

Netlify → **Site configuration → Environment variables**. Use `.env.example` as the template.

### Required

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Client login key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server functions only — never in frontend |
| `SITE_URL` | Production origin, e.g. `https://www.florisyn.com` (no trailing slash) |
| `PLATFORM_BOOTSTRAP_SECRET` | Long random string for first platform admin setup |

### Required for payments (launch without these = manual payments only)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Live or test secret key |
| `STRIPE_ORDER_WEBHOOK_SECRET` | Webhook for order/marketplace/wire checkout |
| `STRIPE_WEBHOOK_SECRET` | Webhook for Florisyn subscription billing |
| `STRIPE_CONNECT_CLIENT_ID` | Connect onboarding for sellers + wire partners |
| `STRIPE_PRICE_STARTER` | Monthly Starter ($59) |
| `STRIPE_PRICE_PROFESSIONAL` | Monthly Pro ($99) |
| `STRIPE_PRICE_PREMIUM` | Monthly Premium ($149) |
| `STRIPE_PRICE_STARTER_ANNUAL` | Annual Starter |
| `STRIPE_PRICE_PROFESSIONAL_ANNUAL` | Annual Pro |
| `STRIPE_PRICE_PREMIUM_ANNUAL` | Annual Premium |

### Required for Email Campaigns send

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Transactional + campaign email |

### Recommended

| Variable | Purpose |
|----------|---------|
| `GOOGLE_MAPS_API_KEY` | Delivery route distance (degrades gracefully without it) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN` | Cloud AI for Lily |
| `BLOOM_MARKETPLACE_FEE_PERCENT` | Default `5` — Florist Network wires stay **$0** Florisyn fee |

### Feature flags (defaults ON — only set to disable)

Community and growth features are **on by default** in code. You do **not** need to set flag env vars unless you want to kill-switch something:

| Variable | Default | Set to `false` to disable |
|----------|---------|---------------------------|
| `FLORISYN_FLAG_COMMUNITY_BETA` | **ON** | Hide Florist Community |
| `FLORISYN_FLAG_FLORIST_NETWORK` | ON | Florist Network |
| `FLORISYN_FLAG_HOLIDAY_COMMAND_CENTER` | ON | Holiday Command |
| `FLORISYN_FLAG_EMAIL_CAMPAIGNS` | ON | Email Campaigns UI |
| `FLORISYN_FLAG_WEDDING_WORKFLOWS` | ON | Weddings |
| `FLORISYN_FLAG_MARKETPLACE_PUBLIC` | ON | Marketplace |
| `FLORISYN_FLAG_WHOLESALE_SELLER` | ON | Wholesale seller tools |

**Never** set `FLORISYN_ALLOW_OPEN_BOOTSTRAP=true` in production.

---

## Step 4 — Stripe setup

### Products & prices

1. Create three products in Stripe: **Starter**, **Pro**, **Premium**.
2. Create monthly and annual prices matching `$59 / $99 / $149` (annual = 10 months charged).
3. Copy each Price ID into the matching `STRIPE_PRICE_*` Netlify variable.

### Webhooks

Create **two** webhook endpoints pointing at your production site:

| Endpoint URL | Events | Netlify secret variable |
|--------------|--------|-------------------------|
| `https://YOUR_DOMAIN/.netlify/functions/stripe-order-webhook` | `checkout.session.completed`, `payment_intent.succeeded` (and related checkout events) | `STRIPE_ORDER_WEBHOOK_SECRET` |
| `https://YOUR_DOMAIN/.netlify/functions/stripe-subscription-webhook` | Subscription lifecycle events | `STRIPE_WEBHOOK_SECRET` |

Use **live** keys with **live** webhooks, or **test** with **test** — never mix.

### Stripe Connect

1. Enable Connect in Stripe Dashboard.
2. Set `STRIPE_CONNECT_CLIENT_ID`.
3. Florists complete Connect in **Payment Center** to receive marketplace payouts and Florist Network wires.

---

## Step 5 — Supabase Auth URLs

Supabase → **Authentication → URL configuration**:

1. **Site URL** = your `SITE_URL`
2. **Redirect allow list** includes:
   - `https://YOUR_DOMAIN/verify-email`
   - `https://YOUR_DOMAIN/reset-password`
   - `https://YOUR_DOMAIN/login`

Test signup verification and password reset on production.

---

## Step 6 — Deploy

1. Merge PR #56 (or deploy branch `cursor/florisyn-enterprise-platform-64dc`) to your production Netlify site.
2. Wait for build to finish.
3. Hit health check:

```bash
curl -s "https://YOUR_DOMAIN/.netlify/functions/production-health" | jq .
```

Expect `"ok": true` when core Supabase vars are set. Review `feature_flags` in the response — `COMMUNITY_BETA`, `FLORIST_NETWORK`, `EMAIL_CAMPAIGNS`, etc. should be `true`.

---

## Step 7 — Platform admin bootstrap

1. Open `https://YOUR_DOMAIN/admin`
2. Complete first-time owner setup using your `PLATFORM_BOOTSTRAP_SECRET`
3. After the first `platform_admins` row exists, bootstrap POST returns 409 permanently — only admin login works

---

## Step 8 — Launch smoke tests

Run these on production (or staging with live-like config) before announcing.

### Core (Shop A)

- [ ] Sign up → verify email → complete onboarding
- [ ] Create customer → create order → take payment (Stripe)
- [ ] Adjust inventory → fulfill order (recipe deduction if product has recipe)
- [ ] Delivery board → optimize route → mark delivered

### Florist Network

- [ ] Shop A: create network profile
- [ ] Shop B: accept incoming wires, complete Stripe Connect
- [ ] Shop A: send wire order → pay partner via Stripe **or** mark paid offline
- [ ] Confirm fulfilling shop receives **100%** (Florisyn fee $0)

### Florist Community

- [ ] Community nav visible (no flag env var needed)
- [ ] Save profile → create post with photo → Encourage → comment
- [ ] Shop B sees feed; cannot edit A's post; can report

### Marketplace & wholesale

- [ ] Browse marketplace → multi-item checkout
- [ ] Wholesale seller: publish listing → buyer checkout

### Growth modules

- [ ] Holiday Command page loads; peak checklist on dashboard
- [ ] Email Campaigns: create draft → send (requires Resend)
- [ ] Weddings: create proposal / checklist
- [ ] Migration wizard: import sample CSV
- [ ] Public pricing page `/company/pricing/` and compare `/company/compare/`

### Admin

- [ ] Command Center → system health → beta checklist items visible

---

## Step 9 — Go live

1. Switch Stripe to **live mode** (if you tested in test mode).
2. Update `STRIPE_*` and webhook secrets to live values; redeploy.
3. Announce to first florist cohort.
4. Monitor Netlify function logs and Supabase advisors for 48 hours.

---

## Emergency rollback

| Issue | Action |
|-------|--------|
| Community problem | Set `FLORISYN_FLAG_COMMUNITY_BETA=false` → redeploy |
| Florist Network | Set `FLORISYN_FLAG_FLORIST_NETWORK=false` → redeploy |
| Full rollback | Netlify → Deploys → publish last known-good deploy |
| Database | Restore from Step 1 backup |

---

## Quick reference — migration files (August 2026 launch)

```
supabase/migrations/20260810130000_florist_network_growth_v1.sql
supabase/migrations/20260810140000_competitive_parity_v2.sql
supabase/migrations/20260810150000_florist_network_zero_platform_fee.sql
supabase/migrations/20260810160000_florist_wire_stripe_settlement.sql
```

Community schema is inside `20260804000000_greenfield_baseline.sql` (no separate apply if baseline is current).

---

## Sign-off

| Check | Owner | Date |
|-------|-------|------|
| Supabase backup | | |
| All migrations applied | | |
| Netlify env vars set | | |
| Stripe products + webhooks + Connect | | |
| Resend configured | | |
| production-health ok | | |
| Smoke tests passed | | |
| Live Stripe switched | | |
