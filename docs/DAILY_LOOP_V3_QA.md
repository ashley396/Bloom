# Daily Loop v3 QA Checklist

Use after merging/deploying v3 on top of Foundation v1 + Daily Loop v2. **Do not apply new migrations for v3.**

## Customer contact preferences

- [ ] Add customer with preferred method **Text**, marketing **unchecked** → saves, CRM shows “Text · Marketing opted out”
- [ ] Edit customer → opt in to marketing → saves with explicit checkbox; audit event if audit table present
- [ ] Edit customer → opt out of marketing → marketing_opt_out timestamp recorded server-side
- [ ] Legacy customer (null `contact_preferences`) → opens without error, shows “No preference · Marketing opted out”
- [ ] Order builder → select customer → communication preference panel appears
- [ ] Cross-tenant: PATCH customer from another shop returns 403 (API test)

## Delivery proof

- [ ] Delivery card → **Capture proof** → upload JPEG under 5 MB → marks **DELIVERED** with proof
- [ ] Upload PDF or oversize image → error shown, status **not** DELIVERED
- [ ] **Delivered without photo** → reason required → marks delivered with reason in notes
- [ ] Order edit (authorized user) → delivery proof section shows signed image (expires ~5 min)
- [ ] Advance to Delivered without proof → prompted to capture proof first
- [ ] Cross-tenant delivery proof request → 403
- [ ] Proof stored in private `delivery-proofs` bucket (not public URL in DB)

## Inventory freshness

- [ ] Add/edit item with received date, use-first date, lot code, markup multiplier
- [ ] Legacy item (only `arrival_date`) still displays and saves
- [ ] **Use First** filter shows low freshness / near use-by items
- [ ] **Expiring Soon**, **Fresh**, **Unavailable (0 qty)** filters work
- [ ] Invalid markup (0 or 100) rejected server-side
- [ ] use_by before received_at rejected
- [ ] Quantity not auto-decremented on save (manual inventory only)

## React Orders preview

- [ ] Default (`REACT_ORDERS_PREVIEW=false`) → `/orders` in React app shows fallback + link to production Orders
- [ ] Set `FLORISYN_FLAG_REACT_ORDERS_PREVIEW=true` → signed-in session loads production orders (read-only)
- [ ] API failure → sample fallback + production Orders link
- [ ] Legacy status **NEW** displays as **Pending**

## Regression (must pass)

- [ ] Today / POS page unchanged visually and functionally
- [ ] Add Order → Payment Center flow intact
- [ ] Invoices list and navigation work
- [ ] Order edit + status history work
- [ ] Customer duplicate phone/email → 409
- [ ] House account badge on CRM cards
- [ ] Stripe secrets not in client bundle (spot-check network tab)
- [ ] Staff private file / PIN flow unchanged
- [ ] AI status badge honest when cloud AI not configured
- [ ] `INVENTORY_AI_INTAKE`, `INVENTORY_RECIPE_DEDUCTIONS`, `VOICE_WAKE` false in `production-health`

## Automated gates (CI / agent)

```bash
npm test
node --test tests/foundation-daily-loop-v3.test.js
npm run check
npm run frontend:build
cd frontend && npm run lint
npm audit --audit-level=high
# client secret scan: rg 'sk_live|sk_test|SUPABASE_SERVICE_ROLE' public/ frontend/src/
```

## Owner blockers

- Foundation v1 migration applied in production Supabase
- `delivery-proofs` storage bucket + RLS (mirror `expense-receipts` policy)
- React preview opt-in via env flag only when ready
