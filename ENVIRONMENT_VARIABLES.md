# Environment variables — Bloom 1.0 RC1

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Database and Auth |
| `SUPABASE_ANON_KEY` | Yes | Client auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Netlify functions (server only) |
| `STRIPE_SECRET_KEY` | For card checkout | Stripe Checkout |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Payment reconciliation |
| `STRIPE_CONNECT_CLIENT_ID` | Optional | Connect onboarding |
| `CLOUDFLARE_AI_TOKEN` | Optional | Cloud AI |
| `CLOUDFLARE_ACCOUNT_ID` | Optional | Cloud AI |
| `RESEND_API_KEY` | Optional | Email |
| Google Routes / Maps keys | Optional | Mileage in order builder (if configured in Netlify) |

## Graceful degradation

| Missing | Behavior |
|---------|----------|
| Stripe | Manual payments; checkout button errors clearly |
| Cloudflare AI | Lily rule-based + optional local Ollama bridge |
| Beta feedback table | Settings feedback returns 503 with migration hint |

Validate: `GET /.netlify/functions/production-health`

Also see `docs/production/ENVIRONMENT.md` for extended notes.
