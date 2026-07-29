# Full application audit — RC1

**Branch:** `release-candidate-v1`  
**Date:** 2026-07-28

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| Florist POS | OK | Dashboard, pads, cart, checkout |
| Customers | OK | Search, validation server-side |
| Orders | OK | Builder, board, inventory tie-in |
| Payments | OK | Stripe + manual; role gated |
| Inventory | OK | Scan flow, freshness, validation |
| Payroll / Staff | OK | Staff page; device clock local + staff records |
| Marketplace | OK | Experience module, verification gate |
| Wholesale / Seller | OK | Dedicated dashboard |
| Admin Command Center | OK | Beta toolkit added RC1 |
| Lily AI | OK | Global panel + engine; permissions |
| Website Builder | OK | Studio + preview |
| Bloom University | **Not shipped** | Flag only |
| Settings | OK | Version + beta feedback RC1 |
| Reports / Invoices | OK | Derived from orders |
| Receipts | OK | Print dialog |

## Findings addressed in RC1

- `aiStudioPage` now refreshes AI diagnostics on navigation
- Version label surfaced (Settings, Admin, About footer)
- Beta feedback path florists → admin inbox (with migration)
- Admin Beta toolkit consolidates checklist, issues, migrations

## Open items (non-blocking for beta)

| Finding | Severity |
|---------|----------|
| No TODO/FIXME in JS/HTML/CSS grep | — |
| Multiple legacy CSS files (`polish-v20`, `bloom-v23`) | Low — cosmetic debt |
| Mobile “More” text prompt | Low |
| Dashboard “Ashley” hardcoded | Low |
| Product tabs on POS (Scan/Visual) partial nav only | Low |

## Workflow coverage

Documented in [BETA_TEST_PLAN.md](./BETA_TEST_PLAN.md). Automated: 68+ unit tests for validation, marketplace, Lily, production helpers.

## Security / performance / a11y

See `docs/production/SECURITY-REVIEW.md`, `PERFORMANCE-NOTES.md`, and Launch Polish (skip link, focus, empty/error states).

## Dead links

Public help/company paths referenced from footer exist under `public/help/` and `public/company/`.

## Console errors

No known systematic errors; client monitor reports to `client-errors` function.
