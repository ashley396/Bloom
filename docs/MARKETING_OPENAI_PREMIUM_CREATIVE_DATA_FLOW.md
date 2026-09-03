# Marketing Premium AI Creative (OpenAI) — Technical Data-Flow Documentation

**Status: NOT LIVE.** This document describes what would be sent to
OpenAI once "Premium AI Creative" is explicitly activated for live
traffic — a separate, future, explicitly-approved change (Hybrid
Marketing Studio Batch 1, Part 12). As of Batch 1, nothing in
`marketing-studio.js` or any other live call site sends a request to
OpenAI. This is a **technical data-flow reference for future legal/
privacy review** — Part 10 of Batch 1 explicitly scopes this document to
that, and no further: **no privacy-policy customer-facing text is added
by this document or this batch.**

## What gets sent to OpenAI, and where it comes from

When Premium AI Creative is eventually enabled for a request, exactly the
following — and nothing else — would be sent, all built by
`marketing-openai-creative-brief.js`'s `buildOpenAiCreativeBrief()`:

| Field | Source | Notes |
|---|---|---|
| `occasion`, `objective`, `visualFamily` | The request's own `canonicalConcept` (`marketing-canonical-concept.js`) | Already computed for every Marketing Studio request today, live or not. |
| `compositionIntent`, `imageProminence`, `paletteMood`, `visualMood`, `typographyPersonality`, `ornamentAmount`, `brandingTreatment` | The request's own `creativeDirection` (`marketing-creative-direction.js`) | Structural/style intent only — no business facts. |
| `factsAllowed` | The shop's own **verified** brand record (name, phone, address) *and* fact tokens (phone/price/date/time/URL) that already passed `evaluateMarketingOutput()`'s safety pass | Never raw, unchecked request text — see "What is never sent" below. |
| `styleText` | Sentences from the fact-safe copy plan that carry no recognized fact token | Safe to hand to the image model as tone/mood language. |
| `deterministicText` | Sentences from the fact-safe copy plan that DO carry a fact token | **Reserved for Florisyn's own deterministic overlay/composition — never sent to the image model as free text to render.** The image model is never asked to render literal words, numbers, or signage (`.claude/rules/marketing-studio.md`). |
| `referenceImage` (optional) | A florist-uploaded reference photo's own metadata (e.g. a short description) | Metadata only — structurally cannot become a fact source (see below). |
| The shop's own logo (optional, future editing/reference workflow) | The shop's own verified brand asset | Only when the florist's own request is actually about that shop's branding. |

## What is never sent

- **Raw, unchecked request text.** Ashley's own instruction (Part 7):
  "Do not send raw unchecked request text to the image model as the
  authority on business facts. Florisyn's grounded objects remain
  authoritative." The brief builder has no code path that reads a raw
  `requestText` field at all.
- **Unverified claims.** A same-day-delivery, open-now, walk-ins-welcome,
  or similar service-availability claim is only ever includable if it
  already survived `detectUnverifiedServiceAvailabilityClaim()` (Batch 1,
  Part 2) — the same evaluator gate every other Marketing Studio surface
  uses.
- **Any other customer/order data.** Order history, customer contact
  info, payment data, other shops' data, or anything not specific to
  *this* marketing-content request. The brief builder's inputs are
  scoped to exactly the four parameters above — there is no code path by
  which an unrelated table's data could reach it.
- **A fact mined from a reference image.** `referenceImage` carries only
  short descriptive metadata the florist or system supplies about the
  image, and is explicitly excluded from `factsAllowed` — see
  `buildOpenAiCreativeBrief()`'s own doc comment and the
  "reference-image-cannot-become-fact-source" test in
  `tests/marketing-openai-creative-brief.test.js`.

## Where the request would go, and how it's protected today

- The eventual API call is a server-side POST from
  `netlify/functions/_shared/marketing-image-provider-openai.js` to
  `https://api.openai.com/v1/images/generations` (or `/v1/images/edits`
  for the reference-image workflow) — never from the browser.
- `OPENAI_API_KEY` is read server-side only, exactly like the existing
  Cloudflare adapter's own credentials; it is asserted (via automated
  test — see `tests/marketing-image-providers.test.js`'s
  "no-key-leak-to-client" test) to never appear in any `public/*.js`
  file.
- Per OpenAI's own current API data policy (third-party-triangulated via
  WebSearch during the architecture-review pass — not a primary fetch of
  OpenAI's pricing/policy page, since this sandbox's network policy
  blocks direct access to openai.com): API content is not used to train
  OpenAI's models by default, is retained only for a short
  (~30-day) abuse-monitoring window, and zero-data-retention is
  available for eligible enterprise endpoints. **This line is a
  third-party-sourced summary, not a verified legal representation** —
  before this feature goes live, or before any of this becomes
  customer-facing language, confirm OpenAI's current data-usage terms
  directly against OpenAI's own current policy page.

## Activation gating (for context, not part of this document's own scope)

Even once the adapter/brief/router described here exist in code, live
traffic only ever reaches OpenAI when:

1. The shop-scoped feature flag described in
   `docs/MARKETING_OPENAI_PREMIUM_CREATIVE_FEATURE_FLAG.md` is on for
   that specific shop, AND
2. A real call site (not yet built) actually selects the OpenAI provider
   for that request via `marketing-engine-router.js`'s
   `routeMarketingEngine()`.

Neither of those exists in the live path as of Batch 1.
