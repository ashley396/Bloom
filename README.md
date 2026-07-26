# Floravia SaaS Foundation v1

This package adds the first customer-ready SaaS layer to the current Supabase + Netlify Bloom project.

## What is included

- Secure multi-shop records and memberships
- A profile tied to each authenticated user
- 14-day trial records
- Stripe subscription checkout and webhook synchronization
- A four-step florist onboarding wizard
- Automatic shop, owner membership, default hours, and Lily/Rose profile creation
- Tenant-access helper functions and initial RLS policies
- `shop_id` columns added safely to existing core tables when those tables exist

## Important

This is a foundation package, not a claim that the full application is launch-ready. Existing business-table RLS policies must be reviewed table by table before outside florists are invited. Do not open public signup until tenant-isolation tests pass.

## Install in one bundled deployment

### 1. Supabase

Run:

`supabase/migration_floravia_saas_foundation_v1.sql`

### 2. Project files

Copy the contents of `netlify/functions/` into your project's existing `netlify/functions/` folder.

Keep your current shared `supabase.js`; the new `_shared/saas.js` is separate so it does not break existing functions.

### 3. Add onboarding markup

Paste the contents of `public/onboarding.html` just before the closing `</body>` tag in the existing `index.html`.

Add to the `<head>`:

```html
<link rel="stylesheet" href="/onboarding.css">
```

Add before the closing `</body>`:

```html
<script type="module" src="/onboarding.js"></script>
```

Copy `onboarding.js` and `onboarding.css` into the same public folder as the current `app.js`.

### 4. Connect it to the current login flow

In the current `app.js`, replace each direct call to:

```js
await loadDashboard();
```

after login with:

```js
const ready = await floraviaSaasAfterLogin();
if (ready) await loadDashboard();
```

Because `onboarding.js` loads as a module, load it before the existing app script or import its function directly.

Recommended script order:

```html
<script type="module" src="/onboarding.js"></script>
<script type="module" src="/app.js"></script>
```

### 5. Netlify environment variables

Existing:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `SITE_URL`

New:
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PROFESSIONAL`
- `STRIPE_PRICE_PREMIUM`

Create three recurring prices in Stripe and place their `price_...` IDs in Netlify.

### 6. Stripe webhook

In Stripe, create a webhook endpoint:

`https://YOUR-SITE.netlify.app/.netlify/functions/stripe-subscription-webhook`

Listen for:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

## Test before public signup

1. Create a brand-new test email account.
2. Confirm email and sign in.
3. Verify the onboarding wizard opens.
4. Complete all four steps.
5. Confirm a shop, membership, subscription, AI profile, and seven shop-hour rows appear in Supabase.
6. Confirm the existing dashboard opens.
7. Test two separate accounts and verify neither can read the other's shop data.
8. Use Stripe test mode to purchase each plan.
9. Verify subscription status updates after the webhook runs.
10. Test a failed payment and canceled subscription.

## Next required security pass

Add explicit RLS policies to every existing business table using:

```sql
using (public.user_has_shop_access(shop_id))
with check (public.user_has_shop_access(shop_id))
```

Owners/managers should receive narrower write permissions where appropriate. Payments, refunds, staff permissions, and audit records require stricter policies than ordinary catalog records.
