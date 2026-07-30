# Florisyn Stacked Release — Owner Checklist

**Use before production deploy.** Do not paste secret values into tickets or chat. Check each box; record *where* configured, not the value.

---

## A. Supabase — project settings

| Item | Where to set | Verified |
|------|--------------|----------|
| **Supabase project URL** | Netlify env `SUPABASE_URL` | ☐ |
| **Supabase anon / publishable key** | Netlify env `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` | ☐ |
| **Supabase service role key** (server-only) | Netlify env `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` — **never** in client | ☐ |
| **Supabase Site URL** | Supabase Dashboard → Authentication → URL Configuration → Site URL | ☐ |
| **Supabase redirect URLs** | Same page → Redirect URLs — include production + staging + `/verify-email`, `/reset-password` | ☐ |

**Production Site URL should match Netlify primary URL or custom domain (see section B).**

---

## B. Netlify — site URLs

| Item | Where to set | Verified |
|------|--------------|----------|
| **Netlify production URL** | Deploys → published URL (record): ________________ | ☐ |
| **Custom domain** (if used) | Domain settings — record: ________________ | ☐ |
| **`SITE_URL` env var** | Netlify → Environment variables — must be canonical HTTPS production URL | ☐ |
| **`DEPLOY_PRIME_URL`** | Auto on Netlify previews — do not override unless needed | ☐ |

**Redirect rule:** Auth emails must not redirect to `localhost` when `SITE_URL` is set (verified by automated tests).

---

## C. Stripe — payments

| Item | Where to set | Verified |
|------|--------------|----------|
| **Stripe mode decision** | Test vs Live — owner sign-off: ________________ | ☐ |
| **Stripe secret key** | Netlify `STRIPE_SECRET_KEY` — server only | ☐ |
| **Stripe publishable key** | Netlify `STRIPE_PUBLISHABLE_KEY` (if used client-side for Elements) | ☐ |
| **Stripe webhook endpoint** | Stripe Dashboard → Webhooks → URL: `https://<site>/.netlify/functions/stripe-order-webhook` | ☐ |
| **Stripe webhook secret** | Netlify `STRIPE_WEBHOOK_SECRET` | ☐ |
| **Livemode guard** | Test keys must not receive live webhooks (code guard in place) | ☐ |

---

## D. Feature flags (defaults — do not enable risky flags in prod)

Verify via `GET /.netlify/functions/production-health` after deploy:

| Flag | Required production value | Verified |
|------|----------------------------|----------|
| `REACT_ORDERS_PREVIEW` | **false** | ☐ |
| `VOICE_WAKE` | **false** | ☐ |
| `INVENTORY_AI_INTAKE` | **false** | ☐ |
| `INVENTORY_RECIPE_DEDUCTIONS` | **false** | ☐ |
| `WEBSITE_STUDIO_V2` | **false** | ☐ |

Override only with explicit `FLORISYN_FLAG_<NAME>=true` in Netlify env.

---

## E. Database migrations (apply in order)

| Step | File | Applied | Timestamp |
|------|------|---------|-----------|
| 1. Backup | Supabase Dashboard → Backups | ☐ | |
| 2. Foundation v1 | `supabase/migrations/20260730_foundation_daily_loop_v1.sql` | ☐ | |
| 3. Delivery proofs storage | `supabase/migrations/20260730_delivery_proofs_storage.sql` | ☐ | |
| 4. Post-migration SQL checks | See `STACKED_RELEASE_READINESS_REPORT.md` §6 | ☐ | |

**Do not enable delivery proof capture in production until step 3 succeeds.**

---

## F. Storage buckets

| Bucket | Private | RLS | Verified |
|--------|---------|-----|----------|
| `expense-receipts` | yes | (legacy — uploads via authenticated client) | ☐ |
| `delivery-proofs` | yes | shop-scoped policies in migration | ☐ |

After apply: Supabase → Storage → confirm `delivery-proofs` exists, **Public bucket = OFF**, file size limit 5 MB.

---

## G. Optional but recommended

| Item | Verified |
|------|----------|
| `GOOGLE_MAPS_API_KEY` for route distance (or accept graceful degrade) | ☐ |
| `CLOUDFLARE_*` for cloud AI (or accept honest "configuration required" status) | ☐ |
| `RESEND_API_KEY` for transactional email | ☐ |
| Google Search Console verification (Website Studio future) | ☐ |

---

## H. Pre-deploy sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Owner / florist operator | | | |
| Technical reviewer | | | |

**Deploy only after:** migrations applied, storage verified, env checklist complete, smoke test plan scheduled.

---

*Never print or commit secret values. Rotate any key that was exposed.*
