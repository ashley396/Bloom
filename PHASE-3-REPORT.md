# Phase 3 Report — August 10 Beta Stabilization (+ Correction R3)

**Branch:** `beta/august10-stabilization`
**Base:** `main` @ `eb690beb0c138db504cd897ef497a9e54c462a4b`
**Starting commit (stabilization):** `eb690be`
**Correction R1 tip:** `09c9ea78abb45a9220dfb2a3a1824d789df4102d`
**Correction R2 tip:** `7880df9e429427b1c6670040ec8ebb8ab0ee5c47`
**Correction R3 tip:** see latest commit on branch after R3 push

**Draft PR:** https://github.com/ashley396/Bloom/pull/13 — **NOT MERGED**

## Truth (Correction R3)

- Community feature flag **defaults OFF**.
- Community images are **private**; API returns **300s signed URLs** only after `florist_community_image_readable`.
- Image uploads are **fully decoded and re-encoded with `sharp@0.35.3`** (not header-only parsing). EXIF/GPS/metadata are stripped; only the sanitized buffer is stored.
- **Active florist membership** requires exactly `shop_members.status = 'active'` (no `coalesce`). Membership migration fails loudly on incompatible schema/data.
- **v1 alone is locked**: private bucket, no public image read, no anon/authenticated Community access, SECURITY DEFINER helpers not executable by clients.
- Broad moderator UPDATE/DELETE policies removed; status-only hardened RPCs only.
- Storage DELETE: active image owner only; managers/platform admins cannot direct-delete; service_role cleanup remains.
- Platform admin authorization uses `is_platform_admin_user()` RPC.
- `requireActiveFlorist()` is fail-closed.
- Report insert is conflict-safe (`ON CONFLICT DO NOTHING`).
- Migrations **not** applied to staging or production.
- **Staff A2 remains paused**.
- No production deployment.
- PR #12 untouched; Today page untouched; React migration not started.

---

## Commits (functional)

1. Initial Community Beta work on this branch
2. **Correction R1** — `09c9ea7`
3. **Correction R2** — `5c0d100` / docs `7880df9`
4. **Correction R3** — sharp decode/re-encode, v1 locked-alone, storage-delete lockdown, fail-loud membership, canModerate truth

---

## Security design (R3)

| Control | Implementation |
|---------|----------------|
| Image sanitization | `sharp@0.35.3` full decode → re-encode; strip metadata; 2 MB before/after; pixel/dimension limits |
| v1 locked alone | Private bucket; drop all Community policies; revoke helper EXECUTE from anon/authenticated |
| Fail-loud membership | Guarded status add/migrate; incompatible constraint/values raise clear exceptions (no `WHEN OTHERS`) |
| Image readability | Active posts → active florists; moderated → active author / active manager / platform admin |
| Storage DELETE | Active owner only; no manager/admin direct delete |
| canModerate API truth | Computed via `moderatorForPost` / role+platform-admin; never hardcoded `true` on create |

---

## Migrations / apply process

| File | Applied to staging/prod? |
|------|--------------------------|
| `20260731_florist_community_beta_v1.sql` | **No** |
| `20260731_florist_community_beta_v1_r1_security.sql` | **No** |
| Staff A2 | **Paused** |

**Local apply (history-preserving; stops on failure):**
```bash
npm run db:community-local
# modes:
# COMMUNITY_APPLY_MODE=v1-alone   → locked v1 only
# COMMUNITY_APPLY_MODE=r1-again   → re-apply security migration without reset
```

Do **not** paste insecure intermediate SQL by hand in production. Apply migrations in order through the approved process; if the security migration fails, v1 remains locked.

**Rollback:** restore DB backup. Prefer backup restore over partial drops.

**Supabase security advisor:** MCP unavailable/unauthenticated in this environment.

---

## Tests

See Correction R3 report for exact totals (`npm test`, foundation/daily-loop suites, community smoke/RLS, apply-twice, concurrency, `npm audit --audit-level=high`).

---

## Remaining staging work

- Apply Community v1 then R1/R2/R3 security migration on an **approved** staging project only
- Enable `FLORISYN_FLAG_COMMUNITY_BETA=true` on that env only after TD approval
- Live two-shop + Stripe test + mobile device QA
- Staff A2 remains a separate paused track

---

*End of Phase 3 / Correction R3 documentation.*
