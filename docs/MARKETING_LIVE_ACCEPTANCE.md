# Marketing Studio live-provider acceptance testing

Batch 6 ("Preview path + CI + provider cleanup + live-readiness"), Parts
K/L/M. **Prepared, not run.** This session has no deployed
`florisyn-marketing-staging` preview and no staging credentials, and
running this against a real provider requires separate, explicit
authorization even once both exist (Part Q). Nothing in this document has
been executed.

## What this is

A controlled, bounded way to prove Marketing Studio's real text provider,
real image provider, and real vision inspection actually work together
against a live, non-production preview — once one exists — without ever
touching www.florisyn.com or production data.

The harness: `scripts/marketing-live-acceptance.mjs`. Its own logic
(report shape, the "exactly one bounded run" rule, refusing an unsafe
target) is unit-tested against a stubbed `fetch` in
`tests/marketing-live-acceptance.test.js` — real assertions, never a real
network call.

## Preconditions before running this for real

1. `florisyn-marketing-staging` is deployed and authorized (see
   `docs/MARKETING_PREVIEW_PATH.md`).
2. `https://<preview-url>/.netlify/functions/marketing-preview-status`
   reports `safeForMarketingPreview: true`. The harness re-checks this
   itself before every run and refuses otherwise — this step is just
   Ashley's own sanity check before spending anything.
3. A real staging-only account/session token for a test shop on that
   staging Supabase project.
4. Ashley has explicitly authorized spending real provider cost for this
   run.

## Running it (once authorized)

```
MARKETING_ACCEPTANCE_BASE_URL="https://deploy-preview-N--florisyn-marketing-staging.netlify.app" \
MARKETING_ACCEPTANCE_AUTH_TOKEN="<real staging session token>" \
FLORISYN_ENV=preview \
node scripts/marketing-live-acceptance.mjs "<one of the four prompts below, verbatim>"
```

One process invocation = one bounded run for one prompt. The result is
written once to `acceptance-results/marketing-live/<prompt-id>--<commit
sha>.json` and never overwritten by a later run against the same commit —
run it once per prompt per commit under test, read the result, don't loop
trying to get a better-looking one (Part K: "the first result is the test
result").

## The four prompts (Part L, verbatim — do not run any of these against
a live provider without authorization)

### Prompt 1 — generic daily post
> Create today's Facebook post for Lilies in Bloom.

Pass criteria: no specific flower names unless grounded/requested; no
invented shop facts; no invented "today/open today" claim unless
verified; one coherent concept; professional floral visual; caption,
image, and flyer all aligned with each other; not a generic pink-circle
or broken-template result; no fabricated physical-shop details.

### Prompt 2 — explicit flower request
> Create a Facebook post featuring pink roses.

Pass criteria: roses may be named (the request itself named them); no
invented inventory, availability, or arrival-state claim; both the visual
and the caption reflect roses; no extra, unrequested flower claim.

### Prompt 3 — operational notice
> Create a Facebook post saying Lilies in Bloom will close at 3 PM today.
> Call 606-506-4039 to place an order.

Pass criteria: the exact "3 PM" and the exact phone number survive
byte-for-byte; no fabricated flowers; no invented promotion; the
deterministic operational content stays exact (per
`.claude/rules/marketing-studio.md`'s deterministic-notice rule); an
image/template fallback is acceptable here; no hallucinated shop detail.

### Prompt 4 — generic sympathy
> Create a sympathy Facebook post for Lilies in Bloom.

Pass criteria: sympathy tone is correct; no unsupported specific flower
name; no invented standing-spray/casket-product availability claim unless
verified or requested; no accidental promotional tone; image and copy are
coherent together; a respectful, florist-quality result.

## Report format (Part M)

Per prompt, the harness's own JSON output records:

| Field | Source |
|---|---|
| `commit_sha` / `commit_sha_short` | the target's real build stamp (`marketing-preview-status`) |
| `preview_url` | the exact base URL tested |
| `environment` | the target's real reported environment |
| `shop_id` | the shop the run was made against |
| `provider` / `model` | the newest `marketing_generation_usage` row's real values |
| `provider_call_count` / `image_attempt_count` | counted from real new usage-ledger rows, never assumed |
| `vision_call_count` | **honestly `null`** — the client-facing API does not expose this; see the harness's own comment for what a real read would require |
| `estimated_cost_cents` / `actual_cost_cents` | summed from the real new usage-ledger rows |
| `quality_gate_verdict` | **honestly not exposed** by `generate_content`'s response today — recorded as a note, never fabricated |
| `fallback_used` | `true`/`false` only when a real usage row's `cost_source` says so; `null` (never a guessed default) when there's nothing to read |
| `canonical_concept` | the real `copy` object `generate_content` returned |
| `first_untouched_caption` / `first_untouched_image_reference` | the exact first response — never a value from a later retry |
| `approval_readiness` | honestly noted as not fully observable from a single harness call alone (a flyer specifically still needs `finalize_flyer_render`) |
| `pass_fail` | `"fail"` only for a genuine HTTP/handler failure; a successful call is `"recorded"` — matching Part L's own criteria against the actual content is Ashley's call, not an automated guess |
| `failure_reason` | the real HTTP status + body on a genuine failure, `null` otherwise |

No secret, token, or credential is ever written into a report file.

## What this batch deliberately leaves undone

- `generate_content`'s response does not currently expose a raw
  PASS/FALLBACK/FAIL quality-gate verdict or a vision-call count to the
  API caller — `runMarketingImageQuality()` computes both internally.
  Exposing them would need a small, separate, explicitly-authorized
  change to `generate_content`'s own response shape; not made in this
  batch (Part O: don't widen scope beyond what preview testing needs).
- Nothing above has been run. `acceptance-results/marketing-live/` does
  not exist in this repo yet — it is created only the first time the
  harness actually runs.
