# Florisyn Image System — Brand Standard & Design Plan

**Status:** Standard + design plan. **No code changed, no database modified, nothing deployed.** Awaiting founder approval and sequencing against the active Stage 2 remediation.

**Why this is a plan, not an implementation:** the founder's standing directives require (a) no new product features during Stage 2 remediation, (b) documenting a feature before implementing it (standard #18), (c) standardizing asynchronous work — explicitly including **image processing** — on Supabase Queues/pgmq (standards #4/#5), (d) small/reversible PRs (#9), and (e) no deploy without per-phase approval (#10). The image system is a substantial feature with real Stage-2 implications (storage, async processing, CDN), so it is specified here for approval and phasing.

---

## 1. Brand standard (non-negotiable)

Florisyn is a **luxury florist platform**. Its imagery must read like a premium florist catalog, not generic business software.

1. **Never** use emoji, illustrations, clip art, cartoons, or placeholder graphics to represent flowers, arrangements, plants, or floral products — anywhere (product cards, POS tiles, marketplace, website preview, library, receipts, emails).
2. Every floral product must display a **real, high-quality professional photograph**.
3. Allowed image sources: (a) curated **licensed stock professional floral photography**, (b) **user-uploaded shop photography**, (c) **AI-enhanced** versions of user photography.
4. When no photograph exists yet, use a **neutral, brand-consistent "photo pending" treatment** (a plain typographic/duotone panel in brand colors) — **never** an emoji or cartoon. This state must be visually restrained and clearly temporary, and should prompt the florist to add a real photo.
5. No hotlinking to third-party image hosts in production. All served imagery must be **licensed and stored by Florisyn** (see §7) so it is reliable, optimized, and legally clear.

> This standard applies to all future work. Introducing any emoji/placeholder floral graphic is a brand-compliance defect.

---

## 2. Current-state findings (non-compliance to remove)

Evidence from the current codebase (`public/app.js`), for the remediation backlog:

| Location | Current behavior | Issue |
|---|---|---|
| `app.js` `productCard()` (~line 178) | Falls back to `<div class="product-art">💐</div>` when `image_url` is empty | Emoji placeholder for a floral product |
| `app.js` `renderLibrary()` (~line 179) | Emoji fallback (`p[3]`); catalog images are **external Pexels hotlinks** / `/assets/` | Emoji + third-party hotlinking |
| `app.js` `loadMarketplace()` (~line 190) | Emoji fallback `🌹` | Emoji placeholder |
| `app.js` `renderPosTiles()` / `renderTileEditor()` (~235/236) | Emoji fallback `🧺` for product tiles | Emoji placeholder |
| `app.js` `renderWebsite()` (~line 201) | Hardcoded **Pexels** placeholder products when a shop has no online products | Placeholder/hotlinked floral graphics |
| POS tile upload `#tileImageUpload` (~line 264) | Stores the raw image as a **base64 data URL in `localStorage`** | No optimization, no sizes, not durable, bloats storage |
| `products.image_url`, `marketplace_listings.image_url`, `shops.logo_url/hero_image_url/dashboard_image_url` | Free-text URLs (may be data URLs or external links) | No ingestion/optimization pipeline; no responsive sizes |
| Storage | Only an `expense-receipts` bucket exists (v4.2) | No product-photography or shop-media bucket |
| Delivery | `loading="lazy"` appears only on library images; no `srcset`/`sizes`, no width/height, no cache strategy | Slow loads, layout shift, no responsive delivery |

**Note on the existing `LIBRARY` constant:** it currently encodes an emoji per entry and points at external Pexels URLs. Under this standard, the emoji field is removed and each library item must reference a **licensed, Florisyn-stored** photograph (§7).

---

## 3. Target architecture (maps to the required capabilities)

Requirement → design:

