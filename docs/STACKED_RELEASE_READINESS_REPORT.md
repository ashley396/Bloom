# Florisyn Stacked Release — Readiness Report

**Release target:** Foundation v1 + Daily Loop v2 + Daily Loop v3  
**Release branch:** `release/florisyn-foundation-daily-loop-v3`  
**Prepared:** 2026-07-30  
**Verdict:** **READY FOR OWNER PREPARATION** (not ready for unattended production deploy)

---

## 1. Stack verification

### Branch ancestry

| Check | Result |
|-------|--------|
| `build/florisyn-foundation-v1` → base | `96c71ef` |
| `cursor/florisyn-daily-loop-v2-7317` contains Foundation v1 | ✅ `merge-base --is-ancestor` |
| `cursor/florisyn-daily-loop-v3` contains v2 | ✅ `merge-base --is-ancestor` |
| Linear stack (no fork drift) | ✅ v3 = Foundation + v2 + v3 commits only |
| Missing commits between layers | ✅ None detected |

### Commit stack (top → base)

```
release/*     → (merge commits + storage SQL + docs)
30777fc       Website Studio spec (docs only)
e9bd718       Daily Loop v3 features
0591b8f       Daily Loop v2 features
96c71ef       Foundation v1 pre-prod review
a02c7b9       Foundation v1 core
```

### Migrations

| Migration | Introduced in | Duplicated in v2/v3? |
|-----------|---------------|---------------------|
| `20260730_foundation_daily_loop_v1.sql` | Foundation v1 | No — sole schema migration for stack |
| `20260730_foundation_daily_loop_v1_rollback.sql` | Foundation v1 | No |
| `20260730_delivery_proofs_storage.sql` | **Release branch** | New — storage only, not in v3 branch yet |

**v2 and v3 introduce zero additional Postgres schema migrations.** All v3 column dependencies exist in Foundation v1 migration.

### Foundation v1 columns referenced by v2/v3 code

| Column / table | Foundation migration | Used by |
|----------------|---------------------|---------|
| `order_status_history` | ✅ | v2 orders history |
| `customers.contact_preferences` | ✅ | v3 CRM |
| `customers.is_house_account` | ✅ | v2 CRM |
| `customers.deleted_at` | ✅ | v2 dedup filter |
| `deliveries.proof_photo_url`, `signature_name`, `proof_captured_at` | ✅ | v3 proof |
| `inventory.received_at`, `use_by`, `markup_multiplier`, `item_kind` | ✅ | v3 freshness |

---

## 2. UI preservation

| Surface | Changed? | Evidence |
|---------|----------|----------|
| Today page (`#dashboardPage`, POS home) | ✅ **Unchanged** | No diff in dashboard section markup/KPIs between Foundation and v3 |
| Floral Asset Library (`frontend/src/lib/floral-asset-library/`) | ✅ **Unchanged** | Zero file diff Foundation → v3 |
| Mobile nav label tweak | ⚠️ Cosmetic only | `dashboardPage` button label "Home" in mobile nav — does not alter Today layout |

---

## 3. Feature flags (combined release)

| Flag | Foundation v1 | Combined release | Notes |
|------|---------------|------------------|-------|
| `VOICE_WAKE` | false | false | ✅ |
| `INVENTORY_AI_INTAKE` | false | false | ✅ |
| `INVENTORY_RECIPE_DEDUCTIONS` | false | false | ✅ |
| `REACT_ORDERS_PREVIEW` | **true** | **false** | Intentional v3 change — preview off by default |
| `WEBSITE_STUDIO_V2` | n/a | false | Docs-only spec; no implementation |
| `INSTANT_WEBSITE` | true | true | Shipped RC1 module unchanged |
| `DELIVERY_MAPS` | true | true | Unchanged |

No conflicting dual definitions. Env override: `FLORISYN_FLAG_<NAME>=true|false`.

---

## 4. Security verification

| Check | Result |
|-------|--------|
| Secrets in `public/` | ✅ None (`sk_live`, `sk_test`, `SERVICE_ROLE`) |
| Secrets in `frontend/src/` | ✅ None |
| Stripe secret server-only | ✅ `create-checkout.js`, `payment-hub.js` use `process.env` |
| Tenant scoping on v3 APIs | ✅ `customers.js`, `inventory.js`, `deliveries.js` use `.eq("shop_id",shopId)` + `requireRowShopId` |
| Delivery proof private paths | ✅ Storage path `{shop_id}/…`; signed URL 300s |
| Production-only config in git | ✅ No `.env` committed |

---

## 5. Legacy / null handling

