# Florisyn — Standing Engineering Rules

Florisyn is a real, live florist operating system with paying/onboarded
shops (currently including Lilies in Bloom, Ashley's own shop). It is not
a prototype and not a demo. Every rule below is standing — it applies
every session, not just when restated.

No existing CLAUDE.md, `.claude/rules`, `.claude/skills`, hooks, or
settings existed before this file was created (verified by inspection at
creation time). Nothing here overrides or conflicts with prior project
instructions — there were none to reconcile. `.cursor/settings.json`
belongs to a different editor and is out of scope.

## 1. What "done" means

- Preserve existing features, data, and design unless the requested
  defect actually requires changing them. Prefer the smallest fix that
  addresses the real root cause over a rewrite.
- Trace every defect end to end: UI → handler → database → provider →
  persisted result. Fix the root cause, not the symptom a screenshot
  happened to show.
- Inspect the real, already-shipped path before adding new parallel
  architecture. Reuse existing modules, storage, database tables,
  renderers, and approval flows — don't build a second one beside them.
- A passing unit test proves only what it asserts. It does NOT by itself
  prove visual quality, provider availability, persistence across reload,
  or real usability. Say what was actually verified, not what a green
  test suite makes it tempting to assume.
- Never present a mock, a stub, a fallback color, or a placeholder pixel
  as real visual proof. Say plainly when something is simulated.
- Never call a client-side preview "durable" unless a real asset was
  actually persisted (uploaded, saved, reloadable) — a canvas rendering
  successfully in a browser is not itself durable.
- Never describe provider functionality as live without an actual
  provider call having been made and observed.
- Never claim a deploy did or didn't happen without checking the real
  deploy state (commit pushed, branch, Netlify build status) — don't
  infer it from local test results alone.
- Full standard: see the `florisyn-complete` skill for the required
  sequence, and the reporting standard below for how to write it up.

## 2. Multi-tenant safety

- Customer-facing content (flyers, captions, copy) belongs to the
  authenticated florist's own shop — never Florisyn's identity, unless a
  user explicitly asks for Florisyn's own marketing.
- Never hard-code a specific shop's name, phone number, color, or any
  other identity fact into multi-tenant behavior — not "Lilies in
  Bloom," not any other real shop. Every shop must get its own real,
  correct data. Test fixtures may use realistic example data; production
  code paths may not assume a specific shop.
- Every shop's data must come from that shop's own real, authenticated
  records — never another shop's, never invented.

## 3. Branches and deployment

- `beta/august10-stabilization` auto-deploys to www.florisyn.com on push.
  Treat every push to it as a production deploy.
- Never push to `beta/august10-stabilization`, merge into it, or deploy
  to www.florisyn.com without Ashley's own explicit, in-conversation
  approval for that specific push — a prior approval does not carry
  forward to a new change.
- A `PreToolUse` hook blocks `git push` to `beta/august10-stabilization`
  by default (see `.claude/settings.json`). That hook is real enforcement
  against an accidental or routine push; it is not a security boundary —
  an agent with write access to `.claude/` could disable it. It exists to
  force a visible, deliberate step before that branch ever moves, not to
  replace Ashley's actual approval.

### One-use production approval

When Ashley explicitly approves a specific push to `beta/august10-
stabilization` in conversation, do this — never edit `.claude/settings.json`
or disable the hook:
1. Write `.claude/hooks/.beta-push-approval.json` with exactly
   `{"branch": "beta/august10-stabilization", "sha": "<the real, full
   HEAD SHA about to be pushed>", "expires_at": "<UTC ISO-8601, ~10-15
   minutes from now>"}`.
2. Run the push immediately.
3. The hook consumes (deletes) the ticket the instant it's read,
   whether or not it validates — so it can never authorize a second
   push, a different commit, or itself after it expires. Every attempt
   (approved or rejected) is appended to `.claude/hooks/.beta-push-
   approval.log` (branch/sha/outcome/timestamp only, never a secret).
4. If the push fails for any reason (network, remote rejection), the
   ticket is already gone — write a fresh one for the same or a new SHA
   only after Ashley approves again.
Both files are git-ignored — never committed, never part of the
reviewable config itself.
- Disposable preview/test branches (e.g. `test/*`) are the default place
  to work and push freely once tests pass, unless told otherwise.

## 4. Don't make Ashley do a computer's job

- If a tool available to you can do something (read a file, run a test,
  check git state, query the database via an available MCP tool), do it
  yourself rather than asking Ashley to.
- When a real access boundary genuinely requires a human (a live
  browser/production credential you don't have, an account-level
  decision, an approval), ask for exactly one short, concrete action —
  not a vague "can you check this."
- State limitations plainly and immediately, in the same message as the
  rest of the report — never bury a real gap inside an otherwise
  positive-sounding summary. See the reporting standard below.

## 5. Reporting standard

Every completion report on a material change must separate, explicitly:
Implemented · Verified locally · Verified through the real handler ·
Verified in a real browser · Verified with a live provider · Deployed to
test branch · Deployed to production · Still unverified · Requires
Ashley. Never collapse these into "all fixed and tested." An empty
category is still worth stating ("Verified with a live provider: no —
this session has no live credentials").

## 6. Independent verification

For a material change (not a one-line fix), don't let the same pass that
wrote the implementation be the only check on it. Before reporting it
done, either run `/code-review` or spawn a fresh subagent (Explore or
general-purpose) with no memory of writing the code, and have it
challenge: is the claimed root cause actually proven; was the real path
(not just a unit test) exercised; are the tests behaviorally faithful,
not just passing; does tenant isolation still hold; does the UI's
wording match real backend state; does the visual result match Ashley's
reference; was any known gap minimized or left out of the report.

## 7. Context / long sessions

If a session gets long or confused, checkpoint it: summarize current
branch + HEAD, working-tree state, exact decisions Ashley has already
made, exact unresolved defects, tests already run, real-world checks
still needed, deployment state, and anything explicitly prohibited (e.g.
"do not push to beta") — then continue from that summary rather than
re-deriving or re-guessing it. Don't carry an assumption forward
unexamined just because it was stated earlier in a long conversation.

## Where the rest of this lives

- Marketing Studio / flyer / AI-content specific rules:
  `.claude/rules/marketing-studio.md` (loads automatically when those
  files are open).
- The required completion sequence: skill `florisyn-complete`.
- The required visual-review sequence: skill `florisyn-visual-proof`.
- Hooks (branch protection, uncommitted-change warnings, deploy-risk
  banner, post-edit syntax check): `.claude/settings.json` +
  `.claude/hooks/`.
