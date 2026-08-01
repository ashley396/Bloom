# Security review summary (Production Readiness v1)

## Netlify functions (58 handlers)

| Control | Implementation |
|---------|----------------|
| Authentication | Bearer JWT via `currentUser()` → **member-scoped** Supabase client (`userClient`); RLS enforced on florist routes (Phase 2A A2). Tier-3/webhooks use `admin()` |
| Platform admin | `platformAdmin()` is a server authorization boundary (not a browser DB-access path): verifies the bearer JWT first, then queries `platform_admins` with a service-role client created only after verification (P0-02). **Founding Beta (P0-02 R1):** all four endpoints are `super_admin` only; every mutation calls `requireSuperAdmin(admin)` before its write. **P0-02 R2:** fixed public error catalog; server-owned request IDs; enforced log allowlists; unknown errors never return provider text. **P0-02 R3:** only `platformAdminError()`-branded errors may select non-500 catalog entries (forged `florisynCode` → 500); catalog deeply frozen; shared `parsePlatformAdminJsonBody()` on all four handlers; marketplace missing-table path returns 503 without rejecting the handler promise. **P0-02 R4:** catalog codes resolved via `Object.hasOwn` only; production handlers ignore Netlify context for dependency overrides (factory-bound real deps) |
| Platform bootstrap | `admin-bootstrap` POST locked after first owner; secret + rate limits — see [FUNCTION-ACCESS-TIERS.md](./FUNCTION-ACCESS-TIERS.md) |
| Tenant isolation | `shop_id` on queries/mutations for florist data |
| Input validation | `_shared/validation.js` on login, orders, inventory, customers |
| Rate limiting | `checkRateLimit()` on auth-login, client-errors |
| Secrets | Service role server-only; admin subscription sanitization; verification tax_id stripped |
| Errors | `safePublicError()` — generic 5xx messages |
| Logging | `structuredLog()` JSON to function logs |

## Pull-request CI (P0-03 / P0-03 R1)

Automated pull-request checks workflow: `.github/workflows/p0-required-checks.yml`
(not independently verified here as GitHub branch-protection required checks).

- Triggers on `pull_request` targeting `main` and `workflow_dispatch`
- Top-level `permissions: contents: read` only — no write, deploy, or hosted credentials
- **Core job:** `npm test`, `npm run check`, `npm run frontend:build`, root
  `npm audit --audit-level=high`, `node scripts/audit-frontend-security.mjs`,
  `npm run test:community-smoke`
- **Database security job:** digest-pinned PostgreSQL 16 service; runs
  `npm run test:community-rls` then `npm run test:floral-library-rls`
  (connection failures fail the job)
- No Netlify / Supabase-hosted / Stripe secrets; no production or staging migrations; no deploy steps

### Dependency audit truth (P0-03 R1)

| Scope | Result |
|-------|--------|
| Root `npm audit --audit-level=high` | Zero findings |
| Frontend policy (`scripts/audit-frontend-security.mjs`) | Temporarily accepts **exactly one** advisory: `GHSA-qwww-vcr4-c8h2`, only for `react-router` and `react-router-dom` both pinned at **7.18.2** |

Rationale for the temporary exception: Netlify `publish = "public"` (not `frontend/dist`);
frontend uses client-only `BrowserRouter`; no RSC/server-router entrypoints or dependencies.
**Does not claim zero total frontend vulnerabilities.** Exception expires before React production
migration or **2026-08-15** (UTC), whichever happens first. Review owner: Technical Director.
**P0-03 R2:** exception gates (pin/expiry/publish/RSC) apply only when that approved advisory is
present; a future clean high/critical-free audit passes without those restrictions.

## Recommended follow-ups (post-beta)

- Global rate limit (Upstash/Netlify Blobs) for auth endpoints
- Pagination on large GET lists (orders, payments)
- Automated RLS audit script against Supabase advisors
- WAF / bot protection on public signup

## Functions reviewed pattern

All florist mutators use `currentUser` + `shop_id` filter. Webhooks validate Stripe signatures. Admin routes use `platformAdmin` + `writeCommandAudit`. `platformAdmin()` never trusts an administrator identity from the request body, query parameters, other headers, `user_metadata`, or `raw_user_meta_data` — only the verified JWT `user.id`.