| Area | Handling |
|------|----------|
| `contact_preferences` null | `resolveContactPreferences()` → defaults (no marketing opt-in) |
| `NEW` order status | UI maps to Pending; server normalizes |
| Inventory without `received_at` | Falls back to `arrival_date` / created_at |
| Delivery without proof columns pre-migration | App degrades; proof capture requires migration + bucket |

---

## 6. Database migration review (Foundation v1)

| Criterion | Assessment |
|-----------|------------|
| SQL syntax | ✅ Valid PostgreSQL; idempotent guards (`IF NOT EXISTS`, `DROP IF EXISTS`) |
| Idempotency | ✅ Safe to re-run forward migration |
| Destructive changes | ✅ None — additive columns/tables/constraints only |
| Default/null handling | ✅ `contact_preferences` default `{}`; `markup_multiplier` default 3.0; `item_kind` default `flower` |
| Existing rows | ✅ Remain valid; new columns nullable or defaulted |
| Indexes | ✅ `order_status_history_order_idx`, `audit_events_shop_idx` |
| RLS | ✅ `order_status_history`, `audit_events` use `is_shop_member(shop_id)` |
| Rollback limitations | ⚠️ Drops history table + column values; PITR preferred — see rollback doc |

### Pre-migration checks (owner)

```sql
-- Confirm helper exists
select proname from pg_proc where proname = 'is_shop_member';

-- Baseline counts (record results)
select count(*) from public.orders;
select count(*) from public.customers;
select count(*) from public.deliveries;
select count(*) from public.inventory;

-- Confirm no conflicting constraint name
select conname from pg_constraint where conname = 'orders_status_check';
```

### Post-migration checks (owner)

```sql
-- New objects exist
select to_regclass('public.order_status_history');
select column_name from information_schema.columns
  where table_name = 'deliveries' and column_name = 'proof_photo_url';

-- RLS enabled
select relname, relrowsecurity from pg_class
  where relname in ('order_status_history', 'audit_events');

-- Sample order still readable
select id, status from public.orders limit 5;
```

---

## 7. Delivery-proofs storage package

| Item | Status |
|------|--------|
| Migration SQL | ✅ `supabase/migrations/20260730_delivery_proofs_storage.sql` |
| Rollback SQL | ✅ `supabase/rollback/20260730_delivery_proofs_storage_rollback.sql` |
| Private bucket | ✅ `public = false` |
| Max size | ✅ 5,242,880 bytes (5 MB) |
| MIME types | ✅ jpeg, png, webp, heic, heif — matches `upload-validation.js` |
| Shop-scoped RLS | ✅ First path segment = `shop_id` UUID + `is_shop_member()` |
| Cross-tenant denial | ✅ Policy requires membership for shop in path |
| Public URLs | ✅ Disabled (`public = false`) |
| Path convention | ✅ `{shop_id}/{timestamp}-{uuid}.{ext}` |

**Note:** Bucket creation via SQL is supported in this project (same pattern as `expense-receipts` in `v4.2.sql`). No dashboard-only workaround required; owner may still verify in Storage UI after apply.

---

## 8. One-deploy feasibility

| Question | Answer |
|----------|--------|
| Can v1+v2+v3 merge cleanly? | ✅ Yes — linear stack, no merge conflicts expected |
| Single Netlify deploy? | ✅ **Yes** — one build after DB + storage prep |
| Why not three deploys? | Unnecessary — v2/v3 have no separate migrations; code is backward-compatible with Foundation columns |

**Required prep before deploy (not optional):**

1. Supabase backup  
2. Apply `20260730_foundation_daily_loop_v1.sql`  
3. Apply `20260730_delivery_proofs_storage.sql`  
4. Configure env vars (owner checklist)  
5. Single Netlify publish from `release/florisyn-foundation-daily-loop-v3`

---

## 9. Quality gates (release branch)

Recorded at release commit — see CI section in PR body. All gates must pass before owner deploy.

---

## 10. Blockers before production deploy

| Blocker | Owner action |
|---------|--------------|
| Foundation migration not applied | Run forward SQL in Supabase |
| `delivery-proofs` bucket not created | Run storage migration |
| `SITE_URL` / Auth redirect URLs | Configure Supabase + Netlify |
| Stripe test vs live not confirmed | Owner selects mode + keys |
| Email verification redirect untested | Smoke test after staging |
| No staging smoke test completed | Run `STACKED_RELEASE_SMOKE_TEST.md` |

---

## Final verdict

**READY FOR OWNER PREPARATION** — code stack merges cleanly, tests pass, documentation and storage SQL are production-ready packages.  

**NOT READY FOR PRODUCTION DEPLOYMENT** until owner completes migration, storage, environment configuration, and smoke tests.

**NOT BLOCKED** on engineering — blocked only on owner-controlled external steps (Supabase apply, Netlify env, Stripe mode, smoke sign-off).
