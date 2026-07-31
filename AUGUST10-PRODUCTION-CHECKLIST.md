# August 10 Production Checklist

Use this before any production deploy of `beta/august10-stabilization`.  
**Do not apply production migrations until each step below is confirmed.**

Baseline: `main` @ `eb690be` + Florist Community Beta stabilization.

---

## 1. Database backup (do this first)

1. Open Supabase Dashboard → **Database → Backups**.
2. Create a **manual backup** (or confirm PITR is enabled).
3. Record backup time and project ref in your change log.
4. Optional: `pg_dump` a logical backup for extra safety.

---

## 2. Supabase migrations still needing apply

Apply **in order** on the production project (SQL editor or CLI). Skip any already applied.

### Existing stack (verify applied)

| Migration | Purpose |
|-----------|---------|
| `supabase/migrations/v4.1.sql` … `v8.0.sql` | Baseline schema |
| `supabase/migrations/20260728_release_candidate_v1.sql` | RC1 / beta feedback |
| `supabase/migrations/20260728_payment_hub_v1.sql` (+ v1_2, pro, live wiring) | Payment Hub |
| `supabase/migrations/20260728_business_ecosystem_v1.sql` | Business OS tables |
| `supabase/migrations/20260730_foundation_daily_loop_v1.sql` | Foundation + Daily Loop |
| `supabase/migrations/20260730_delivery_proofs_storage.sql` | Delivery proof bucket |

### Required for August 10 Community Beta

| Migration | Purpose |
|-----------|---------|
| `supabase/migrations/20260729_phase2a_a2_staff_time_entries_rls_v1.sql` | Staff-time RLS A2 |
| `supabase/migrations/20260731_florist_community_beta_v1.sql` | Community tables, storage, RLS |

**Apply method (recommended):**

1. Supabase → **SQL** → paste migration contents → Run.
2. Confirm no errors.
3. **Database → Roles / Tables** → verify RLS enabled on new tables.

---

## 3. Staff-time RLS A2

File: `supabase/migrations/20260729_phase2a_a2_staff_time_entries_rls_v1.sql`

1. Apply migration if not already applied.
2. Verify:

```sql
select relrowsecurity
from pg_class
where relname = 'staff_time_entries';
-- expect: true
```

3. Confirm policy `staff time entries shop access` exists and uses `is_shop_member(shop_id)`.
4. Smoke: clock-in as shop A must not see shop B time entries.

---

## 4. Community database tables, storage, and RLS

File: `supabase/migrations/20260731_florist_community_beta_v1.sql`

### Tables created

- `florist_community_profiles`
- `florist_community_posts`
- `florist_community_comments`
- `florist_community_likes`
- `florist_community_reports`

### Storage

- Bucket: `florist-community` (public read, 2 MB, jpeg/png/webp)
- Path convention: `{shop_id}/{user_id}/{timestamp-uuid}.{ext}`

### After apply

1. Storage → confirm bucket `florist-community` exists.
2. Confirm RLS policies on all five tables.
3. Confirm helpers exist: `is_platform_admin_user()`, `is_shop_manager_of(uuid)`.
4. Test with **two shops**: Shop A creates a post; Shop B can see it in the feed; Shop B cannot edit Shop A’s post; Shop B cannot hide Shop A’s post unless platform admin.

---

## 5. Netlify environment variable names

Set these on the **production** Netlify site (Site settings → Environment variables):

