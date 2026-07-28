# Bloom RC1.1 — Public Storefront & Editor Completion

Review-only SQL: `supabase/migrations/20260728_bloom_rc1_1_storefront.sql`

Public routes: `/store/:shopSlug/...` → `public/storefront/`

Env: `BLOOM_STOREFRONT_PREVIEW_SECRET` (optional; falls back to payment hub key in dev)
