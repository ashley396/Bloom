# Deployment checklist (beta)

## Before deploy

- [ ] `npm run check` passes
- [ ] `node --test tests/*.test.js` passes
- [ ] Env vars set in Netlify (see ENVIRONMENT.md)
- [ ] Migrations applied to staging in documented order
- [ ] Stripe webhooks point to staging URL first

## Deploy

- [ ] Deploy branch `redesign-v22` (or release tag) — **do not merge to main until beta sign-off**
- [ ] Hit `/.netlify/functions/production-health` → `ok: true` for core
- [ ] Florist smoke: login → order → inventory
- [ ] Admin smoke: Command Center → System health → Beta checklist

## After deploy

- [ ] Monitor Netlify function logs for structured `function_error` JSON
- [ ] Monitor Supabase advisors (security + performance)
- [ ] Invite beta shops in waves

## Do not

- Apply unreviewed SQL to production
- Force-push main
- Expose service role in client bundles
