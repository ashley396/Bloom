# Florisyn AI Agent Autonomy Policy

**Last updated:** 2026-08-16
**Status:** Permanent — governs every AI coding agent (Claude Code by name, and any future equivalent) touching this codebase, in every context: a developer's terminal, this repo's CI, and any future support-ticket or admin-triggered fix flow.
**Audience:** Owners, engineers, and the agents themselves.

---

## Why this document exists

Florisyn's Command Center has a real support-ticket inbox (`platform_support_items`), and the intent going forward is that some of those tickets should be fixable fast — ideally the moment they come in, not after a developer picks them up hours or days later. That's a good goal. It is also exactly the kind of capability that goes wrong quietly if the rules aren't explicit: an agent that can read a ticket and touch code needs to know, in advance and without asking each time, exactly where "fix it on the spot" ends and "stop and get a human" begins.

This document is that line. It doesn't describe a system that exists yet — as of this writing, there is no live trigger connecting a support ticket, or Lily's florist-facing chat, to an AI coding agent. **Whoever builds that trigger next must wire it to this policy, not invent new rules at build time.** Until then, this document governs any agent (Claude Code, specifically) working in this repo under any circumstance, including a developer just asking for a fix in conversation.

This is a specific, operational extension of `FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` §11 ("Development rules for all agents") and does not relax anything already established there, in `FLORISYN_GOLD_STANDARD.md`, or in the Deployment Gate at the bottom of `FLORISYN_MASTER_BUILD_CHECKLIST.md`. Where this document and any of those disagree, the stricter rule wins.

---

## The one distinction that matters most

**Diagnosing and preparing a fix is not the same action as shipping it.**

An agent may *always* read code, reproduce a bug, write a fix, write or run tests, and prepare a diff — that's investigation, and investigation is how "fix it on the spot" becomes possible at all. What an agent may never do on its own is decide that diff is *done* — merged, deployed, or otherwise live for real florists — without a human looking at it first. "On the spot" means the fix is ready the moment a human looks, not that it shipped before one did.

Every tier below is a statement about how far an agent may go *before a human has to say yes* — never about whether a human ever gets asked.

---

## Tier 1 — Fix and propose immediately, ship only after a human approves the diff

These are narrow, reversible, low-blast-radius changes where preparing a fix immediately (without waiting for a scoping conversation) is genuinely useful, because the risk of being wrong is small and easy to see in a diff:

- UI bugs with no data or money implication: a broken CSS selector, a dead/inert button (a `data-page`/`data-route` trigger the router won't actually respond to — see the dashboard calendar and Command Center wiring fixes earlier in this project), a layout break, a typo, a missing empty state.
- Defensive coding that narrows failure modes without changing behavior on the happy path: null-checks, try/catch around a call that could throw, a graceful-degrade message where there was previously a hard crash.
- Test coverage: new tests, or replacing a weak regex-against-source-text test with one that actually exercises the code (as long as the test doesn't change what's tested — only how).
- Observability/logging fixes that make an existing problem visible without changing what the product does — exactly the class of fix behind `recent_errors` going from a hardcoded empty array to real data in this pass: nothing about florist-facing behavior changed, only what the platform owner can see.
- Documentation and comments.

**Every Tier 1 fix still follows this process, no exceptions:**

1. Work on a branch. Never commit directly to a production or staging branch.
2. Run the relevant tests before proposing the fix, not after. A fix that isn't verified isn't "on the spot," it's a guess.
3. The diff must be traceable to what triggered it — which ticket, which bug report, which conversation. No unexplained changes riding along.
4. A human approves the diff (merge) before it reaches any branch that deploys. The agent proposes; it does not merge its own work.
5. Never bundle a Tier 1 fix with anything from Tier 2 in the same diff — mixing them forces a human to approve the risky part just to get the safe part, which defeats the purpose of having tiers at all.

---

## Tier 2 — Requires explicit human approval *before the agent starts*, not just before shipping

For these, even preparing a fix without asking first is the wrong move — the risk of a subtly wrong fix is high enough that a human should confirm the intended approach before code gets written, not just review it after:

- Anything touching money: Stripe Checkout, webhooks, payment posting, refunds, split payments, subscriptions, marketplace fees, wholesale settlement.
- Anything touching auth or security: RLS policies, session/token handling, MFA, staff PIN logic, rate limiting, the admin bootstrap lock.
- Database migrations or schema changes of any kind.
- Feature flag defaults — flipping something from off to on (or the reverse) changes what's live for every florist at once; see the `WEBSITE_STUDIO_V2` flag fix earlier in this project, which was exactly this kind of change and was confirmed with the owner before being made.
- Legal or compliance copy — already covered by the Attorney Review Gate in `FLORISYN_MASTER_BUILD_CHECKLIST.md`; this policy does not create a new exception to it.
- Anything that changes behavior for more than one shop/tenant at once, or touches shared platform infrastructure rather than a single feature.
- Full builds of a gated, in-progress system (Website Studio phases, Holiday Command Center, etc.) — see the Website Studio Blueprint's own "no surprise full builds" rule.

---

## Never — regardless of who asks, unless a human says so in that specific moment

These aren't things an agent is pre-authorized to do under any general instruction, including this document. A human has to say it, specifically, at the time:

- Deploying to production, or triggering any deploy pipeline.
- Applying a migration to a live database.
- Merging its own pull request.
- Reading, rotating, or exfiltrating a secret or credential.
- Taking any action that bypasses the Attorney Review Gate on legal copy.
- Auto-switching Stripe (or any processor) between test and live mode.

If a ticket seems to require one of these, the correct move is to prepare everything that *can* be prepared (diagnosis, diff, test results) and stop there, clearly stating what's ready and what needs a human to actually pull the trigger on.

---

## When the tier is ambiguous

Default to the stricter tier. An agent that isn't sure whether a fix is Tier 1 or Tier 2 should treat it as Tier 2 — ask before starting — rather than guess toward the more permissive reading because it seems faster. Being wrong about "this was safe to just fix" is exactly the failure mode this document exists to prevent; being wrong about "I should have asked" costs a few minutes.

---

## Audit trail

Every Tier 1 fix an agent proposes should be traceable to its trigger (ticket ID, bug report, conversation) in the commit message or PR description, the same way every commit in this repo already carries a `Claude-Session` link. If a future support-ticket-to-agent trigger is built, each fix it produces should additionally be linked back to the `platform_support_items` row that caused it, so "what did the AI change and why" is always answerable by reading history, not by asking someone to remember.

---

*This document sits alongside — and does not supersede — `FLORISYN_GOLD_STANDARD.md`, `FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` §11, and the Deployment Gate in `FLORISYN_MASTER_BUILD_CHECKLIST.md`. Update it when the actual support-ticket-to-agent trigger gets built — that build should reference this policy explicitly, not restate it.*
