# Florisyn Security Review — Foundation v1

**Review date:** 2026-07-30  
**Scope:** Production app (`public/`), Netlify functions (`netlify/functions/`), Supabase RLS, Foundation v1 changes  
**Standard:** Measurable defenses — not a claim of invulnerability.

---

## Executive summary

Florisyn's production stack enforces **tenant isolation via Supabase RLS** and **member-scoped JWT clients** on florist routes. Privileged operations use the **service role only on Tier-3 endpoints** (webhooks, public pay links, storefront) with additional token/signature validation. Foundation v1 adds **honest AI status**, **feature flags**, **order status history**, and **audit event scaffolding** without weakening existing controls.

---

## Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| SEC-01 | Medium | JWT stored in `localStorage` (`bloom_session`) — XSS could exfiltrate session | `public/login.js`, `public/app.js` |
| SEC-02 | Medium | Client never calls `auth-refresh.js` — long sessions may fail silently | `netlify/functions/auth-refresh.js` (unused) |
| SEC-03 | High (if misconfigured) | `FLORISYN_ALLOW_OPEN_BOOTSTRAP=true` bypasses bootstrap secret | `admin-bootstrap.js` |
| SEC-04 | Medium (by design) | Service role on public endpoints (`payment-link-public`, `storefront-public`) — bugs could affect cross-tenant data | Tier-3 handlers |
| SEC-05 | Medium | Marketplace tax encryption optional without `MARKETPLACE_TAX_ENCRYPTION_KEY` | `marketplace-verification*.js` |
| SEC-06 | Low | Duplicate stale root files (`/app.js`, `/ai-assistant.js`) risk contributor confusion | Repo root |
| SEC-07 | Low | 17 CSS files on main app — large attack surface for supply-chain XSS via compromised assets | `public/index.html` |
| SEC-08 | Info | Staff PINs hashed with scrypt; rate limited; not returned in API | `staff.js` |
| SEC-09 | Info | Stripe secret never sent to client; Checkout session created server-side | `create-checkout.js` |
| SEC-10 | Info | `safePublicError()` masks internal 5xx details | `_shared/http.js` |

---

## Fixes completed (Foundation v1)

| Fix | Files | Verification |
|-----|-------|--------------|
| Auth pathname sanitization (open redirect blocked) | `_shared/site-url.js` | `tests/foundation-release-security.test.js` |
| Stripe webhook livemode/key mismatch rejected | `_shared/stripe-mode.js`, `stripe-order-webhook.js` | Security tests |
| Feature flag env override bug | `_shared/feature-flags.js` | Security tests |
| Delivery proof upload validation module | `_shared/upload-validation.js` | Security tests |
| Feature flags default risky modules off (`VOICE_WAKE`, `INVENTORY_AI_INTAKE`, recipe deductions) | `_shared/feature-flags.js` | `tests/foundation-v1.test.js` |
| Order status normalization + history insert on create/patch | `_shared/order-status.js`, `orders.js` | Foundation tests + manual PATCH |
| Auth redirect avoids localhost when `SITE_URL` set | `_shared/site-url.js` | `tests/foundation-v1.test.js` |
| Delivery proof + audit tables with RLS | `20260730_foundation_daily_loop_v1.sql` | Review migration policies |
| Customer soft-delete columns (no hard purge by default) | Same migration | Column exists post-apply |
| Production health exposes flags + AI status (no secrets) | `production-health.js` | GET endpoint JSON |

---

## Remaining risks

| Risk | Mitigation plan | Owner action |
|------|-----------------|--------------|
| XSS → session theft | CSP headers, sanitize user HTML in website builder, migrate to httpOnly cookies long-term | Netlify headers config |
| No global rate limit on all endpoints | Add Upstash/Netlify Blobs rate limiter for auth + AI | Infrastructure |
| Session refresh gap | Wire `auth-refresh` into client before expiry | Dev task |
| MFA for platform admins | Enable Supabase MFA for `super_admin` accounts | Owner admin |
| Automated RLS audit | Script against Supabase security advisors | DevOps |
| Dependency vulnerabilities | `npm audit` — 0 high/critical at review time | CI gate |
| Secret scanning in CI | Add gitleaks/trufflehog to pipeline | DevOps |

