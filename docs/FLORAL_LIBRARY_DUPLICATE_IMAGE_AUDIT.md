# Floral Library duplicate image content audit

**Date:** 2026-08-11  
**Scope:** Everyday collection (`ed-01` … `ed-100`) — batches 1–2  
**Method:** SHA-256 of on-disk JPEG bytes (exact file-content duplicates, not visual similarity)

## Summary

| Metric | Before fix (`ff8409e^`) | After fix (current) |
|--------|-------------------------|---------------------|
| Total arrangements | 100 | 100 |
| Image filenames | 100 | 100 |
| Unique image file hashes | **9** | **100** |
| Duplicate hash groups | **8** | **0** |
| Missing image files | 0 | 0 |
| `needs_image_replacement` | 0 | 0 |

## Before fix — repeated exact file content

Eight SHA-256 groups shared one JPEG blob across multiple arrangement IDs (same bytes, different filenames):

| Hash (prefix) | Arrangement IDs |
|---------------|-----------------|
| `503ef0691b5f9e11` | ed-01, ed-08, ed-11, ed-19, ed-21, ed-26, ed-41, ed-47, ed-54, ed-60, ed-61, ed-75, ed-86, ed-91 (14) |
| `80f48c4c24fa1f9d` | ed-02, ed-10, ed-12, ed-14, ed-15, ed-20, ed-23, ed-27, ed-31, ed-39, ed-42, ed-51, ed-58, ed-59, ed-62, ed-68, ed-72, ed-73, ed-85, ed-88, ed-90 (21) |
| `3f5d54a8d6a8b014` | ed-03, ed-44, ed-49, ed-64 (4) |
| `612c3c0130a8ad8d` | ed-04, ed-33, ed-43, ed-48, ed-57, ed-69, ed-79, ed-98 (8) |
| `f15347b3823db625` | ed-05, ed-09, ed-100, ed-13, ed-16, ed-17, ed-22, ed-24, ed-25, ed-32, ed-36, ed-37, ed-45, ed-50, ed-53, ed-55, ed-56, ed-63, ed-65, ed-74, ed-78, ed-80, ed-83, ed-84, ed-89, ed-93, ed-95, ed-96, ed-99 (29) |
| `a76ec02ac360e320` | ed-06, ed-35, ed-52, ed-67 (4) |
| `f928b883409f8706` | ed-07, ed-28, ed-29, ed-34, ed-40, ed-46, ed-66, ed-70, ed-71, ed-76, ed-77, ed-81, ed-82, ed-87, ed-94, ed-97 (16) |
| `5c20815f9230d287` | ed-18, ed-38, ed-92 (3) |

These were **exact byte-for-byte duplicates** (symlinked/materialized copies of the same source JPG), not merely similar compositions.

## Fix applied

Commit `ff8409e` (PR #81) replaced repeated blobs with **100 unique licensed Pexels downloads**, updating:

- `public/assets/floral-library/everyday/*.jpg`
- `public/data/floral-library-everyday-50.json`
- `public/data/floral-library-everyday-batch-2.json`

Each arrangement now has a unique `content_sha256` matching its on-disk file.

## After fix — verification

```bash
node scripts/audit-floral-library-image-hashes.mjs
npm run test:floral-library-duplicate-hash
npm run test:floral-library-crash
```

Expected: `duplicateHashGroupCount: 0`, `uniqueImageFileHashes: 100`.

## Regression coverage

- `tests/floral-library-duplicate-image-hash.test.js` — fails if any two featured arrangements share the same file hash
- `lib/floral-library/image-hash-audit.js` — shared audit used by script + tests
- Public starter catalog excludes `needs_image_replacement` items via `getPublicFloralLibraryCatalog()`

## Paths audited

- `public/assets/floral-library/everyday/`
- `public/data/floral-library-everyday-50.json`
- `public/data/floral-library-everyday-batch-2.json`
- `public/floral-library-collection.js` (synced from JSON via `npm run sync:floral-library`)
- `netlify/functions/_shared/floral-library-core.js`
- `lib/floral-library/everyday-arrangements.js`
