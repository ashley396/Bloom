# Beta test plan — Bloom 1.0 RC1

## Participants

- 3–5 pilot florists (single location)
- 1 wholesaler seller account
- 1 platform admin

## Week 1 — Core shop

| # | Workflow | Pass criteria |
|---|----------|---------------|
| 1 | Login / logout | Session persists; logout clears local session |
| 2 | Customer CRUD | Validation on email/phone |
| 3 | Order create → delivery | Order board updates; delivery row when applicable |
| 4 | Payment manual + Stripe (if configured) | Balance updates correctly |
| 5 | Receipt / print | Receipt dialog prints |
| 6 | Invoice list | Reflects order payment state |
| 7 | Inventory add/adjust | Audit event when table exists |

## Week 2 — Grow & wholesale

| # | Workflow | Pass criteria |
|---|----------|---------------|
| 8 | Marketplace verification | Submit → admin review path |
| 9 | Marketplace purchase | Blocked until approved |
| 10 | Seller publish | Draft → published; audit logged |
| 11 | Lily commands | Permission denial for restricted roles |
| 12 | Staff clock / payroll fields | Staff page usable |
| 13 | Reports export | CSV downloads |
| 14 | Website studio preview | Preview updates; no auto-publish claim |

## Admin

| # | Item | Pass criteria |
|---|------|---------------|
| 15 | Command Center auth | Non-admin blocked |
| 16 | Beta toolkit | Version, migrations, known issues visible |
| 17 | Feedback inbox | Florist feedback appears after migration |

## Reporting

- File issues via Settings → **Send beta feedback**
- Admin marks Beta checklist items in Command Center
- Run `node --test tests/*.test.js` before each weekly build
