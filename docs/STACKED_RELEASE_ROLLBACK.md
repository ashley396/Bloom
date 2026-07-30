# Florisyn Stacked Release — Rollback Plan

**Scope:** Foundation v1 + Daily Loop v2 + Daily Loop v3 combined release  
**Principle:** Preserve orders, payments, and customer records. Roll back application first for immediate relief; database rollback only when necessary.

---

## Rollback order (recommended)

```
1. Halt new deploys / announce maintenance
2. Netlify → publish previous known-good deploy
3. Feature-flag emergency disable (if partial failure)
4. Stripe emergency disable (if payment incident)
5. Storage rollback (only if proof storage causing issues)
6. Database rollback (last resort — Foundation v1 rollback SQL)
7. Verify smoke tests on rolled-back stack
8. Post-incident review
```

---

## 1. Netlify application rollback

**Fastest recovery — do this first.**

1. Netlify Dashboard → **Deploys**
2. Select last known-good deploy (record before release):
   - Pre-stack backup: branch `backup/florisyn-pre-foundation-20260730-1415` @ `3fd33de`
   - Pre-release published deploy ID: ________________
3. **Publish deploy**
4. Verify `/.netlify/functions/health` returns expected response
5. Confirm florists can sign in and create orders

**Effect:** Reverts v2/v3 UI and API behavior. Foundation migration columns remain in DB (usually harmless — old code ignores new columns).

**Limitation:** If migration added constraints (expanded order statuses), old code must still accept those status values or orders with new statuses may display oddly.

---

## 2. Feature-flag emergency disable

Set in Netlify environment (redeploy not always required if functions read env at cold start):

| Flag | Emergency action |
|------|------------------|
| `FLORISYN_FLAG_REACT_ORDERS_PREVIEW=false` | Keep React preview off |
| `FLORISYN_FLAG_DELIVERY_MAPS=false` | Disable maps if API abuse/cost |
| `FLORISYN_FLAG_MARKETPLACE_PUBLIC=false` | Disable marketplace browse |

**Delivery proof:** No feature flag — disable by rolling back Netlify to pre-v3 deploy if proof capture causes incidents.

---

## 3. Stripe emergency disable

1. Remove or unset `STRIPE_SECRET_KEY` in Netlify (stops new checkouts — **use only in emergency**)
2. Disable webhook endpoint in Stripe Dashboard
3. Leave existing `payments` and `orders` rows untouched
4. Manual payments (cash/check) continue via `payments.js` if app version supports it

**Preserve:** Never delete Stripe payment records in Postgres during rollback.

---

## 4. Storage bucket rollback (`delivery-proofs`)

**File:** `supabase/rollback/20260730_delivery_proofs_storage_rollback.sql`

1. Owner approval + backup
2. Run rollback SQL in Supabase SQL Editor
3. Deletes bucket policies and bucket row; removes object metadata
4. **Uploaded proof files:** Rollback script deletes `storage.objects` rows; verify Storage UI empty

**Application state after storage rollback:**

- Deliveries may still have `proof_photo_url` paths in DB — signed URLs will fail (acceptable)
- Proof capture uploads will fail until bucket recreated

**Do not rollback storage** unless storage policies or bucket misconfiguration block all shops.

---

## 5. Database rollback (Foundation v1)

**Preferred:** Supabase **point-in-time restore** to backup taken before Foundation migration.

**Manual SQL:** `supabase/migrations/20260730_foundation_daily_loop_v1_rollback.sql`

### What is lost

| Object | Data loss |
|--------|-----------|
| `order_status_history` table | All history rows |
| Delivery proof columns | Column values (rows kept) |
| `contact_preferences`, `is_house_account`, `deleted_at` | Column values |
| Inventory freshness columns | Column values |
| `audit_events` (if dropped) | Audit rows |

### What is preserved

- All `orders`, `customers`, `deliveries`, `inventory`, `payments` **rows**
- Payment amounts and order totals
- Stripe payment IDs in database

### Order status constraint

Rollback restores narrower status check. Orders with statuses only in Foundation expanded set (`PENDING`, `DELIVERED`, etc.) may violate constraint — **fix statuses before manual rollback** or use PITR instead.

---

## 6. Combined stack rollback matrix

| Symptom | Action |
|---------|--------|
| v3 proof upload broken | Netlify rollback to v2; optional storage rollback |
| v2 session refresh issue | Netlify rollback to Foundation-only deploy |
| Migration failure mid-apply | Do not deploy app; restore DB from backup |
| Payment webhook storm | Disable webhook + Netlify rollback |
| Cross-tenant data concern | **Immediate** Netlify rollback + disable affected function; escalate |

---

## 7. Immediate post-rollback checks

Within 15 minutes:

- [ ] Sign in / sign out works
- [ ] Create order + record payment (manual or Stripe test)
- [ ] Customer list loads
- [ ] Today page loads
- [ ] No 500s on `orders`, `customers`, `payments` functions
- [ ] Stripe dashboard — no error spike on webhooks
- [ ] Owner notified; incident log started

Within 24 hours:

- [ ] Root cause documented
- [ ] Forward path: fix branch → staging smoke → new release window

---

## 8. Re-applying after rollback

```
1. Fix forward on feature branch
2. Staging: Foundation migration → storage migration → deploy release branch
3. Full smoke test (STACKED_RELEASE_SMOKE_TEST.md)
4. Production: same order — single Netlify deploy
```

---

*Rollback scripts do not replace backups. Always maintain Supabase PITR before production migration.*
