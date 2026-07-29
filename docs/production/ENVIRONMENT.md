# Environment variable reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | **Yes** | Supabase project URL |
| `SUPABASE_ANON_KEY` | **Yes** | Client-safe key (login) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Server-side functions (never expose to browser) |
| `STRIPE_SECRET_KEY` | For card payments | Checkout and subscriptions |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Verify Stripe events |
| `STRIPE_CONNECT_CLIENT_ID` | Optional | Connect onboarding |
| `CLOUDFLARE_AI_TOKEN` | Optional | Hosted AI assistant |
| `CLOUDFLARE_ACCOUNT_ID` | Optional | Hosted AI assistant |
| `RESEND_API_KEY` | Optional | Transactional email |
| `PLATFORM_BOOTSTRAP_SECRET` | **Yes** (production HQ) | One-time key for first platform owner setup via `admin-bootstrap` POST |
| `FLORISYN_ALLOW_OPEN_BOOTSTRAP` | Optional (local dev only) | Set `true` to allow POST without secret when `PLATFORM_BOOTSTRAP_SECRET` is unset — **never in production** |

## Platform owner bootstrap

1. Generate a long random string for `PLATFORM_BOOTSTRAP_SECRET` in Netlify **before** deploying Bundle A1+.
2. Open `/admin`, complete first-time owner setup, paste the key into **Platform setup key** (not stored in the repo).
3. After the first row exists in `platform_admins`, **POST bootstrap returns 409 permanently**; only admin login works. GET still returns `{ ownerExists: true }` for the admin UI.

## Feature gating when missing

| Missing | Behavior |
|---------|----------|
| Stripe secret | Manual payments only; checkout disabled with clear error |
| Stripe webhook | Payments may not auto-reconcile until configured |
| Cloudflare AI | Lily falls back to local bridge or rule-based responses |
| Resend | Email workflows skipped |

Verify live config: `GET /.netlify/functions/production-health`
