# Phase 3 Report — August 10 Beta Stabilization (+ Correction R6)

**Branch:** `beta/august10-stabilization`
**Base:** `main` @ `eb690beb0c138db504cd897ef497a9e54c462a4b`
**Starting commit (stabilization):** `eb690be`
**Correction R1 tip:** `09c9ea78abb45a9220dfb2a3a1824d789df4102d`
**Correction R2 tip:** `7880df9e429427b1c6670040ec8ebb8ab0ee5c47`
**Correction R3 tip:** `50f313e6b95d65fe9221e957fd1493662a179ea6`
**Correction R3 docs pin / R4 start:** `6f34825ccf8a65ba68e7397806edabfb44e891ff`
**Correction R4 tip:** `9225b056e95dee06d0aad8495c6fabc733b1d3a7`
**Correction R4 docs tip / R5 start:** `d6fb895bfb7f844760294ab7772a0bde61140826`
**Correction R5 tip:** `f751d94ece9aa966b125103678e7ad02dd55ce53`
**Correction R5 docs tip / R6 start:** `f13e24c66fdad8673472ee4414099ba9775e8a80`
**Correction R6 tip:** `PENDING`

**Draft PR:** https://github.com/ashley396/Bloom/pull/13 — **NOT MERGED**

## Truth (Correction R6)

- Community feature flag **defaults OFF**.
- Community images are **private**; API returns **300s signed URLs** only after `florist_community_image_readable`.
- Image uploads are **fully decoded and re-encoded with `sharp@0.35.3` exactly once** in `validatePostBody` / `validateCommunityImageUpload`. Upload accepts only the prevalidated sanitized object (`valid`, `sanitized`, nonempty buffer, jpeg/png/webp, ≤2 MB) and **never** re-decodes a data URL or runs a second sharp pass.
- **Base64 size is enforced before `Buffer.from`**: declared size and max base64 length are rejected prior to decode; malformed base64 is rejected safely; decoded binary and post-sanitization 2 MB checks remain.
- **Image storage lifecycle (fail-closed reconcile):** after ambiguous create/update write errors, `reconcileCommunityImageAfterWriteError` treats only a real JS array as conclusive (`[]` → remove orphan; non-empty → retain). `null` / `undefined` / unexpected shapes retain with `query_shape`. Query error/throw retain. Logs use only Florisyn-owned codes: `query_error`, `query_throw`, `query_shape`, `remove_error`, `remove_throw`, `unknown` — never provider `error.code` / messages / paths / tokens / URLs. Successful replacement removes the previous object only after DB success; author hard-delete removes image after DB delete; moderator soft-remove **preserves** the image.
- **Active florist membership** requires exactly `shop_members.status = 'active'` (no `coalesce`). Membership constraint compatibility accepts only the exact allowlist `{active, invited, suspended, removed}` — not substring presence of “active”/“suspended”. Incomplete, inverted, or broader constraints abort with a clear error. Apply-twice remains successful.
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
5. **Correction R4** — single-pass image pipeline, pre-base64 size enforcement, storage lifecycle cleanup, exact membership constraint compatibility
6. **Correction R5** — reference-safe reconcile after ambiguous create/update write errors
7. **Correction R6** — fail-closed query-shape handling; Florisyn-owned log-code allowlist only

---

## Security design (R6)

| Control | Implementation |
|---------|----------------|
| Single-pass sanitize | `validatePostBody` → sanitized `v.image`; `uploadPrevalidatedCommunityImage` stores buffer only |
| Pre-base64 size | `parseDataUrl` / `maxBase64LengthForBytes` reject before `Buffer.from` |
| Image lifecycle | Fail-closed reconcile: array-only conclusive responses; retain on null/undefined/unexpected shape |
| Log codes | Allowlist only: query_error, query_throw, query_shape, remove_error, remove_throw, unknown |
| Membership constraint | Exact allowlist compare of extracted statuses; reject `NOT IN` / incomplete / extra statuses |
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

See Correction R6 report for exact totals (`npm test`, check, frontend build, community smoke/RLS, `npm audit --audit-level=high`).

---

## Remaining staging work

- Apply Community v1 then R1 security migration on an **approved** staging project only
- Enable `FLORISYN_FLAG_COMMUNITY_BETA=true` on that env only after TD approval
- Live two-shop + Stripe test + mobile device QA
- Staff A2 remains a separate paused track

---

*End of Phase 3 / Correction R6 documentation.*
