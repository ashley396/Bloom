# Security review summary (Production Readiness v1)

## Netlify functions (58 handlers)

| Control | Implementation |
|---------|----------------|
| Authentication | Bearer JWT via `currentUser()` / Supabase `getUser` |
| Platform admin | `platformAdmin()` for Command Center; high-impact mutations require `super_admin` (Closed Beta) |
| Platform bootstrap | `admin-bootstrap` POST locked after first owner; secret + rate limits — see [FUNCTION-ACCESS-TIERS.md](./FUNCTION-ACCESS-TIERS.md) |
| Tenant isolation | `shop_id` on queries/mutations for florist data |
| Input validation | `_shared/validation.js` on login, orders, inventory, customers |
| Rate limiting | `checkRateLimit()` on auth-login, client-errors |
| Secrets | Service role server-only; admin subscription sanitization; verification tax_id stripped |
| Errors | `safePublicError()` — generic 5xx messages |
| Logging | `structuredLog()` JSON to function logs |

## Recommended follow-ups (post-beta)

- Global rate limit (Upstash/Netlify Blobs) for auth endpoints
- Pagination on large GET lists (orders, payments)
- Automated RLS audit script against Supabase advisors
- WAF / bot protection on public signup

## Functions reviewed pattern

All florist mutators use `currentUser` + `shop_id` filter. Webhooks validate Stripe signatures. Admin routes use `platformAdmin` + `writeCommandAudit`.
