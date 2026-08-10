# Florisyn Mobile (React Native)

Expo + React Navigation scaffold for the native Florisyn app. Shares API contracts with the web PWA and Netlify functions.

## Stack

- **React Native** via Expo 53
- **React Navigation** — bottom tabs (POS, Orders, Inventory, Library, More) + drawer for full menu
- **Node.js backend** — existing Netlify functions (`/.netlify/functions/*`)
- **AWS scale path** — deploy API behind API Gateway + Lambda (same handlers), RDS/Aurora for Postgres via Supabase, CloudFront for static assets

## Quick start

```bash
cd mobile
npm install
npm start
```

Set `EXPO_PUBLIC_FLORISYN_API=https://www.florisyn.com` before building production binaries.

## Architecture

```
mobile/src/services/apiClient.ts   — resilient fetch wrapper
mobile/src/services/florisynServices.ts — Lily/Rose/Daisy + API factory
lib/assistants/registry.js         — canonical assistant definitions (web + server)
lib/core/resilience.js             — circuit breaker, retry (shared with backend)
```

## High concurrency (1000+ users)

- Stateless Netlify/AWS Lambda functions with connection pooling via Supabase pooler
- Token-bucket rate limiting in `netlify/functions/_shared/enterprise-handler.js`
- Circuit breakers prevent cascade failures when a downstream query fails
- PWA + native clients degrade gracefully when AI (Lily/Rose) is offline — POS keeps working

## Logo

Use `/assets/florisyn/florisyn-official-icon.png` (premium gold/navy mark) for app icons and splash screens.
