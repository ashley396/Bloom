# Marketing Studio preview path

Batch 6 ("Preview path + CI + provider cleanup + live-readiness"), Part A.
This is the one documented, enforceable non-production path for testing
Marketing Studio changes before beta. It does not exist yet — this
document describes what must be true once it is created, and every guard
this repo ships that keeps it from silently pointing at production.

**Nothing in this batch deploys this site.** Creating and connecting the
Netlify site below is a separate, explicitly-authorized action.

## The one path

- **Site name (preferred):** `florisyn-marketing-staging`
- **Connected to:** `ashley396/Bloom`
- **PR Deploy Previews:** enabled
- **Production domain:** none. No custom domain, and specifically never
  `www.florisyn.com` or `florisyn.com`. Netlify-generated preview URLs
  only (`https://deploy-preview-<n>--florisyn-marketing-staging.netlify.app`).
- **Database:** a dedicated staging Supabase project — never the
  production project. Staging-only accounts and data.
- **Providers:** staging-only credentials only.
- **Publishing:** social publishing and scheduled publishing both
  disabled (`SOCIAL_PUBLISHING_ENABLED=false`,
  `SCHEDULED_PUBLISHING_ENABLED=false` — see `netlify.toml`'s
  `[context.deploy-preview.environment]`).
- **Production Supabase credentials:** absent from this site's
  environment entirely.
- **Production publishing credentials:** absent from this site's
  environment entirely.
- **Commit visibility:** every deploy exposes the exact branch/commit it
  was built from (see "Build stamp" below).

## What enforces this

Nothing above is trusted on its own — every property is a real,
checkable fact, and Marketing generation refuses to run if any of them
is wrong.

- **`netlify/functions/_shared/marketing-preview-environment-guard.js`**
  — `assertSafeMarketingPreviewEnvironment()` / `checkSafeMarketing
  PreviewEnvironment()`. The one reusable, fail-closed guard. Rejects
  when: `FLORISYN_ENV` isn't explicitly `"preview"`/`"staging"`; the
  public site URL resolves to a production Florisyn domain; the
  Supabase host matches the configured production project
  (`PRODUCTION_SUPABASE_HOST`); any real social-publishing OAuth
  credential is present at all; `SOCIAL_PUBLISHING_ENABLED` or
  `SCHEDULED_PUBLISHING_ENABLED` is `true`.
- **`netlify/functions/marketing-preview-status.js`** — a read-only
  status route (`/.netlify/functions/marketing-preview-status`) that
  runs the guard and reports the build stamp together, so "is this
  deploy actually safe, and what commit is it" is answerable from one
  URL rather than inferred.
- **`netlify.toml`'s `[context.deploy-preview]`** — sets
  `FLORISYN_ENV=preview`, `MARKETING_STUDIO_PREVIEW=true`,
  `SOCIAL_PUBLISHING_ENABLED=false`, `SCHEDULED_PUBLISHING_ENABLED=false`
  for every Deploy Preview build, automatically. Every other value in
  the list above (`SUPABASE_URL`, `PRODUCTION_SUPABASE_HOST`, staging
  provider credentials) is set directly in the `florisyn-marketing-
  staging` site's own Netlify UI — never committed to this file.

## Build stamp

`scripts/stamp-build.mjs` (the existing Netlify build hook, run via
`netlify.toml`'s `[build].command`) writes
`public/florisyn-build-info.json` on every build:

```json
{
  "commitSha": "…",
  "commitShaShort": "…",
  "branch": "…",
  "buildTimestamp": "2026-…",
  "environment": "preview",
  "isPreview": true,
  "netlifyContext": "deploy-preview"
}
```

The pure function behind it (`scripts/lib/marketing-build-stamp-info.mjs`,
`buildStampInfo()`) is independently unit-tested
(`tests/marketing-build-stamp-info.test.js`) and never guesses a value —
an environment with no commit info reports `null`, not a fabricated SHA.

## Setting it up (when authorized)

1. Create the Netlify site (`florisyn-marketing-staging`), connect it to
   `ashley396/Bloom`, enable Deploy Previews.
2. In that site's own environment variables (never in `netlify.toml`):
   set `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` to a **dedicated
   staging Supabase project** (never production), set
   `PRODUCTION_SUPABASE_HOST` to the production project's hostname (a
   hostname is not a secret — this lets the guard catch a
   misconfiguration even without knowing the value in advance), and set
   any staging-only provider credentials Marketing generation needs
   (e.g. `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_AI_API_TOKEN` for a staging
   Cloudflare account). Never set a real `FLORISYN_SOCIAL_*_CLIENT_ID`/
   `_CLIENT_SECRET` here.
3. Do not bind a custom domain. Confirm at
   `/.netlify/functions/marketing-preview-status` that
   `safeForMarketingPreview: true` before running any acceptance test
   against it (see `docs/MARKETING_LIVE_ACCEPTANCE.md`).
