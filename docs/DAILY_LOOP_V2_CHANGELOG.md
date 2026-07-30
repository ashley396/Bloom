# Florisyn Daily Loop v2 — Changelog

**Date:** 2026-07-30  
**Branch:** `cursor/florisyn-daily-loop-v2-7317`  
**Base:** Foundation v1 (`96c71ef`) — deploy Foundation v1 before or with this batch

---

## Summary

Production-quality improvements to the florist daily operating loop: session reliability, full order status workflow, status history UI, customer deduplication, and house-account support — without redesigning the Today page or Floral Asset Library.

---

## Changes

### Session reliability
- `public/app.js` — `refreshSessionIfNeeded()` calls `auth-refresh` before token expiry and on 401 retry
- `public/login.js` — stores `expiresAt` from `expiresIn`
- Background refresh every 5 minutes while app is open

### Orders
- Expanded production board to 9 columns aligned with Foundation status vocabulary
- Legacy `NEW` orders appear in **Pending** column
- Advance button follows florist sequence: Pending → Confirmed → Designing → Ready → Pickup Ready → Out for Delivery → Delivered → Completed
- Order edit dialog: status dropdown + status history timeline
- `GET orders?order_id={id}&view=history` returns timestamped status changes

### Customers
- Server-side duplicate detection on phone (normalized) and email
- Returns HTTP 409 with existing customer name — no silent duplicates
- House account checkbox in customer form + list badge
- Soft-delete filter already active server-side (`deleted_at`)

---

## Files changed

| File | Change |
|------|--------|
| `public/app.js` | Session refresh, order statuses, history UI |
| `public/login.js` | Session expiry metadata |
| `public/index.html` | House account, status history, status select |
| `public/styles.css` | 9-column board + status history styles |
| `netlify/functions/orders.js` | History GET endpoint |
| `netlify/functions/customers.js` | Dedup + house account fields |
| `netlify/functions/_shared/customer-dedup.js` | **New** duplicate detection |
| `tests/foundation-daily-loop-v2.test.js` | **New** 9 tests |
| `package.json` | `test:daily-loop-v2` script |

---

## Tests

```bash
npm run test:daily-loop-v2   # 9/9
node --test tests/*.test.js  # 366/366
```

---

## Migration dependency

Order status history requires Foundation v1 migration (`order_status_history` table). Without it, history UI shows a graceful message; all other features work.

---

## Rollback

Revert Netlify deploy to prior commit. No new migration in this batch.

---

## Preserved

- Today page layout (`#dashboardPage` unchanged)
- Payment Center routing after Add Order
- Floral Asset Library architecture
- Stripe server-side secrets
