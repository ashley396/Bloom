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

## Feature gating when missing

| Missing | Behavior |
|---------|----------|
| Stripe secret | Manual payments only; checkout disabled with clear error |
| Stripe webhook | Payments may not auto-reconcile until configured |
| Cloudflare AI | Lily falls back to local bridge or rule-based responses |
| Resend | Email workflows skipped |

Verify live config: `GET /.netlify/functions/production-health`