| Variable | Required | Notes |
|----------|----------|-------|
| `SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` | Yes | Client key (RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` | Yes* | Server only — never in frontend |
| `SITE_URL` | Yes | e.g. `https://app.florisyn.com` |
| `STRIPE_SECRET_KEY` | Yes | `sk_live_…` or `sk_test_…` for beta |
| `STRIPE_WEBHOOK_SECRET` | Yes | Matching mode |
| `FLORISYN_FLAG_COMMUNITY_BETA` | Recommended | `true` for beta; set `false` to disable |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_AI_API_TOKEN` | Optional | Lily AI |

\* Needed for some admin/store flows; Community feed uses **user JWT + RLS**, not the service role in responses.

**Never** put `SUPABASE_SERVICE_ROLE_KEY` or Stripe secret keys in `public/` files.

---

## 6. SITE_URL and email redirects

1. Set `SITE_URL` to the production app origin (no trailing slash preferred; app normalizes).
2. Supabase → **Authentication → URL configuration**:
   - Site URL = same production origin
   - Redirect allow list includes:
     - `{SITE_URL}/verify-email`
     - `{SITE_URL}/reset-password`
     - Netlify Deploy Preview URLs if used for QA
3. Confirm Netlify redirects for `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` (see `netlify.toml`).
4. Test: signup → verification email link → lands on production verify page.
5. Test: forgot password → reset link → production reset page.

---

## 7. Stripe production configuration

### For August 10 beta (recommended)

1. Use **Stripe test mode** (`sk_test_…`) until first paid florist go-live.
2. Webhook endpoint: `https://{your-domain}/.netlify/functions/…` (existing payments webhook).
3. Confirm webhook signing secret matches the same mode as the secret key.
4. Livemode mismatch is rejected by `assertStripeLivemodeMatchesKey` — do not mix test webhooks with live keys.

### When switching to live

1. Replace `STRIPE_SECRET_KEY` with `sk_live_…`.
2. Replace webhook secret with live signing secret.
3. Redeploy Netlify.
4. Run one $0.50+ test charge on a sandbox order, then refund.

---

## 8. Mobile testing

Test on a real phone or Chrome DevTools device mode (390×844):

| Flow | Pass? |
|------|-------|
| Login / signup | ☐ |
| Today / dashboard loads | ☐ |
| Create order (walk-in pickup) | ☐ |
| Stripe test checkout (if configured) | ☐ |
| Receipt / invoice view | ☐ |
| Inventory list | ☐ |
| Staff clock-in with PIN | ☐ |
| Website Studio open + save | ☐ |
| **Community** open from sidebar or More → `community` | ☐ |
| Community create post + optional image | ☐ |
| Community like, comment, report | ☐ |
| Loading / empty / error states readable | ☐ |

---

## 9. Netlify rollback

If production misbehaves after deploy:

1. Netlify → **Deploys**.
2. Select the last known-good deploy (record ID before release).
3. **Publish deploy**.
4. Verify `/.netlify/functions/health` (or `production-health`).
5. Confirm florists can sign in and create orders.
6. If Community-only issue: prefer **emergency disable** (next section) before full rollback.

Also see: `docs/STACKED_RELEASE_ROLLBACK.md`, `docs/production/BACKUP-RECOVERY.md`.

---

## 10. Emergency Community disable method

Community is gated by feature flag **`COMMUNITY_BETA`**.

1. Netlify → Environment variables.
2. Set `FLORISYN_FLAG_COMMUNITY_BETA` = `false`.
3. Trigger a redeploy (or wait for next cold start if env is read at runtime — **redeploy to be safe**).
4. API returns **503** with message that Community is temporarily disabled.
5. Nav entry may still appear; the page shows an error — florists cannot post or load the feed.
6. To re-enable: set `FLORISYN_FLAG_COMMUNITY_BETA` = `true` and redeploy.

No database wipe required for emergency disable.

---

## 11. Post-apply smoke (two shops)

1. Shop A owner: save Community profile → create post with image → like/comment.
2. Shop B owner: see Shop A post → cannot edit/delete it → can comment/like/report.
3. Shop A manager: can hide own shop’s post.
4. Shop B manager: **cannot** hide Shop A’s post (backend 403).
5. Confirm orders/customers for Shop A never appear in Community API responses.

---

## Sign-off

| Check | Owner | Date |
|-------|-------|------|
| Backup created | | |
| Staff RLS A2 applied | | |
| Community migration applied | | |
| Netlify env confirmed | | |
| SITE_URL + auth redirects | | |
| Stripe mode confirmed | | |
| Mobile smoke passed | | |
| Two-shop isolation passed | | |
| Rollback deploy ID recorded | | |
