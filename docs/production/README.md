# Bloom production setup

## Prerequisites

- Node.js 20+
- Netlify site linked to this repository
- Supabase project (URL, anon key, service role key)

## Environment variables

See [ENVIRONMENT.md](./ENVIRONMENT.md). Function access tiers: [FUNCTION-ACCESS-TIERS.md](./FUNCTION-ACCESS-TIERS.md). Run `GET /.netlify/functions/production-health` after deploy to verify.

## Migration order

See [MIGRATION-ORDER.md](./MIGRATION-ORDER.md). **Review every SQL file before apply.** Never run against production without a backup.

## Deployment checklist

See [DEPLOYMENT-CHECKLIST.md](./DEPLOYMENT-CHECKLIST.md).

## Known limitations

- Rate limiting is best-effort per Netlify isolate (not global).
- Client error reports are structured logs + optional `audit_events` (no PII in payloads).
- Cloud AI requires Cloudflare or local AI bridge; features degrade gracefully when unset.
- Stripe Connect and webhooks require full Stripe env configuration.

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
