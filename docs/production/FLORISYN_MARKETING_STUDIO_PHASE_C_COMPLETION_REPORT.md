# Florisyn Marketing Studio — Phase C Completion Report (Priorities 1–16)

**Report date:** 2026-08-24
**Author:** Claude (autonomous engineering pass, per Ashley's explicit "CONTINUE. Do not stop for review yet" instruction)
**Baseline document:** `docs/production/FLORISYN_MARKETING_STUDIO_LAUNCH_READINESS_AUDIT.md` (the original launch-readiness audit; this report tracks what changed against that baseline, not a rewrite of it)

**Governing rule for this entire pass, verbatim from the instruction:** *"Do not confuse 'adapter exists' with 'feature works.' Facebook, Instagram, and TikTok publishing are NOT complete until the real publishing worker can safely use the adapters with actual asset resolution, page/account identifiers, token handling, failure states, retries, and truthful connection status."* Every claim below was checked against that bar, not against "a function exists."

---

## 0. Safety confirmation (verified fresh at report time)

| Item | Status |
|---|---|
| Repository | `ashley396/Bloom` |
| Working branch | `feature/florisyn-marketing-studio-clone-providers` |
| HEAD commit (this report) | `4404f67` at the point the literal re-verification below was run; report originally drafted at `ca1886d`, updated in place through `8cd31ce`, `e143cfb`, `4404f67`, and this final reconciliation pass |
| Merge-base with `beta/august10-stabilization` | `2f7fd182372d23d703e31d683b45f14f96768639` — **equal to `beta/august10-stabilization`'s own current tip**, i.e. this branch is a clean, unforked descendant of the intended baseline |
| `origin/main` | `e42c4adae7f75341a3b408bc01d8fbcbff8b9803` — **untouched this session**, never checked out, never merged into, never merged from |
| Bloom Technologies (legacy platform-admin/marketplace core) | **Not touched** this session |
| Intended PR | #177, base `beta/august10-stabilization` — **not merged**, per standing instruction |
| Production deploy / Netlify | **None performed** |
| Production DB migration | **None applied** — the one schema-adjacent change this pass needed (Priority 10) was implemented by reusing existing columns, no migration required |
| Purchases / external accounts / provider connections | **None made** |
| Secrets exposure | **None** — every credential referenced below (`FACEBOOK_APP_ID`, `TIKTOK_CLIENT_KEY`, etc.) is read from `process.env`, never logged, never hardcoded |
| Working tree | Clean, no uncommitted changes |

Nothing in this pass touched `main` or Bloom Technologies. If any of the above had come back pointed at `main`, this report would stop here and flag it — it does not.

---

## 1. What Priorities 1–5 already established (accepted checkpoint, not re-litigated)

Per Ashley's own framing, Priorities 1–5 are the accepted checkpoint. Summarized only for continuity:

- Priority 1: Lily compound-request orchestration (`marketing-compound-orchestrator.js`) — plans and executes a multi-step request (image/video/schedule/platforms) as one real job.
- Priority 2: persisted per-shop **monthly budget cap** (`marketing_studio_budget_controls` migration + `marketing-budget-guard.js`), enforced fail-closed on every generation path.
- Priority 3: real OAuth architecture for Facebook/Instagram/TikTok (authorize URLs, state validation, encrypted token storage).
- Priority 4/5: real per-platform publishing **adapters** (Meta Graph API, TikTok Content Posting API) with real HTTP calls, status polling, and typed failure codes.
- **Priority 5 completion (this pass's first commit, `acab06e`):** the critical correction. The adapters from Priority 4/5 existed but the real publishing worker (`marketing-publishing-worker.js`) and analytics ingestion (`marketing-analytics-ingestion.js`) were not actually calling them with real inputs. This commit added: real public-URL asset resolution (`ai_generated_assets` → `website_media` → signed/public URL), real Page/IG-Business-Account identity resolution at OAuth-callback time (`resolveFacebookPages`, `resolveInstagramBusinessAccount` — a real bug fix: Meta requires a **Page** token, not the user's own token, and nothing previously resolved that distinction), real decrypted-token use, a new `token_invalid` failure class that flips the connection to `needs_reauth`, and a new `ambiguous` failure class (a timed-out status poll) that **never auto-retries**, because a blind retry there risks a real duplicate post.

Test suite at that checkpoint: all passing, verified before proceeding.

---

## 2. This pass's work: Priorities 6–16

### Priority 6 — Social setup UX with honest connection states
**Status: BUILT AND VERIFIED (folded into the existing Connections panel, no separate commit needed).** The Connections panel built earlier already renders real per-platform status (`connected` / `error` / `needs_reauth` / `not_connected`), confirmed still accurate after this pass's `token_invalid`→`needs_reauth` wiring (Priority 5 completion) — a real 401 from a provider now flows through to the exact badge the UI already shows, not a new UI need. Re-verified via `tests/e2e/marketing-studio-connections.spec.js` (4/4 passing, including "renders real per-platform status — never a fabricated 'connected' state").

### Priority 7 — Video-render provider readiness/contracts
**Status: BUILT AND READY FOR CREDENTIALS/APPROVAL.** Commit `14aa5d4`. New `plan_video_render` admin action validates a `video_concept` asset, calls `planVideoRender()` (`marketing-video-render-engine.js`), and persists the plan into the asset's `content` JSON — no new migration. The plan is honestly labeled "NOT LIVE — PROVIDER CONNECTION REQUIRED" because there is still no connected video-rendering provider. 7 new tests (`tests/marketing-studio-plan-video-render-action.test.js`), all passing.

### Priority 8 — Digital Twin integration inside compound requests
**Status: BUILT AND READY FOR CREDENTIALS/APPROVAL.** Commit `884510f`. Before this: a compound request's `ctx.digitalTwin` was set once and never read again anywhere (proved by `grep -n "digitalTwin\|generateVideo\b"` across the orchestrator — a real dead end, not an assumption). Added a real `compound.requestDigitalTwinRender` step: builds a script from the video concept's own `script`/`concept` fields (deliberately not reusing `requestDigitalTwinGeneration()` as-is, which reads `founder_concept`-shaped fields and would have silently rendered an empty script), selects a real clone provider, and — if none is connected — returns an honest "CONNECTION REQUIRED" block rather than a fake success. 2 new end-to-end orchestrator tests.

### Priority 9 — Compound orchestration hardening (idempotency)
**Status: BUILT AND VERIFIED.** Commit `8dd412c`. `compound_request` is a synchronous, real-money-spending HTTP action with no queue/claim layer, so a double-submit (double-click, retry-after-timeout) could double-spend and double-post. Added a 60-second time-windowed dedup lookup keyed on `(shop_id, job_type, request_text)` — no schema migration needed, reuses existing columns. Deliberately excludes `failed`-status jobs so a genuine retry after a real failure is never blocked. 3 new orchestrator tests + 1 new handler-level test; 6 pre-existing call sites patched for the new query, all still passing (26→29 tests in the orchestrator suite).

### Priority 10 — Scheduling and DST audit
**Status: BUILT AND VERIFIED.** Commit `ca1886d`.
- **DST handling:** audited `shop-time.js` — already correct (reads the real UTC offset at the target instant, not an assumed fixed offset); existing tests cover both the real 2026 US spring-forward and fall-back transitions. No change needed.
- **Duplicate-queue prevention:** audited `enqueue_publish` — already correct (`idempotency_key` + `upsert(..., { onConflict: "idempotency_key", ignoreDuplicates: true })`). No change needed.
- **The real, proven gap:** `schedule_content_item` has no status guard, so calling it *after* `enqueue_publish` already created a `marketing_publishing_jobs` row (a legal, real call order) left that job's `next_attempt_at` pinned to the *old* time — the real publish attempt would still fire when the shop had just rescheduled away from it. Fixed in `scheduleContentItemVariants()`: any job still `status='queued'` for the rescheduled variant ids is resynced to the new time; a `running`/terminal job is never touched. Verified the new regression test genuinely fails without the fix (reverted the fix, confirmed the assertion failed, restored it). Full suite: 2632/2632 passing (was 2631).
- Also confirmed (audit only, no gap found): `marketing-scheduled-publisher.js`'s atomic claim (`status='queued'` → `running`, re-checked) makes it safe against a concurrent manual trigger or an overlapping scheduled tick — no re-entrancy gap.

### Priority 11 — Disclosure/AI-safety re-audit
**Status: AUDITED, NO REGRESSION FOUND.** Re-traced `enforcePrePublishDisclosureGate()` through the real publishing worker after this pass's asset-resolution/token additions (Priority 5 completion) — confirmed the gate still runs *before* any provider is touched, unaffected by the new code inserted above it (`marketing-publishing-worker.js:161` gates at exactly the same point it always did). Re-confirmed `computeDisclosureFields()` is applied at every real content-attachment site, including the compound orchestrator's `compound.createContentItem` step. Re-confirmed the human-facing `set_content_disclosure` action exists to close the loop (apply real disclosure text before the gate will allow publish). No code changes were needed — this priority's job was to prove nothing had quietly regressed, and nothing had.

### Priority 12 — Analytics correctness audit
**Status: AUDITED, ARCHITECTURE CONFIRMED SOUND; one low-severity item documented, not fixed.** `marketing_performance_metrics` is correctly append-only (every ingestion writes a new timestamped snapshot, never overwrites); `reconcileLatestMetricSnapshots()` correctly takes the latest `fetched_at` per `(platform_variant_id, metric_name)` rather than averaging across snapshots, which would silently skew numbers by how often ingestion happened to run. Anti-fabrication guardrails re-confirmed: `METRIC_NAMES` is a closed vocabulary (a provider field outside it is silently dropped, never invented), `source` is hardcoded to `'platform_api'`, and a failed fetch produces **zero** rows, never a zeroed-out one. **One documented, unfixed, low-severity finding:** there is no scheduled/cron trigger for analytics ingestion today (only the admin-triggered `run_analytics_ingestion` action exists), so the theoretical race — two near-simultaneous ingestion runs both passing the 1-hour freshness check and both calling the real provider — has no realistic trigger today. If a scheduled analytics trigger is added later (mirroring `marketing-scheduled-publisher.js`), this should be revisited with either an advisory lock or a stricter freshness re-check immediately before the provider call. Not fixed now because it adds complexity with no current exploitable path and no scheduled trigger exists to make it likely.

### Priority 13 — Pre-existing Playwright failures
**Status: DONE — full sweep completed, all failures triaged, genuine ones fixed at the root.** All 8 Marketing-Studio-specific e2e spec files (`marketing-calendar-analytics`, `marketing-campaigns`, `marketing-modules-stabilization`, `marketing-promotions`, `marketing-studio-budget-cap`, `marketing-studio-caption-and-platform-editing`, `marketing-studio-connections`, `marketing-studio-content-calendar`) ran clean — **36/36 passing**, including the exact `schedule_content_item` reschedule test and the `enqueue_publish` test, confirming Priority 10's fix introduced no UI-level regression.

A full-repository Playwright sweep (502 tests spanning every app area) was run to completion: **490 passed, 12 failed**, all 12 in `settings-and-assistant-panel-repair.spec.js` / `settings-launch-viewport-sweep.spec.js` — zero failures anywhere in Marketing Studio's own scope, confirming the 36/36 figure above held across the entire repository, not just the isolated run. Every one of the 12 was traced to a specific root cause (commit `e143cfb`):

- **10 of 12 were a stale test, not a product defect.** Settings was restructured into tabs (Shop/Branding/AI & Assistants/Billing/Data & Migration/Florisyn — `app.js`'s `data-settings-tab` click handler) by an already-completed, correctly-working redesign that reached this branch's own `beta/august10-stabilization` baseline (commit `1ed2967`) after these regression tests were first written on a sibling branch. "Shop" is the only tab active by default, so Daisy's panel, the referral hub, the AI status card, the assistant voice panels, and the billing actions are all genuinely present in the DOM but correctly CSS-hidden until their tab is clicked — intentional progressive disclosure, confirmed by reading `app.js`'s tab-click handler directly, not a defect. Fixed by giving each test's `openSettings()` helper an optional `{tab}` parameter and clicking the right tab before asserting. **No product code touched.**
- **1 of 12 was a real, tiny product defect**, now fixed at its root: `styles.css` targeted `#settingsPage details.ai-advanced-details`, but the shipped markup uses `class="ai-advanced"` — a dead selector from a class rename that only updated one side, silently dropping the intended top border/spacing before the "Advanced diagnostics" section. Fixed by renaming the CSS selector to match the real markup class (verified no JS referenced the old name first).
- **2 of 12 are left failing, deliberately not force-fixed:** they assert the Settings page's old single-page two-column grid (`align-items:start`, collapses to one column under 850px) — a layout paradigm the tabbed redesign intentionally replaced (`#settingsForm` no longer carries the `settings-grid` class at all in the shipped markup, confirmed by direct inspection). Deciding what layout invariant *should* hold for a tabbed Settings page is a product-design question outside this pass's mandate ("no changing Florisyn's existing design unless strictly required to fix broken behavior") — not something to resolve by guessing at new assertions. Flagged here as a known, precisely-diagnosed, unresolved item rather than silently patched or silently left unexplained.

**Literal re-verification (requested by Ashley, run fresh from final committed HEAD `4404f67`, independent of the triage run above):**

```
npx playwright test --reporter=line
...
502 tests run
2 failed
    [chromium] › tests/e2e/settings-and-assistant-panel-repair.spec.js:139:3 › Settings page repair › the settings grid does not force a short card to stretch to its taller neighbor's height
    [chromium] › tests/e2e/settings-and-assistant-panel-repair.spec.js:234:3 › Settings page repair › Settings collapses to one column on tablet-and-narrower widths
500 passed (12.2m)
```

**The literal, final Playwright result for this repository is 500 passed, 2 failed — not 502/502.** The 2 failures are exactly, and only, the two tests named above — nothing else regressed, nothing new appeared. Those two are **not** being reported as passing, clean, or "accounted for": they are two known, currently-failing tests, left failing on purpose because resolving them means choosing a new layout invariant for the tabbed Settings page (see the reasoning above), which is a product decision outside this pass's mandate — not because the count was rounded up or the failures were waved away. `node --test tests/*.test.js` (2632/2632) and `node scripts/check.mjs` ("Syntax check passed: 729 JavaScript files.") were also re-run clean from this same HEAD.

### Priority 14 — Seven-journey audit
**Status: AUDITED VIA BACKEND-PATH TRACE + EXISTING TEST COVERAGE.** Rather than a UI click-through (already covered by the Playwright evidence above), each journey was traced from its real admin-action entry point through to its actual execution:
1. **Image generation** (`generate_content`, image branch) — fail-closed budget gate (`checkMonthlyBudgetForRequest`, combining the shop's persisted default cap with an optional stricter per-request override — **never** able to exceed the hard shop cap), row-level lock against concurrent double-generation, real Cloudflare Workers AI call. LIVE AND VERIFIED.
2. **Video-concept generation** (`generate_content`, video branch) — same budget gate, real script/storyboard generation. LIVE AND VERIFIED (concept only — see Priority 7 for rendering).
3. **Digital Twin** — two real entry points confirmed wired: `request_personal_brand_digital_twin` (direct action → `personal-brand-service.js`) and `compound.requestDigitalTwinRender` (Priority 8, inside a compound request). Both correctly report "connection required" rather than fake success. BUILT AND READY FOR CREDENTIALS/APPROVAL.
4. **Compound requests** — fully audited this pass (Priorities 8/9); budget-gated, idempotent, schedules and queues correctly. LIVE AND VERIFIED up to the provider-connection boundary.
5. **Scheduling** — Priority 10's fix confirmed correct via reverted-then-restored regression test; DST-safe; e2e-verified. LIVE AND VERIFIED.
6. **Social publishing** — real adapters, real asset/token/identity resolution, real failure classification, real retry/backoff, disclosure-gated, connection-state-gated. BUILT AND READY FOR CREDENTIALS/APPROVAL (code path is real and tested; no platform is actually connected today).
7. **Analytics** — real `fetchAnalytics` wiring, real reconciliation, anti-fabrication guardrails. BUILT AND READY FOR CREDENTIALS/APPROVAL (same boundary as #6 — nothing to ingest until a platform is connected and something is actually published).

### Priority 15 — Comprehensive test/security verification
**Status: ONGOING THROUGHOUT, CONFIRMED AT CHECKPOINT.** Every priority in this pass followed run-targeted-then-full-suite discipline; the full Node suite was re-run after every change (never just the touched file). **Literal final state, re-verified fresh from committed HEAD `4404f67`:**
- `node --test tests/*.test.js` — **2632/2632 passing.**
- `node scripts/check.mjs` — **"Syntax check passed: 729 JavaScript files."**
- `npx playwright test` (full repository, 502 tests) — **500 passed, 2 failed.** The 2 failures are exactly `settings-and-assistant-panel-repair.spec.js`'s two settings-grid tests, named and explained in Priority 13 above. They are not counted as passing here. This is not 502/502 — the repository does not currently pass every Playwright test, and this report states that plainly rather than rounding up.

### Priority 16 — Commit and push
**Status: DONE, incrementally.** Every priority in this pass was committed as its own logical, reviewable commit and pushed to `feature/florisyn-marketing-studio-clone-providers` immediately after its tests passed — never batched, never left uncommitted:

```
e143cfb Priority 13: fix pre-existing Playwright failures found by the full-repo sweep
8cd31ce Priorities 6-16: final Phase C completion report
ca1886d Priority 10: reschedule now resyncs an already-queued publishing job
8dd412c Priority 9: compound orchestration hardening — request-level idempotency
884510f Priority 8: Digital Twin actually renders inside compound requests
14aa5d4 Priority 7: make video-render readiness actually reachable (plan_video_render)
acab06e Priority 5 completion: wire real social adapters into the actual publishing/analytics execution paths
```
(Priorities 1–4 and the base of 5 were committed in the preceding session — `943a7d8`, `6217ee0`, `4cf8967`, `98cb37e`, `f53180c`, `23f7c78` — and are the accepted checkpoint referenced in Section 1.)

---

## 3. Budget-cap preservation — explicitly re-confirmed

Ashley's instruction required that "no generation/publishing workflow may bypass the hard shop budget cap" and that "the current implementation uses both the per-request ceiling and persisted shop monthly cap" must be retained. Re-verified by direct code inspection at report time (`marketing-studio.js`'s `generate_content` action, `checkMonthlyBudgetForRequest` call site): the fail-closed check estimates the real cost of the requested generation, combines the shop's persisted default cap with an optional caller-supplied `budget_cap_cents` (which can only be *stricter*, never looser, than the shop's configured hard cap), and refuses — before any provider is called — if the effective cap would be exceeded. Nothing in this pass touched this code path; it was re-read, not modified, and remains exactly as strict as it was at the Priority 2 checkpoint.

---

## 4. Full capability categorization

No inflated percentages. Every row below is either traced to a specific file/line this pass verified, or explicitly marked as unchanged from the baseline audit.

| Capability | Status | Evidence |
|---|---|---|
| Compound request orchestration (Lily plans + executes a multi-step ask) | 🟢 **LIVE AND VERIFIED** | `marketing-compound-orchestrator.js`; 29 tests |
| Per-shop monthly + per-request budget cap (fail-closed) | 🟢 **LIVE AND VERIFIED** | `marketing-budget-guard.js`; re-confirmed unchanged this pass |
| Image generation | 🟢 **LIVE AND VERIFIED** | Real Cloudflare Workers AI call, budget-gated |
| Video-concept (script/storyboard) generation | 🟢 **LIVE AND VERIFIED** | Concept only, not a rendered file |
| Video-render **plan** (what a real provider call would need) | 🟡 **BUILT AND READY FOR CREDENTIALS/APPROVAL** | `plan_video_render` action, `marketing-video-render-engine.js`; no video-rendering provider connected |
| Digital Twin (avatar+voice) generation | 🟡 **BUILT AND READY FOR CREDENTIALS/APPROVAL** | Two real entry points (direct action + compound step); no HeyGen/ElevenLabs (or equivalent) connection exists |
| Facebook Page/Instagram Business Account resolution | 🟢 **LIVE AND VERIFIED (code path)** | Real Graph API calls (`resolveFacebookPages`, `resolveInstagramBusinessAccount`), tested against mocked real API shapes; requires a real connected Facebook Page to actually execute |
| Real asset-URL resolution for publishing | 🟢 **LIVE AND VERIFIED (code path)** | `ai_generated_assets` → `website_media` → public URL, gated behind `isPlatformConfigured` |
| Encrypted token storage/decrypt/use in the real publish call | 🟢 **LIVE AND VERIFIED (code path)** | `decryptSocialToken`, used by both the publishing worker and analytics ingestion |
| Facebook/Instagram/TikTok publish (actual provider call) | 🟡 **BUILT AND READY FOR CREDENTIALS/APPROVAL** | Real adapters + real worker wiring; zero platforms connected today — see Ashley action items below |
| Failure classification (fatal/transient/token_invalid/ambiguous) + retry/backoff | 🟢 **LIVE AND VERIFIED** | `marketing-publishing-queue.js`; `ambiguous` deliberately never auto-retries (duplicate-post risk) |
| Connection-health states (connected/error/needs_reauth/not_connected) | 🟢 **LIVE AND VERIFIED** | Real states, real UI badges, `token_invalid` failures flip a connection to `needs_reauth` automatically |
| Disclosure gate (pre-publish, fail-closed) | 🟢 **LIVE AND VERIFIED** | Re-audited this pass; unaffected by new code |
| Scheduling (shop-local time → UTC, DST-safe) | 🟢 **LIVE AND VERIFIED** | Re-audited + hardened this pass (Priority 10) |
| Scheduled/unattended publish trigger | 🟡 **BUILT, NOT DEPLOYED** | `marketing-scheduled-publisher.js` + `netlify.toml` schedule entry exist in the repo; requires an actual Netlify deploy with the scheduler enabled to go live — no deploy performed this pass per standing rule |
| Duplicate-request protection (compound_request) | 🟢 **LIVE AND VERIFIED** | Priority 9, this pass |
| Duplicate-publish-job protection (enqueue_publish) | 🟢 **LIVE AND VERIFIED** | Pre-existing, re-audited this pass, confirmed already correct |
| Reschedule resyncing an already-queued job | 🟢 **LIVE AND VERIFIED** | Priority 10, this pass, fix + regression test |
| Analytics ingestion (real fetch, real reconciliation) | 🟡 **BUILT AND READY FOR CREDENTIALS/APPROVAL** | Same boundary as publishing — nothing to ingest until something real is published |
| Admin Connections panel (honest per-platform status) | 🟢 **LIVE AND VERIFIED** | Re-verified this pass via e2e |
| Content Calendar UI (approve/reject/schedule/queue) | 🟢 **LIVE AND VERIFIED** | Pre-existing (Blocker 4), re-verified this pass via e2e including the Priority 10 reschedule fix |

---

## 5. Exact Ashley action required to take this fully live

Everything above the "BUILT AND READY FOR CREDENTIALS/APPROVAL" boundary is code-complete and tested. To cross that boundary, Ashley (not Claude) must:

1. **Create a Meta developer app** (developers.facebook.com) with `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish` permissions, and complete Meta's App Review for those permissions (required for any use beyond the app's own admin/test users).
2. **Create a TikTok developer app** (developers.tiktok.com) with Content Posting API access, and complete TikTok's app review/approval.
3. **Set the resulting credentials as real environment variables** on the Netlify site (`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, and the token-encryption key already documented in the Priority 3 commit) — this is what flips `isPlatformConfigured()` from false to true and makes the real adapters reachable.
4. **Connect at least one real Facebook Page / Instagram Business Account / TikTok account** through the now-real OAuth flow (Connections panel → Connect), so a connection with a real, usable token exists to publish against.
5. **Choose a video-rendering provider** (e.g. an HeyGen/ElevenLabs-equivalent, or a dedicated rendering service) if the Digital Twin / rendered-Reel capability is wanted live — this pass built the plan/contract layer but did not (and per the standing "no purchases/no external accounts" rule, could not) select or connect one.
6. **Authorize an actual Netlify deploy** with the scheduled-function feature enabled, once ready to let publishing run unattended rather than only via the manual admin "Run publishing queue now" action.

None of the above requires further Claude engineering work — the code path for each is built, tested, and waiting only on real credentials/accounts/a deploy that only Ashley can authorize.

---

## 6. What is genuinely still open

- **Settings page's two-column-grid regression tests (2 tests, `settings-and-assistant-panel-repair.spec.js`):** assert a single-page 2-column grid layout that the already-shipped tabbed-Settings redesign intentionally replaced. Not a defect — a product-design question (what layout invariant should hold per-tab) that this pass's mandate did not extend to deciding. See Priority 13.
- **Analytics-ingestion concurrency hardening** (Priority 12's one documented, unfixed, low-severity item) — worth revisiting only if/when a scheduled analytics trigger is added.
- Everything gated behind the six Ashley action items in Section 5.

**Zero inflated completion claims:** nothing above is described as "live" unless a real, traced code path was found or a real provider call actually succeeded in a test against a mocked-but-real API shape; nothing is described as "supported"/"ready" without the specific boundary (credentials, deploy, connection) that separates it from actually running.
