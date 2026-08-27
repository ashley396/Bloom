---
name: florisyn-visual-proof
description: Use before telling Ashley a visual result (a flyer, a layout, a color, any rendered UI) looks right or is ready for review — the required checklist for genuinely inspecting a rendered image rather than assuming a passing test means it looks correct.
---

# florisyn-visual-proof

A rendered image or layout is never "verified" because a test passed. It
is verified because you actually looked at it. Use this checklist
whenever appearance is part of what's being judged.

## 1. Get a real, large image

Take (or generate) a screenshot large enough to actually read — not a
thumbnail-sized card crop. Capture both a desktop viewport and a mobile
viewport when the result will be seen on both (Marketing Studio flyers
are viewed on mobile far more than desktop).

## 2. Use real output when provider quality is in question

If the thing being judged is provider output (an AI-generated
background, a generated caption's tone), use a REAL provider call, not a
mock, a stub, a hardcoded fallback color, or a placeholder. A mock/Tier-B
fallback is fine for testing plumbing (the code path, the persistence,
the finalize flow) but proves nothing about actual visual/creative
quality — say so explicitly if a real provider call wasn't available in
this session.

## 3. Record what kind of image it actually is

State plainly, every time: is this image real (a live provider call that
ran in this session), mocked (a stubbed response standing in for the
provider), deterministic (Florisyn's own renderer, no AI image call), or
provider-generated but not personally viewed by you. Don't let a reader
assume "real photo" when it was actually a 1x1 test PNG or a Tier-B flat
fill.

## 4. Actually read every visible word

Read the headline, body, CTA, contact line, and shop name as rendered —
not the source data object. Confirm spelling, that the real shop name
appears, that no fact was dropped or reworded, and that nothing garbled
or nonsensical was drawn (a diffusion model asked to render text will
produce garbage — catch it here if it slipped through).

## 5. Check the actual visual structure

Look for, specifically: a large white/light box that shouldn't be there;
a full-image or full-panel color wash/overlay; a heavy frame or border;
flowers mostly hidden behind text or a panel; text too small to read at
normal mobile size; low contrast between text and what's behind it;
clipped or overflowing text; a gloomy/dull/plain image where a happy,
colorful one was expected.

## 6. Compare against Ashley's approved reference

If Ashley has already approved a direction (a layout, a color approach,
an overall feel) earlier in the conversation or session, compare the new
result against that specific approval — not a fresh guess at what she
might want. Call out explicitly whether this result keeps or changes
anything she already signed off on.

## 7. Say what you actually did

In the report, state which of steps 1–6 you actually performed and on
what (a screenshot you took, a live browser session, a generated file) —
never "looks good" without saying how you know.
