# Known limitations — Bloom 1.0 RC1

- **Bloom University** — Feature flag only; no in-app University module in RC1.
- **Order/payment lists** — Full fetch for typical shops; pagination planned post-beta.
- **Rate limiting** — Best-effort per function instance; not global edge yet.
- **Mobile navigation** — Bottom nav + “More” prompt; not all sidebar pages on mobile nav.
- **AI** — Requires Cloudflare env and/or local Ollama bridge for full generative quality.
- **Beta feedback** — Requires `20260728_release_candidate_v1.sql` for persistent inbox.
- **Hardcoded demo copy** — Dashboard greeting “Ashley” until shop user profile wiring.
- **Duplicate CSS layers** — Historical polish CSS files; consolidated gradually via Launch Polish.

See also `KNOWN_ISSUES` in `netlify/functions/_shared/bloom-release.js` (shown in Admin Beta toolkit).
