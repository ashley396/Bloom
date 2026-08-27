---
paths:
  - "netlify/functions/marketing-studio*.js"
  - "netlify/functions/marketing-campaigns.js"
  - "netlify/functions/marketing-promotions.js"
  - "netlify/functions/marketing-scheduled-publisher.js"
  - "netlify/functions/marketing-social-oauth-callback.js"
  - "netlify/functions/_shared/marketing-*.js"
  - "netlify/functions/_shared/ai-image-engine.js"
  - "netlify/functions/_shared/ai-creative-engine.js"
  - "netlify/functions/_shared/flyer-templates.js"
  - "netlify/functions/_shared/flyer-render.js"
  - "public/marketing-studio*.js"
  - "public/marketing-campaigns*.js"
  - "public/flyer-renderer.js"
  - "public/florist-marketing-tools/**"
  - "tests/marketing-studio*.js"
  - "tests/flyer-renderer.test.js"
  - "tests/e2e/marketing-studio*.spec.js"
---

# Marketing Studio, flyers, images, publishing, AI content

Applies to Lily's marketing-content generation, revision, flyer
rendering, image generation, and publishing surfaces. This is additive to
the root `CLAUDE.md`, not a replacement for it.

## Grounding and facts

- Every generation call must ground itself in the real, authenticated
  shop's own data (name, phone, brand color, real inventory when
  relevant) — never a hardcoded example shop, never invented inventory,
  hours, prices, or policies.
- When a request states a material fact explicitly (a time, a phone
  number, a date, a price), that exact fact must survive into the final
  wording byte-for-byte. A paraphrase that drops or reworks a stated fact
  is a defect even if nothing was literally invented.
- Never invent a reason, urgency, apology, gratitude, farewell, or future
  plan the florist didn't supply. Never read a temporary closure/change
  as permanent.
- Operational notices (closing early, opening late, changed hours, order
  deadlines, and similar) use deterministic, no-AI-call wording whenever
  the required facts can be extracted — see
  `buildDeterministicNoticeContent` in
  `netlify/functions/_shared/marketing-content-revision.js`. Don't
  reintroduce an AI paraphrase step ahead of that gate for these cases.

## Branding

- The shop's own real name is mandatory and must be visibly identifiable
  on every customer-facing flyer, even if the image is later downloaded
  or shared outside its original post.
- Never brand customer-facing content as "Florisyn" unless the user
  explicitly asks for Florisyn's own marketing, not the shop's.

## Visual design

- Default flyer imagery is happy, colorful, premium, realistic floral
  photography with natural light — never dark, moody, or gloomy by
  default.
- No large white/light content box covering the photo.
- No full-image or full-panel color wash/overlay of any kind, regardless
  of hue — a brand color must never become a large translucent layer
  painted over the flowers. Legibility comes from real per-region
  contrast against the actual rendered pixels (see
  `pickRegionTextStyle` in `public/flyer-renderer.js`), not a filled
  panel.
- Never ask an image-generation model to render literal words, numbers,
  or signage — a diffusion model can't spell. All real wording is drawn
  by Florisyn's own deterministic renderer, not the AI image model.
- Body/CTA text must stay comfortably readable at normal mobile/social
  viewing size, not just desktop.

## Revision, regeneration, undo

- "Regenerate image" / a background-only revision changes the visual
  asset only — the exact prior wording (headline/body/CTA/caption) is
  preserved byte-for-byte.
- Undo restores the exact prior durable asset AND its exact prior
  wording together, not just one of the two.
- Approve/publish stays blocked until a real, finalized, durably
  persisted asset exists (render_status actually "rendered," a real
  storage URL) — a client-side canvas or a data: URL is never sufficient
  on its own.

## Style memory

- Generated copy, an image prompt, or a model's own self-reported "traits
  used" is never, by itself, approved style memory. A style-memory
  candidate must trace back to text the florist actually supplied or to
  previously-approved content, carry real provenance, and go through the
  shop's existing confidence/approval process — never an operational
  fact or a one-off campaign detail.
