# Security review summary (Production Readiness v1)

## Netlify functions (58 handlers)

| Control | Implementation |
|---------|----------------|
| Authentication | Bearer JWT via `currentUser()` → **member-scoped** Supabase client (`userClient`); RLS enforced on florist routes (Phase 2A A2). Tier-3/webhooks use `admin()` |
| Platform admin | `platformAdmin()` is a server authorization boundary (not a browser DB-access path): verifies the bearer JWT first, then queries `platform_admins` with a service-role client created only after verification (P0-02). **Founding Beta (P0-02 R1):** all four endpoints are `super_admin` only; every mutation calls `requireSuperAdmin(admin)` before its write. **P0-02 R2:** fixed public error catalog; server-owned request IDs; enforced log allowlists; unknown errors never return provider text. **P0-02 R3:** only `platformAdminError()`-branded errors may select non-500 catalog entries (forged `florisynCode` → 500); catalog deeply frozen; shared `parsePlatformAdminJsonBody()` on all four handlers; marketplace missing-table path returns 503 without rejecting the handler promise |
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

All florist mutators use `currentUser` + `shop_id` filter. Webhooks validate Stripe signatures. Admin routes use `platformAdmin` + `writeCommandAudit`. `platformAdmin()` never trusts an administrator identity from the request body, query parameters, other headers, `user_metadata`, or `raw_user_meta_data` — only the verified JWT `user.id`.
