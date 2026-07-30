# Florisyn Stacked Release — Production Smoke Test

**When:** After single Netlify deploy from `release/florisyn-foundation-daily-loop-v3` and after Foundation v1 + delivery-proofs storage migrations are applied.

**Environment:** Prefer staging clone first; repeat on production after owner approval.

**Legend:** ☐ Pass · ☐ Fail · ☐ N/A (note reason)

---

## 1. Authentication

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1 | Sign up new florist account | Account created; verification email sent | ☐ |
| 2 | Email verification link | Redirects to production URL (not localhost) | ☐ |
| 3 | Sign in | Lands on Today / POS (`dashboardPage`) | ☐ |
| 4 | Session refresh (wait 5+ min or force 401) | `auth-refresh` recovers or prompts re-login cleanly | ☐ |
| 5 | Sign out | Session cleared; redirected to login | ☐ |

---

## 2. Today page (must be unchanged)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 6 | Load Today / Point of Sale | KPIs, design queue, POS tiles render | ☐ |
| 7 | Compare to pre-release screenshot | No layout redesign | ☐ |

---

## 3. Customers (v2 + v3)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 8 | Create customer | Saves; appears in CRM list | ☐ |
| 9 | Duplicate phone/email | 409 rejection with clear message | ☐ |
| 10 | Set contact preference (e.g. Text) + marketing opt-out | Saves; CRM shows preference summary | ☐ |
| 11 | House account checkbox | Badge shows "HOUSE" on card | ☐ |

---

## 4. Orders & payments (v2)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 12 | Create order (walk-in or customer) | Order created | ☐ |
| 13 | Post-create routing | Lands on **Payment Center** when payment required | ☐ |
| 14 | Edit order | Opens editor; save succeeds | ☐ |
| 15 | Status history | Edit order → history section shows entries (after migration) | ☐ |
| 16 | Advance order on board | Status moves; legacy NEW in Pending column | ☐ |
| 17 | Invoices nav | Invoice list loads; view/print works | ☐ |

---

## 5. Delivery proof (v3)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 18 | Capture proof — valid JPEG < 5 MB | Upload succeeds; delivery marked Delivered | ☐ |
| 19 | Invalid file type (PDF) | Error; status **not** Delivered | ☐ |
| 20 | Delivered without photo + reason | Saves with reason; marked Delivered | ☐ |
| 21 | Order edit → delivery proof section | Short-lived signed image URL (expires ~5 min) | ☐ |
| 22 | Proof not in public bucket URL | DB stores path only; no permanent public URL | ☐ |

---

## 6. Inventory (v3)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 23 | Add item with received date + use-by | Saves | ☐ |
| 24 | Use First filter | Shows low-freshness items | ☐ |
| 25 | Legacy item (arrival_date only) | Still displays and edits | ☐ |

---

## 7. Staff privacy

| # | Step | Expected | Result |
|---|------|----------|--------|
| 26 | Staff list | Names only; no pay rates in list | ☐ |
| 27 | Open private file | PIN required | ☐ |

---

## 8. AI status

| # | Step | Expected | Result |
|---|------|----------|--------|
| 28 | Settings / AI badge | Honest state (not fake "online" without credentials) | ☐ |

---

## 9. Stripe (if test keys configured)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 29 | Test card payment | Payment records; order balance updates | ☐ |
| 30 | Webhook processes test event | No livemode mismatch error | ☐ |

---

## 10. Mobile view

| # | Step | Expected | Result |
|---|------|----------|--------|
| 31 | 390px viewport — Today | Usable layout | ☐ |
| 32 | 390px — create order | Form usable | ☐ |
| 33 | 390px — delivery proof capture | Camera/upload works | ☐ |

---

## 11. Health endpoints

```bash
curl -s "https://<site>/.netlify/functions/health"
curl -s "https://<site>/.netlify/functions/production-health" | jq '.feature_flags'
```

| Check | Expected | Result |
|-------|----------|--------|
| `health` | 200 or 503 with clear missing env | ☐ |
| `production-health` | No secret values in JSON | ☐ |
| `REACT_ORDERS_PREVIEW` | false | ☐ |

---

## Sign-off

| Tester | Date | Pass / Fail | Notes |
|--------|------|-------------|-------|
| | | | |

**Fail criteria:** Any blocker in auth, payments, cross-tenant data leak, or Today page regression → halt rollout and execute rollback plan.
