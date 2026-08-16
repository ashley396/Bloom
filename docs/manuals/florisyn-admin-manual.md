# Florisyn — Platform Owner (Admin) Manual

*The Command Center is a separate console from the florist app — reached at florisyn.com/admin — for the person running the Florisyn platform itself, not an individual flower shop. This manual covers all 17 sections in the Command Center sidebar.*

---

## Getting started

Sign in at **florisyn.com/admin**. If no owner account exists yet, you'll be walked through a one-time setup using your platform bootstrap secret — after that first owner is created, that setup path locks permanently and can't be used again by anyone, including you. Depending on your environment, sign-in may require a one-time authenticator code (MFA) in addition to your password; production always requires this, with no exceptions.

---

## Executive dashboard

Your first screen: shop count, active subscriptions, orders, and marketplace listings platform-wide, plus a live feed of subscriber activity — new trials, new paid subscriptions, cancellations, and renewals as they happen. **Mark all read** clears the feed once you've seen it.

## Beta toolkit

A manual QA checklist for tracking readiness before inviting new florists — saved locally in your browser, not shared across devices. Use it alongside the automated test suite (`node --test tests/*.test.js`) referenced at the bottom of the panel; the checklist is for the things only a human can judge, not a replacement for the real tests.

## Users

Platform-wide user management across every role — Owner, Manager, Staff, and Platform Admins. Suspend or reactivate an account, or kick off a password-reset workflow for someone who's locked out.

## Marketplace

Two things live here: **Listings** (review, feature, or remove wholesale marketplace listings) and **Florist verifications** (review a florist's submitted business verification before they're allowed to buy wholesale — approve, reject, or request more information).

## Support

Your ticket inbox — every `ticket`, `feature_request`, `bug_report`, and piece of `feedback` florists have sent in. **Assign**, **Resolve**, or **Close** a ticket as you work it.

**Request Claude Code fix** is the newest button here: click it on a ticket and Florisyn packages the ticket plus that shop's real recent errors (if any) into a fix request. If you've connected a receiving endpoint (`CLAUDE_CODE_FIX_WEBHOOK_URL` in your environment settings), it's sent there for an AI agent to investigate — always under the strict rules in the AI Agent Autonomy Policy: an agent may prepare a fix, but nothing ships without a human reviewing and approving it first. If no endpoint is connected, the request is simply recorded on the ticket so the history is there when you do connect one.

## Subscriptions

Every shop's Florisyn subscription in one list — plan, status, and whether it's set to cancel at the end of the current period. This is about florists' subscriptions *to Florisyn*, separate from the Payment Platform view below.

## Announcements

Write and broadcast a message to florists — a maintenance notice, a holiday-hours heads-up, a new feature release, or a pop-up announcement. Choose your audience: everyone, florists only, wholesalers only, or a specific selected list.

## Feature flags

The platform-wide on/off switches for features still being rolled out. Toggle a flag off as an emergency kill switch if something needs to come down fast, or on when a feature is ready for florists to see. Changing a flag default is a real, felt-immediately change for every florist — treat it with the same care as a Tier 2 change in the AI Agent Autonomy Policy, even though you (a human) are the one making it here, not an agent.

## Analytics

Platform-wide performance trends — revenue and growth series across all shops, not any one florist's numbers.

## Payment platform

Two separate ledgers, kept deliberately apart so they're never confused: **(A) Florisyn's own SaaS revenue** — active subscribers, monthly subscription revenue, failed Florisyn subscription payments — and **(B) florist customer payments** — the money flowing through individual shops' Stripe checkouts, which Florisyn never touches directly.

## System health

A live read on the platform's technical health: database, functions, storage, and API status, plus (as of this manual's writing) a real **Client errors — last 7 days** panel — every uncaught error, failed request, or permission denial florists have actually hit, grouped by type and by page, with a shop count so you can see a real pattern before a florist ever has to file a ticket about it.

## Florist accounts

The full list of shops on the platform. Select one to open it in the Remote Editor below.

## Remote editor

Edit a specific florist's account remotely — branding, navigation, feature access, and subscription — the same fields that shop's own owner could change from their Settings page, available to you for support and onboarding help.

## Audit log

A permanent, searchable record of every admin action taken in the Command Center: who did what, to which shop or user, and when. This is the platform-wide log; **Shop history** (below) is the same idea scoped to one shop at a time.

## Floral Library (import & quality)

Tools for importing and quality-checking the arrangement designs that populate every florist's Floral Library page.

## UI Design Mode

A visual studio for adjusting the platform's look and feel directly, without editing CSS by hand.

## Shop history

Per-shop change history — everything that's changed on one specific florist's account over time, reached from that shop's record.

---

## A note on what this console can do

Everything in the Command Center acts across every shop on the platform at once — that's real power, and it's why platform admin access requires MFA and every action here is written to the Audit Log. When in doubt about whether an action is safe to take, it usually is exactly as safe as it looks: reversible, scoped actions (assigning a ticket, editing one shop) are fine to do freely; anything that changes what's live for every florist at once (a feature flag, a platform-wide announcement) deserves the same pause you'd want an AI agent to take before doing the same thing.