| Required capability | Design |
|---|---|
| Stock professional floral photography | Curated, **licensed** library stored in a public `product-photography` bucket, organized by category; each item has pre-generated renditions. Replaces emoji + Pexels hotlinks. |
| User-uploaded shop photography | Direct-to-Storage upload via short-lived **signed upload URL** into a per-shop `shop-media` bucket; the browser never sends large payloads through functions. |
| AI-enhanced user photography | An **asynchronous** enhancement job (background cleanup / color / upscale) that writes an `ai_enhanced` rendition. Never blocks upload. Runs on Supabase Queues/pgmq (§5). |
| Automatic optimization (web/mobile/POS/print) | Server-side rendition generation into fixed variants (below), modern formats for web, high-quality retained for print. |
| Multiple image sizes | Deterministic renditions: `thumb` (~256px, POS tiles), `card` (~600px, catalog grids), `detail` (~1200px, product page), `hero` (~2000px, website), `print` (original / ≥300 DPI). |
| Fast loading, lazy loading, caching | `loading="lazy"` + `decoding="async"` + explicit `width/height` (prevents CLS); `srcset`/`sizes`; content-hashed, immutable paths with `Cache-Control: public, max-age=31536000, immutable`. |
| Future CDN support | All public image URLs are built from a single `IMAGE_CDN_BASE` env var (defaults to Supabase Storage's CDN). Swapping to a dedicated CDN later is a config change, not a code change. |

### Formats
- Web/mobile: **AVIF + WebP** with a JPEG fallback (`<picture>`/`srcset`).
- POS: small WebP/JPEG thumbnail optimized for fast touch rendering.
- Print: high-quality JPEG (or TIFF) at original resolution; not down-converted to lossy web sizes.

### Processing engine
Netlify Functions are short-lived and not suited to heavy image work. Rendition generation and AI enhancement run in a **queue worker** (a Supabase Edge Function or a dedicated worker consuming pgmq) using a native image library (e.g., libvips/`sharp`). This directly satisfies standard #4 (async, bounded batches, retries, idempotency, DLQ).

---

## 4. Data model (proposed; versioned migration later — not executed)

Two tenant-scoped tables (RLS via the reconciled model `user_has_shop_access` / platform for stock):

```
media_assets
  id uuid pk
  shop_id uuid null            -- null = platform-owned stock photography
  source text                  -- 'stock' | 'upload' | 'ai_enhanced'
  original_path text           -- storage key of the source image
  checksum text                -- content hash for idempotency/dedup
  status text                  -- 'pending' | 'processing' | 'ready' | 'failed'
  width int, height int, bytes bigint
  license text                 -- required for stock; provenance for uploads
  created_by uuid, created_at timestamptz

media_renditions
  id uuid pk
  asset_id uuid fk -> media_assets
  variant text                 -- 'thumb'|'card'|'detail'|'hero'|'print'
  format text                  -- 'avif'|'webp'|'jpeg'
  width int, height int, bytes bigint
  path text                    -- content-hashed storage key (immutable)
  unique (asset_id, variant, format)
```

Product/marketplace/shop records reference a `media_asset_id` (keeping `image_url` temporarily for backfill/compat). RLS: `shop_id` rows use `user_has_shop_access(shop_id)`; stock rows (`shop_id is null`) are world-readable. Storage buckets:
- `product-photography` (public-read, immutable, content-hashed) — stock + published renditions.
- `shop-media` (per-shop originals; public-read renditions via unguessable hashed paths, or signed URLs if kept private).
- existing `expense-receipts` unchanged.

---

## 5. Asynchronous processing (aligns with Stage 2 standards #4/#5)

Upload/enhancement pipeline, on pgmq:
1. Client requests a signed upload URL; uploads the original to `shop-media`.
2. A row is inserted in `media_assets` (`status='pending'`, `checksum`), and a message is enqueued (`image.process`) with the asset id + idempotency key (the checksum).
3. A **bounded-batch worker** consumes the queue: validates the image, generates renditions (thumb/card/detail/hero/print) in modern formats, writes content-hashed paths, updates `media_renditions` + `media_assets.status='ready'`.
4. Optional `image.enhance` job produces an `ai_enhanced` asset from the original; idempotent by (source asset + params).
5. **Retries** with backoff; poison messages go to a **dead-letter** queue after N attempts; failures set `status='failed'` with a reason (surfaced to the florist, never a stack trace — audit H7).
6. **Supabase Cron** only polls/reschedules and runs recovery sweeps (re-enqueue stuck `processing` rows) — not large fan-out (standard #5).

No synchronous image work in the request path (audit H4).

---

## 6. Delivery & front-end rendering (design)

- A single helper builds URLs: `imageUrl(asset, variant)` → `${IMAGE_CDN_BASE}/${path}` and `imageSrcSet(asset)` → width-based `srcset` with `sizes`.
- Every floral image renders with `loading="lazy"`, `decoding="async"`, explicit `width`/`height`, and `<picture>` AVIF/WebP/JPEG.
- The **"photo pending"** component replaces all emoji fallbacks: a brand-colored duotone panel with the product name in the brand serif — no illustration.
- POS uses the `thumb` variant; catalog grids use `card` with `detail` on the product view; website hero uses `hero`; receipts/printing use `print`.

---

## 7. Stock photography & licensing

- Replace all Pexels hotlinks and emoji with a **curated, licensed** professional floral set stored in `product-photography`, mapped to the existing library categories (Everyday, Roses/Love, Birthday, Sympathy/Funeral, Wedding, New Baby, Get Well, Plants, Congratulations, etc.).
- Record license/provenance in `media_assets.license`.
- Provide a shop-facing picker so florists select a licensed stock photo or upload their own; uploaded photos are always preferred for that shop.
- **Action needed from founder:** confirm the licensed stock source/budget (e.g., a commercial florist photography library or commissioned set). No unlicensed or hotlinked imagery ships.

---

## 8. Phasing (respects remediation; each phase gated on approval, #9/#10)

Proposed order — **none started**:

- **I-0 (brand-compliance, small/low-risk):** Remove all emoji/placeholder floral graphics and external hotlinks from `app.js` (product cards, library, marketplace, POS tiles, website preview) and replace with the neutral "photo pending" component. No new backend. This is a defect-removal PR; it can run inside remediation windows if the founder approves, or wait until after Stage 2B.
- **I-1 (storage + model):** Versioned migrations for `media_assets` / `media_renditions` + buckets + RLS (built on the Stage 2B tenancy model). DB-only.
- **I-2 (ingestion + optimization):** Signed-upload flow + pgmq worker generating renditions (rides on the Stage 2 Queues standard). 
- **I-3 (delivery):** `srcset`/`<picture>`/lazy/caching helpers + wire product/POS/website/print to renditions; `IMAGE_CDN_BASE` indirection for future CDN.
- **I-4 (stock library):** Load the licensed catalog; migrate the `LIBRARY` constant to stored assets; remove Pexels.
- **I-5 (AI enhancement):** `image.enhance` async job + florist opt-in.

**Dependency:** I-1..I-5 depend on the Stage 2 tenancy reconciliation (RLS model) and the Queues/pgmq standard, so they should follow or run alongside the relevant remediation phases, not before them.

---

## 9. Acceptance criteria (for when implementation is approved)

- No emoji/illustration/clip-art/placeholder floral graphic anywhere in the product (grep clean; visual QA on product cards, POS, marketplace, website, library, receipts).
- Every floral product shows a real photograph or the neutral "photo pending" panel.
- Each image served with responsive `srcset`, lazy loading, explicit dimensions, and immutable long-cache headers.
- Uploads never block on processing; renditions appear when the async job completes; failures are retried and dead-lettered.
- All served imagery is licensed and Florisyn-stored (no third-party hotlinks).
- Switching CDN is a config change (`IMAGE_CDN_BASE`) with no code edits.

---

## 10. Explicitly NOT done in this document
- No code changed, no emoji removed yet, no migrations written or run, no buckets created, no deploy.
- No licensed photography purchased/loaded (awaiting source/budget confirmation, §7).
- Sequencing against Stage 2 remediation and the brand-compliance quick win (I-0) require founder approval before any implementation begins.
