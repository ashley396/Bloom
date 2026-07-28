# Troubleshooting

## Sign-in fails for all users

- Verify `SUPABASE_URL`, `SUPABASE_ANON_KEY`, service role on Netlify.
- Check Supabase Auth providers and email confirmation settings.
- Look for `login_failed` in function logs (no passwords logged).

## 403 on florist actions

- User must have active `shop_members` row for the shop.
- Role may block action (e.g. payroll for staff).

## Payments not updating orders

- Confirm `STRIPE_WEBHOOK_SECRET` and webhook endpoint URL.
- Run verify-checkout manually with session id from redirect.

## Marketplace checkout blocked

- Florist verification must be approved and not expired.
- See marketplace verification tests and admin pending queue.

## AI / Lily empty responses

- Set Cloudflare AI env or run local AI bridge.
- Lily still returns rule-based actions without LLM.

## Client errors spike

- Check `client_error_report` structured logs in Netlify.
- Reproduce with browser devtools; use Beta readiness checklist.

## Performance

- Enable lazy images (Launch Polish); avoid loading all orders without pagination in future.
- Duplicate GETs mitigated by optional client cache in `launch-polish.js`.