---

## Control matrix

| Control | Status | Evidence |
|---------|--------|----------|
| Tenant isolation (RLS) | ✅ Implemented | `is_shop_member(shop_id)` on shop tables |
| No client trust for privileged ops | ✅ Implemented | Mutations via Netlify + JWT or webhook signatures |
| Server-side input validation | ✅ Implemented | `_shared/validation.js` |
| Parameterized DB access | ✅ Implemented | Supabase client (no raw SQL from user input) |
| CSRF | Partial | Same-site cookies N/A (Bearer token); Stripe uses session IDs |
| XSS | Partial | React escapes; production app uses `textContent` mostly — review website HTML export |
| Rate limiting | Partial | Auth login, staff PIN, client-errors |
| Upload validation | Partial | Floral library admin — verify MIME/size server-side on next pass |
| Secure headers | Partial | Netlify defaults; custom CSP recommended |
| Least-privilege roles | ✅ Implemented | Shop member vs platform admin |
| Audit logs | 🟡 Started | `audit_events` table; wiring for all admin actions pending |
| Soft deletion | 🟡 Started | `customers.deleted_at` column added |
| Secret scanning | Manual | No keys in commits; `.env` gitignored |
| Session expiration | ✅ Supabase JWT expiry | Refresh not wired client-side |

---

## Exact files — security-critical paths

```
netlify/functions/_shared/supabase.js      — admin() vs userClient()
netlify/functions/_shared/saas.js          — currentUser(), shop scoping
netlify/functions/_shared/validation.js    — input schemas
netlify/functions/_shared/rate-limit.js      — brute-force protection
netlify/functions/_shared/http.js          — safePublicError, CORS
netlify/functions/_shared/site-url.js      — production redirect URLs
netlify/functions/_shared/feature-flags.js  — unfinished module gates
netlify/functions/_shared/ai-status.js     — honest AI availability
netlify/functions/auth-login.js
netlify/functions/staff.js                 — PIN hash, field stripping
netlify/functions/orders.js                — shop_id filter on all queries
netlify/functions/payment-hub.js           — Stripe server-only
netlify/functions/stripe-order-webhook.js  — signature verification
supabase/migrations/*.sql                  — RLS policies
public/app.js                              — api() Bearer header
```

---

## Verification steps (manual)

1. **Cross-tenant isolation:** Log in as Shop A; attempt API call with Shop B `shop_id` in body → expect 403/empty.
2. **Stripe secret:** Search client bundles for `sk_live` / `sk_test` → must be zero matches in `public/`.
3. **AI status honesty:** Unset AI env vars; open Settings → AI Status → badge shows "Configuration Required".
4. **Staff privacy:** GET `/api/staff` → response must not include `pay_rate`, `ssn`, or raw PIN.
5. **Staff PIN gate:** POST staff `OPEN_FILE` without PIN → 401/403.
6. **Bootstrap lock:** With owner exists, POST `admin-bootstrap` without secret → rejected.
7. **Feature flags:** GET `production-health` → `feature_flags.VOICE_WAKE === false` by default.

---

## Production checklist (before deploy)

- [ ] `FLORISYN_ALLOW_OPEN_BOOTSTRAP` unset or `false`
- [ ] `PLATFORM_BOOTSTRAP_SECRET` set and rotated from dev
- [ ] `SITE_URL` set to production domain (fixes verification emails)
- [ ] Stripe keys match intended mode (test vs live) — **never auto-switch**
- [ ] Supabase service role only in Netlify env (never `VITE_*` or client)
- [ ] Apply migration `20260730_foundation_daily_loop_v1.sql` after backup
- [ ] Review Netlify function logs for accidental PII in AI prompts

---

*Requires ongoing review. Legal policies need licensed attorney review before production use — see `LEGAL_COMPLIANCE_ARCHITECTURE.md`.*
