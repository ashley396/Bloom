---
name: florisyn-complete
description: Use before reporting any Florisyn defect fix or feature as complete — walks through the required verification sequence (real path, real browser, real persistence, honest reporting) so a green test suite is never mistaken for a finished, working feature.
---

# florisyn-complete

**A passing test proves only what the test asserted.** It does not by
itself prove visual quality, provider availability, persistence across
reload, deployment, or real usability — those must be checked directly,
or reported as not checked. This skill is the sequence that keeps a
Florisyn task from being called "done" on the strength of green unit
tests alone.

Run through every step below before writing a completion report for a
material change. For a genuinely trivial one-line fix, the sequence can
compress, but never skip straight to "done" without at least confirming
which steps were actually necessary.

## A. Restate the exact acceptance criteria

Write down, in your own words, exactly what the requester asked for and
what "fixed" or "done" concretely means for this task. If it's
ambiguous, resolve the ambiguity before writing code — don't guess and
find out at the end.

## B. Inspect the real implementation path

Find the actual production code path this request touches — not where
you'd expect it to be, where it actually is. Read the real handler, the
real client code, the real data flow. Don't assume two features that
look similar (e.g. two things both labeled "Lily") share a pipeline —
verify it.

## C. Identify existing capabilities before adding new ones

Search for existing modules, tables, renderers, or flows that already do
some or all of what's needed. Reuse them. Building a second, parallel
system beside a working one is a defect, not a feature, unless the task
explicitly asked for a redesign.

## D. Implement the smallest complete root-cause fix

Fix the actual cause you found in B, not the symptom a screenshot or bug
report happened to show. Keep the change scoped to what the defect
requires — don't redesign unrelated behavior along the way.

## E. Run focused tests

Run (or write, if none exist) the tests that directly exercise the
changed code. They must fail without your fix and pass with it — a test
that already passed before the change proves nothing about the fix.

## F. Run the relevant full suite

Run the broader test suite (`npm test`, the relevant Playwright specs,
etc.) to catch regressions the focused tests wouldn't. Report the exact
pass/fail counts, not "tests pass."

## G. Test the real handler path

For a backend change, dispatch through the real handler (real-dispatch
test, or an actual local invocation) — not just the pure helper function
in isolation. A unit-tested pure function can still be wired in wrong.

## H. Test the real browser workflow

For anything the florist interacts with, drive it through a real (or
Playwright-automated real) browser session — the actual click-through a
person would do, not just an API call. Prefer exercising the real,
unstubbed client script over a hand-typed fixture when the point is to
prove what the client actually does.

## I. Inspect the actual visual result when appearance matters

If the task involves anything a person will look at (a flyer, a layout,
a color, a screenshot), follow the `florisyn-visual-proof` skill before
calling it done. Do not accept a mock, a stub, or a fallback/placeholder
color as evidence of real visual quality.

## J. Verify persistence after reload

If the result is supposed to survive a page reload or a new session
(a saved draft, a finalized asset), confirm it actually does — reload
and re-check, or trace the exact write that makes it durable. A
successful client-side render is not itself durable.

## K. Verify revision, regeneration, and undo when relevant

If the feature has a revise/regenerate/undo path, exercise it directly.
Confirm wording and assets that shouldn't change don't, and that undo
restores the exact prior state (asset AND wording together).

## L. Verify branch, commit, and deployment target

Confirm which branch you're actually on, what HEAD is, and where you
pushed (or didn't). Never push to `beta/august10-stabilization` (which
auto-deploys to www.florisyn.com) without a specific, in-conversation
approval for that exact push. State the real commit SHA in the report.

## M. Report what remains unverified

Explicitly list anything you could not check yourself — most often "no
live provider credentials in this sandbox" or "no access to the real
production database/deploy." Say it plainly, not as a footnote.

## N. Stop for approval when required

If the task called for a human's visual/product approval before merging
or deploying further (very common for Florisyn's visual work), stop and
wait — do not merge, push to a protected branch, or deploy further on
your own judgment.

## Independent verification

For a material change, don't let the same pass that implemented it be
the only thing that checked it — see "Independent verification" in the
root `CLAUDE.md`.

## Reporting

Write the completion report using the categories in the root
`CLAUDE.md`'s reporting standard (Implemented / Verified locally /
Verified through real handler / Verified in real browser / Verified with
live provider / Deployed to test branch / Deployed to production / Still
unverified / Requires Ashley). Never compress this into "all fixed and
tested."
