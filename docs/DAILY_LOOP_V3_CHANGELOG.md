# Daily Loop v3 Changelog

Branch: `cursor/florisyn-daily-loop-v3`  
Base: `cursor/florisyn-daily-loop-v2-7317`  
Migration: **none** (uses Foundation v1 columns already in `20260730_foundation_daily_loop_v1.sql`)

## Summary

Production-ready batch for the florist daily loop: customer communication preferences, delivery proof-of-delivery, inventory freshness wiring, and React Orders preview API integration — all behind safe defaults and tenant scoping.

## 1. Customer contact preferences

- New `_shared/customer-preferences.js` — normalize preferred method (phone/text/email/none), separate marketing consent, no silent opt-in
- `customers.js` — validates preferences, resolves legacy null `{}`, audits `customer_preferences_updated`
- Production UI — customer dialog, CRM cards, order builder preference panel

## 2. Delivery proof of delivery

- New `_shared/delivery-proof.js` — private `delivery-proofs` bucket uploads, 300s signed URLs
- `deliveries.js` — `action: capture_proof` flow with upload validation, manual “delivered without photo” reason, failed upload does not advance status
- Production UI — delivery proof dialog, capture/view proof on delivery cards, proof summary in order edit

## 3. Inventory freshness

- New `_shared/inventory-freshness.js` — date/markup validation
- `inventory.js` — wires `received_at`, `use_by`, `markup_multiplier`, `item_kind`; tenant checks on PATCH/DELETE
- Production UI — freshness fields in inventory dialog, Use First badge, filters (Use First / Expiring Soon / Fresh / Unavailable)

## 4. React Orders preview

- `REACT_ORDERS_PREVIEW` default changed to **false**
- `frontend/src/lib/orders-api.ts`, `order-status.ts`, `hooks/useOrdersPreview.ts`
- `OrdersPage.tsx` — production API when flag on (read-only), fallback to sample + link to production Orders when off or on API failure
- Legacy `NEW` → Pending normalization matches production

## 5. Regression

- Today page (`#dashboardPage`) unchanged
- Floral Asset Library untouched
- Payment Center, invoice navigation, order history, customer dedup, house account badge preserved
- Risky flags (`INVENTORY_AI_INTAKE`, `INVENTORY_RECIPE_DEDUCTIONS`, `VOICE_WAKE`) remain false by default

## Files changed (high level)

| Area | Files |
|------|-------|
| Shared | `customer-preferences.js`, `delivery-proof.js`, `inventory-freshness.js`, `feature-flags.js` |
| API | `customers.js`, `deliveries.js`, `inventory.js` |
| Production UI | `public/index.html`, `public/app.js` |
| React preview | `OrdersPage.tsx`, `orders-api.ts`, `order-status.ts`, `useOrdersPreview.ts` |
| Tests | `tests/foundation-daily-loop-v3.test.js` |
| Docs | This file, `DAILY_LOOP_V3_QA.md`, checklist/security/runbook updates |

## Deploy notes

- **Do not apply new migrations** — requires Foundation v1 migration already applied for new columns
- Owner must ensure private Supabase bucket `delivery-proofs` exists with shop-member RLS (same pattern as `expense-receipts`)
- Enable React preview only with `FLORISYN_FLAG_REACT_ORDERS_PREVIEW=true`

## Stacking order

1. Foundation v1 (`build/florisyn-foundation-v1`) + migration  
2. Daily Loop v2 (`cursor/florisyn-daily-loop-v2-7317`)  
3. Daily Loop v3 (this branch)  
4. Website Studio WS-0…WS-6 (spec in `FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md` — not started)

## Documentation addendum (2026-07-30)

- Website Studio permanent specification added to Master Architecture Bible and blueprint (documentation only; `WEBSITE_STUDIO_V2` flag default `false`).
