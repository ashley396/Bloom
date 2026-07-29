# Bloom Version 1.0 RC1 — Release Notes

**Branch:** `release-candidate-v1`  
**Label:** Bloom Version 1.0 RC1  
**Code:** `1.0.0-rc.1`

## Summary

First release candidate for real florist beta. Builds on marketplace, wholesale seller, Command Center, Lily AI, Launch Polish, and Production Readiness work. Focus is stability, documentation, admin beta toolkit, and version visibility — not new product modules.

## Highlights

- Florist POS, orders, inventory, customers, payments, staff, reports, website studio, Lily AI Studio
- Marketplace verification, browse/checkout, wholesale seller dashboard
- Bloom HQ Command Center with beta toolkit (checklist, feedback inbox, known issues, migration probes)
- Shared validation, audit logging, client error reporting, production health endpoints
- Launch Polish: design tokens, help bars, onboarding checklists, product galleries, accessibility touches

## Admin beta toolkit

- **Beta checklist** — manual QA tracking (browser-local + server checklist reference)
- **Feedback inbox** — florists send feedback from Settings; admins view in Command Center (requires migration review)
- **Known issues** — documented limitations for RC1
- **Version & migrations** — live probe of expected Supabase tables

## Breaking / configuration

- Stripe and Cloudflare AI remain optional; warnings shown in System health
- Some features require forward-only SQL migrations (see SQL_MIGRATION_ORDER.md)

## Not in RC1

- Bloom University module (feature flag only)
- Global edge rate limiting
- Paginated order/history APIs at scale

## Upgrade from redesign-v22

Checkout `release-candidate-v1`. Do not merge to `main` until beta sign-off.
