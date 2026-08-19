# Florisyn Playwright smoke suite

`npm run test:e2e` runs a small, fast, credential-free smoke check against
the real `public/` bundle — no Supabase, Stripe, or any other live backend
involved. `tests/e2e/static-server.mjs` serves `public/` with just the
handful of `netlify.toml` redirects the suite needs (`/login`, `/signup`,
the `/*` → `/index.html` SPA catch-all); `playwright.config.js` starts that
server automatically before the tests run.

## What this suite is (and isn't)

It answers one question: **does the shipped bundle actually boot in a real
browser** — every `<script>` tag loads and executes without throwing, the
real unauthenticated entry points (login, signup, a legal page) render
their real content, and the SPA's own auth gate correctly routes an
unauthenticated visitor to `/login`.

It does **not** exercise authenticated app flows (Orders, POS, Payment
Center, Website Studio, ...) — those need a real Supabase session and
usually Stripe, neither of which exists in this sandbox. Testing those
requires either a seeded staging database with real test credentials, or
building out `page.route()` fixtures for every Netlify Function an
authenticated page calls; that's a meaningfully bigger effort than "a
minimal smoke test" and should be its own follow-up, not bolted onto this
suite.

## Adding a case

Keep new cases in this same spirit: fast, deterministic, no real network
calls (block/fulfill anything external via `page.route()`, following the
pattern already in `smoke.spec.js`), and assert on real rendered content
— not just "the page returned 200."
