# Florisyn Creative AI + Marketing Studio — Final Launch Readiness Audit

**Audit date:** 2026-08-24
**Auditor:** Claude (audit-only pass, no feature work performed)
**Scope:** Everything needed for Ashley to say *"Lily, create my marketing for tomorrow — a 60-second Digital Twin video, a Reel, an image post, prepared for my platforms, that I can approve, schedule, and have actually publish"* and have it really happen.

**Method.** Every claim below is either (a) traced directly to a specific file/function in this repository — cited as `path:line` — or (b) sourced from a live external search dated August 2026 with a link, or (c) explicitly marked as an assumption/unknown. No claim rests on "an adapter/interface exists" alone; each pathway was followed from Lily's entry point through to whatever actually executes (or doesn't).

---

## Addendum (2026-08-24, later same day) — Launch Blockers 1–4 engineering pass

A follow-up engineering pass closed 4 of the 9 launch blockers identified below in code. **Nothing was deployed, applied, purchased, or connected** — see the pass's own completion report for the full safety confirmation. This addendum states precisely what changed; the sections below are left as the historical record of what this pass found and are annotated inline where a finding changed.

- **Blocker 1 (disclosure/publishing-queue inconsistency) — RESOLVED IN CODE, NOT YET LIVE.** The real defect was more precise than originally stated: `enforcePrePublishDisclosureGate()` was always correctly fail-closed in design, but every content-attachment call site (`generate_content`, `personal_brand_concept_to_content_item`, `plan_month`) left `ai_disclosure_required` at its DB default (`false`) unless a human separately called `set_content_disclosure` — a fail-*open* gap in practice. A new `computeDisclosureFields()` helper (`_shared/creative-ai/disclosure-policy.js`) is now called at every real content-attachment site so disclosure is computed the moment AI content is attached, not only on an optional follow-up. `marketing-publishing-queue.js`'s separate, narrower `requiresAiDisclosure()` (Meta+TikTok only) now delegates to the one authoritative policy table instead of maintaining parallel logic. 15 new/updated tests.
- **Blocker 2 (migration + RLS review) — REVIEWED, NOT APPLIED.** All 7 migrations read in full; see the updated Section 21 below — correction: only 4 are actually new to PR #177 (the other 3 were already merged into the base branch before this audit). Zero migration-level defects found; every table is RLS-enabled with the standard `is_shop_member(shop_id)` policy, tokens/secrets are correctly locked to service-role-only. The real finding was at the **application-code** layer, not the migrations: `marketing-studio.js`'s handlers run on the service-role client (bypasses RLS), so tenant isolation is enforced entirely by explicit `.eq("shop_id", shopId)` filters — a full sweep of every `.from("marketing_*"/"ai_generated_assets")` call found two real gaps (`evaluate_ab_experiment`'s variant/metrics lookups trusted a caller-supplied `content_item_id` cross-reference with no shop filter; `run_publishing_queue`'s variant read had no shop filter as defense-in-depth) — both fixed, both covered by new tenant-isolation tests.
- **Blocker 3 (real durable scheduler) — BUILT AND TESTED, NOT LIVE-VERIFIED.** A new `_shared/marketing-publishing-worker.js` provides an atomic claim-then-process engine (`claimDueJobs`/`processClaimedJob`/`runPublishingWorker`) — safe under concurrent callers via a re-checked `status='queued'` UPDATE, no new migration/stored procedure needed. `run_publishing_queue` (admin-triggered) now uses this engine instead of its old unclaimed SELECT-then-loop. A new Netlify Scheduled Function, `marketing-scheduled-publisher.js`, claims+processes jobs across every shop on a 10-minute cadence, configured via a `netlify.toml` `schedule` entry — **committed only; not deployed, and this PR being merged is not itself sufficient to activate it** (requires an actual Netlify deploy to a site where the scheduler is enabled, which this pass explicitly does not do). A real shop-timezone-aware local→UTC conversion helper (`shopLocalDateTimeToUtcIso`, DST-tested against the real 2026 US transition dates) backs a new `schedule_content_item` action.
- **Blocker 4 (Calendar/Review/Approve/Schedule UI) — BUILT AND TESTED (Playwright, against the real UI).** A new "Content Calendar" panel in `public/marketing-studio-admin.js` (inside the existing admin-only `#marketingStudioRoot`) lists content items with real status badges, opens a detail view (caption, per-platform disclosure status, honest "Connection required" badges — never a fake green connected state), and wires Approve/Reject/Schedule/Queue-for-publishing/Run-publishing-queue-now to the real backend actions. **Two real gaps remain and are called out honestly, not papered over:** there is still no caption-editing action or UI, and no post-creation add/remove-platform control — platforms are fixed at content-item creation time. 6 new Playwright e2e tests, run against the real admin.html, all passing.
- **What did NOT change:** Lily compound orchestration, Reel/video rendering, video transformations, social OAuth, real social publishing, analytics ingestion, and provider activation — none of these were touched, per Section 6 of the assigning instructions.
- **Test suite after this pass:** 2419/2419 passing (up from 2383 before this pass — 36 net new tests). See the pass's completion report for the full breakdown.

---

## 0. Safety confirmation

| Item | Status |
|---|---|
| Repository | `ashley396/Bloom` |
| Branch | `feature/florisyn-marketing-studio-clone-providers` |
| Pull request | #177 |
| Base branch | `beta/august10-stabilization` |
| HEAD commit (this audit) | `5005d471b9db00c8a2eecb70967994ad9bd6beb5` |
| Working tree | Clean, no uncommitted changes |
| `main` branch | **Not modified** (verified at `eb690be`, untouched this session) |
| Bloom Technologies (platform-admin/marketplace core) | **Not modified** |
| Production deployment | **None performed** |
| Production database | **Not modified** — no migration applied to any live project |
| Merge | **None performed** |
| Provider accounts/OAuth apps/purchases | **None created** |
| Social accounts | **None connected** |
| Founder Story section | **Not touched** (verified byte-identical to the approved, design-locked version) |

This document is itself the only artifact this pass produces (Section 32) — see the git commit noted in the completion report.

---

## 1. Full user-journey trace: "Lily, create my marketing for tomorrow"

Tracing Ashley's literal compound request against the actual code path, step by step. Status legend: 🟢 READY · 🟡 READY-AFTER-CONFIG · 🟠 PARTIAL · 🔴 STUBBED · ⚫ MISSING · 🔵 BLOCKED-BY-THIRD-PARTY

| Step | What Ashley asked for | What actually exists | Status | Evidence |
|---|---|---|---|---|
| 1. Say it to Lily in one sentence | "Make a video, a Reel, an image post, for my platforms, tomorrow" | `ai-intent-router.js`'s `classifyRequest()` produces **one** `action_type` + **one** `domain` per message — never a decomposed list of sub-intents | ⚫ MISSING | `netlify/functions/_shared/ai-intent-router.js:1-196` |
| 2. Lily plans all 3 asset types + platform variants in one job | Compound multi-asset, multi-platform plan | `ai-orchestrator.js`'s `planJob()` has exactly 4 mutually exclusive branches (`campaign`, `create+marketing`, `video`, `photo`); none combine video+image+multi-platform in one call | ⚫ MISSING | `netlify/functions/_shared/ai-orchestrator.js:1-120` |
| 3. Real shop data (inventory, tomorrow's arrangements, occasion) grounds the content | Content about *tomorrow's actual* flowers | `marketing-content-planner.js` produces a dated **skeleton** (type + generic title/brief) — brief text *instructs* future generation to use real inventory, but the planner itself never reads a products/inventory/recipes table | 🟠 PARTIAL | `netlify/functions/_shared/marketing-content-planner.js:1-184` |
| 4. Image post generated | A real, usable image | Real Cloudflare Workers AI call (`@cf/black-forest-labs/flux-1-schnell`), text-to-image only, uploaded via the existing media pipeline | 🟡 READY-AFTER-CONFIG | `netlify/functions/_shared/ai-image-engine.js:1-118` |
| 5. Reel produced | A finished, playable short-form video | Only a script/storyboard/caption/thumbnail **plan** — zero rendering | 🔴 STUBBED | `ai-creative-engine.js` video-concept generator; `media-output-planner.js:1-144` |
| 6. 60-second Digital Twin video | A finished video of Ashley's likeness+voice saying something | Full chain exists as code (Lily → Personal Brand → consent → AvatarEngine → VoiceEngine → HeyGen/ElevenLabs → webhook → finalization) but **no live provider connected**; every method throws a typed "not live" error | 🔴 STUBBED (code-complete, provider-blocked) | See Section 7 |
| 7. Platform-specific versions (9:16/1:1/4:5/16:9, captions, safe-area) | Ready-to-post derivatives per platform | Transformation **plan** only — no ffmpeg/transcoding execution exists anywhere in this codebase | 🔴 STUBBED | `media-output-planner.js:1-144` (header explicitly states no media-processing capability exists) |
| 8. Ashley reviews/approves in a UI | See it, edit caption, approve/reject | Backend approve/reject state machine is real; **no UI** renders content-calendar/list-content/approve-content anywhere in `marketing-studio-admin.js` | 🟠 PARTIAL (backend only) | `marketing-content-planner.js` `resolveApprovalDecision()`; grep of `public/marketing-studio-admin.js` confirms no UI hooks |
| 9. Schedule it | Pick a time, it queues | `enqueue_publish` inserts real job rows with `next_attempt_at`; well-designed retry/backoff logic exists in `marketing-publishing-queue.js` | 🟠 PARTIAL | `netlify/functions/marketing-studio.js:1582-1650` |
| 10. It actually publishes to Facebook/Instagram/TikTok/etc. | A post appears on Ashley's real accounts | Every platform provider is a `notLiveSocialProvider()` — every method throws `SOCIAL_NOT_LIVE` (501). Zero platforms are live today | 🔴 STUBBED | `netlify/functions/_shared/marketing-social-providers.js:1-124` |
| 11. Something triggers step 10 automatically at the scheduled time | A scheduler that runs unattended | `run_publishing_queue` is a **manually invoked, super-admin-only action** — nothing in `netlify.toml` schedules it; zero cron/scheduled-function entries exist | ⚫ MISSING | `netlify.toml` grep: zero `schedule`/`cron` matches; `marketing-studio.js:1653` |
| 12. Feature is turned on for Ashley | Marketing Studio is reachable at all | `MARKETING_STUDIO` feature flag defaults `false`; every action additionally requires `platformAdmin(event, ["super_admin"])` | 🟡 READY-AFTER-CONFIG | `netlify/functions/_shared/feature-flags.js:72`; `marketing-studio.js:132,184` |

**Bottom line for Section 1:** every individual capability Ashley named has real, often well-architected code behind it. None of them chain together into the single compound request without (a) provider connections Ashley must make herself, (b) a rendering/transcoding execution layer that does not exist yet, (c) a scheduler trigger that does not exist yet, and (d) a review/approval UI that does not exist yet.

---

## 2. Lily orchestration capability — traced, not inferred

**Does Lily handle the whole compound request, or only pieces individually?** Traced via `ai-intent-router.js` → `ai-orchestrator.js`:

- `classifyRequest(message, {hasImage})` (`ai-intent-router.js:1-196`) makes **one** LLM call and returns **one** `action_type` from an 11-value enum plus **one** `domain`. There is no decomposition step that turns "video + Reel + image + schedule + publish" into a list of sub-jobs.
- `planJob()` (`ai-orchestrator.js:1-120`) switches on that single `action_type`:
  - `campaign` → campaign row + per-channel **posts** (text), optional single image/website-section. No video. No Digital Twin. No scheduling.
  - `create` + `domain==="marketing"` → one post + one image.
  - `video` → concept/script/storyboard + thumbnail image only. No rendering.
  - `domain==="photo"` → Visual Creation Studio branches (revise/background/flyer/crop).
- **Conclusion: 🔴 STUBBED for the compound case.** Lily can be asked for *one piece* (an image, a post, a video concept) and will produce that piece. She cannot currently take "handle my marketing for tomorrow across video+Reel+image+platforms+schedule" as one instruction and decompose it into the right sequence of sub-jobs — that orchestration layer does not exist. Each capability must be invoked separately, by a caller (today: direct API calls, since no UI exists for most of them — see Section 20).

---

## 3. Brand Brain + Personal Brand Memory — stored vs. consumed

- **Storage is real.** `get_brand_brain` / `update_brand_brain` / `forget_brand_trait` / `reset_brand_brain` (`marketing-studio.js:207-256`) and the Personal Brand equivalents (`get_personal_brand_profile` etc., `marketing-studio.js:1136-1350`) are full CRUD backends over real tables.
- **Consumption is narrower than storage.** `buildVisualBrief()` (`ai-intent-router.js`) explicitly blends the user's message with shop style memory for **image backdrop generation** — this is a real, traced consumption path. The video-concept generator's real-data context was confirmed to pass only `shop.name` (`marketing-studio.js:492-581`, partial read) — no products/inventory/recipes, no deeper Brand Brain fields, into video concepts.
- **🟠 PARTIAL:** Brand Brain is genuinely read for image generation prompts; it is **not** confirmed to shape video-concept generation, content-calendar planning, or platform-variant copy beyond the shop name. Do not assume "Brand Brain informs everything Lily produces" — trace each generator individually before relying on this.

---

## 4. Content planning audit (tomorrow / weekly / monthly)

`marketing-content-planner.js:1-184` — `buildMonthlyContentPlan({year, month, allowance, platforms})`:
- Real date math (`spreadAcrossMonth()`, `interleaveByQuota()`), real occasion-awareness (`nearestOccasion()` against a real calendar list), real content-type variety (`EVERGREEN_CONTENT_ANGLES` — 8 generic categories).
- **What it does not do:** read real inventory, real product/arrangement data, or real recipe data. The generated `brief` field is a text instruction telling a *later* generation step to ground itself in real shop data — the planner is a **skeleton generator**, not a content generator.
- **🟠 PARTIAL.** "Tomorrow" and "this week" both work as date targets; "aware of what's actually in stock or what arrangement Ashley made today" does not, at the planning stage. Whether the later `generate_content` step actually pulls live inventory was independently checked (Section 1, row 3) — it does not today; only `shop.name` was confirmed as real-data context.

---

## 5. Image generation — trace against what "Marketing Studio can produce Ashley-ready images" requires

`ai-image-engine.js:1-118`:
- **Model/provider:** Cloudflare Workers AI, `@cf/black-forest-labs/flux-1-schnell`. Real HTTP call, real upload via the existing `website-media.js` pipeline.
- **Quality tier:** single tier — the model itself; `marketing-cost-config.js` prices `image_standard` (4¢) vs `image_premium` (8¢) but the *engine* only calls the one Flux Schnell model — the premium tier is a cost-config placeholder, not a second real model path confirmed wired into `ai-image-engine.js`.
- **Text rendering in images:** not confirmed — Flux Schnell is known to be weak at in-image text generally; no Florisyn-side post-processing/text-overlay step was found.
- **Image-to-image / reference-image editing:** not present in `ai-image-engine.js` itself. What *is* real: the **Personal Brand Studio compositing flow** — `buildBackgroundPrompt()` generates an empty AI backdrop deliberately excluding any subject, and a **real segmented photo cutout of the florist's actual arrangement** is composited client-side over that backdrop. This is a genuine reference-photo pathway, but it is compositing, not true img2img/inpainting on the base model.
- **Background generation:** real, via the above.
- **Personal Brand integration:** real for the backdrop-compositing flow specifically.
- **Flower-vision integration:** not confirmed reached from `ai-image-engine.js` in this pass.
- **Cost tracking:** `marketing-cost-config.js` has real per-unit pricing constants; whether every image generation call actually writes a ledger row was not independently re-verified this pass (carried over from prior work, not re-traced here).
- **The gap between "image gen exists" and "Marketing Studio can produce Ashley-ready images":** 🟡 READY-AFTER-CONFIG for a single flat-lay/product-style AI image or a backdrop-composited real-arrangement photo. **⚫ MISSING** for: a second quality tier, reliable in-image text (a sale banner, a price tag), true reference-image editing of an arbitrary uploaded photo, and confirmed flower-vision grounding.

---

## 6. Reels — the hard answer

**Does Florisyn produce a finished, playable Reel today? No.**

What exists: `ai-creative-engine.js`'s video-concept generator produces a script, a storyboard (shot list), captions, and a thumbnail **image** (via `ai-image-engine.js`). `media-output-planner.js` can produce a *plan* for how a finished asset would be reframed to 9:16 with safe-area math — but that plan is never executed, because there is no rendering/transcoding engine (no ffmpeg, no video-composition service, no TTS-to-lip-sync pipeline for anything other than the HeyGen avatar chain) anywhere in this codebase.

**Precise statement for Ashley:** "Create a Reel" today produces a written creative brief (script + shots + captions + a static thumbnail image) that a human would need to film/edit/render outside Florisyn. It does not produce an `.mp4` she can post. This is 🔴 STUBBED, not partial — there is no execution path at all, only planning.

---

## 7. 60-second Digital Twin video — full chain trace + exact requirements

**Chain:** Lily intent (`video` action_type) → Personal Brand context → consent check (`personal-brand-consent.js`) → `AvatarEngine` (`avatar-engine.js:1-60+`) → `VoiceEngine` (`voice-engine.js:1-60+`) → HeyGen/ElevenLabs HTTP clients (`marketing-heygen-client.js`, `marketing-elevenlabs-client.js`) → webhook (`heygen-webhook.js` + `heygen-webhook-verify.js`, HMAC-verified via `verifyHeygenWebhookSignature()`) → `digital-twin-finalization.js` → asset row → approval queue.

Every one of these files is real, production-quality code — this is the most architecturally complete pathway in the whole system — and it is **entirely gated behind providers that are not connected**:
- `notLiveAvatarProvider` (`avatar-engine.js`) throws `AVATAR_NOT_LIVE` (501) on every method until a real HeyGen adapter is registered.
- `notLiveVoiceProvider` (`voice-engine.js`) throws `VOICE_NOT_LIVE` (501) the same way for ElevenLabs.
- `request_personal_brand_digital_twin` (`marketing-studio.js:1550`) is the real entry point — reachable in principle, but calls into the above.

**Exact requirements checklist before this can produce one real video (DO NOT purchase — this is the list, not an action):**
1. A funded HeyGen account + a paid plan/wallet (pay-as-you-go, no free tier as of Feb 2026 — [HeyGen API pricing](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained)).
2. HeyGen avatar setup — either a stock avatar or a trained "Digital Twin"/photo-avatar group of Ashley (`createHeygenPhotoAvatarGroup`/`trainHeygenPhotoAvatarGroup` exist in `marketing-heygen-client.js`).
3. `HEYGEN_API_KEY` configured in the Netlify environment (name confirmed via grep; value not checked — see Section 22).
4. `HEYGEN_WEBHOOK_SECRET` configured, so `heygen-webhook.js` can verify inbound completion callbacks.
5. An ElevenLabs account. If a cloned voice of Ashley is wanted (not a stock voice), **Professional Voice Cloning requires the Creator plan or above ($22/mo minimum)** — [ElevenLabs pricing](https://bigvu.tv/blog/elevenlabs-pricing-2026-plans-credits-commercial-rights-api-costs/).
6. `ELEVENLABS_API_KEY` configured.
7. Recorded consent — the schema and enforcement (`personal-brand-consent.js`, `marketing-clone-consent.test.js`, `personal-brand-consent.test.js`) exist and are covered by tests, but a *real* consent record for Ashley's own likeness/voice must actually be created through the (currently UI-less) flow before a job can run.
8. Storage for the finished video asset — reuses the existing media pipeline; no separate provisioning identified as required.
9. The `digital_twin_lifecycle` migration (`20260826000000_digital_twin_lifecycle.sql`) must be applied to whichever Supabase project this runs against — **not applied anywhere today** (Section 21).
10. `MARKETING_STUDIO` feature flag enabled + Ashley's account has `super_admin`/authorized access (Section 20/21).
11. **Estimated per-video cost** — see Section 23; using researched HeyGen per-second rates ($0.0167–$0.0667/sec), a 60-second video costs roughly **$1.00–$4.00** in HeyGen charges alone, plus voice cost.

**Status: 🔴 STUBBED (code-complete, provider-blocked).** This is the single most "ready to go live" pathway in the whole audit — it needs account setup and configuration, not new engineering, to become real. It is the best Phase-1 investment target (see Section 27/29).

---

## 8. Provider reality check

| Provider | Purpose | Real HTTP adapter in repo? | Credentials referenced in code | Credentials configured (can't check values — see §22) | Environment tested against | Fallback/failure behavior | Required account/plan |
|---|---|---|---|---|---|---|---|
| Cloudflare Workers AI (Flux Schnell) | Text-to-image | Yes — `ai-image-engine.js` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_API_TOKEN`/`CLOUDFLARE_AI_TOKEN` | Unknown from this sandbox; very likely already configured since the same token powers Lily's live chat (`ai-assistant.js`) | Sandbox/mocked-fetch unit tests only | `imageGenerationConfigured()` gate returns a clean "not configured" rather than crashing | A Cloudflare account with Workers AI enabled; no separate purchase beyond usage |
| HeyGen | Avatar video generation, Digital Twin | Yes — `marketing-heygen-client.js`, wrapped by `avatar-engine.js` | `HEYGEN_API_KEY`, `HEYGEN_WEBHOOK_SECRET` | Unknown | Mocked-fetch unit tests only — **never called against a real HeyGen account in this repo's history** | Fail-closed: `notLiveAvatarProvider` throws typed 501 rather than faking success | Pay-as-you-go wallet, avatar/Digital-Twin setup |
| ElevenLabs | Voice synthesis / cloning | Yes — `marketing-elevenlabs-client.js`, wrapped by `voice-engine.js` | `ELEVENLABS_API_KEY` | Unknown | Mocked-fetch unit tests only | Fail-closed: `notLiveVoiceProvider` throws typed 501 | Creator plan ($22/mo+) for Professional Voice Cloning specifically |
| Facebook / Instagram / TikTok / LinkedIn / Pinterest / Google Business Profile / YouTube | Social publishing | **No** — `marketing-social-providers.js`'s `notLiveSocialProvider()` is the only implementation; no per-platform OAuth/publish HTTP client exists yet | `FLORISYN_SOCIAL_<PLATFORM>_CLIENT_ID`/`_CLIENT_SECRET` (14 dynamically-named vars, `platformOAuthEnvVarNames()`) | N/A — even if set, `isPlatformLive()` is hardcoded `false` for all 7 | Not applicable — no real client exists to test | Fail-closed: every method throws `SOCIAL_NOT_LIVE` (501); `classifyPublishFailure()` settles these to `'failed'` immediately, never endless-retries a structurally-absent provider | See Section 10/11 |

**Providers researched but not connected:** none beyond the above found referenced in code. No evidence of Runway/Pika/Sora/Synthesia or any other generative-video vendor being wired in anywhere — `media-output-planner.js`'s own header states this environment has no media-processing capability today.

---

## 9. Video transformation engine re-audit — PLANS vs. EXECUTES

`media-output-planner.js:1-144`:
- `REFRAME_STRATEGIES`: `CENTER_CROP` is implemented as a **plan** entry only (the actual crop math for 9:16/1:1/4:5/16:9/safe-area is computed and returned as data); `AI_REFRAME` is explicitly commented "NOT IMPLEMENTED — named slot only."
- `PLANNER_TO_ASSET_TRANSFORMATION_TYPE` maps plan types to asset-transformation-type strings — data plumbing, not execution.
- `planDerivedAssets({masterAsset, targetPlatforms})` returns a list of *planned* derivative specs (dimensions, captions-on/off, thumbnail spec, platform duration limit) — it never calls out to a transcoder.
- **Captions/burned-captions/thumbnails/platform duration/safe-area:** all present as **plan fields**, none executed.
- **Status: 🔴 STUBBED across the board.** There is no execution engine in this codebase today. This is the single largest gap between "Florisyn plans great platform-native content" and "Florisyn produces it."

---

## 10. All 7 social platforms — individually, never grouped

Shared substrate for all 7: `marketing-social-providers.js` (`notLiveSocialProvider()`, `isPlatformLive()` hardcoded `false`, `isPlatformConfigured()` real env-presence check separate from "live"), `marketing-publishing-queue.js` (real retry/backoff/dead-letter logic, structurally unreachable until a platform goes live), `disclosure-policy.js` (real per-platform AI-disclosure policy data).

| Platform | OAuth impl | Token storage/refresh | Publish adapter (real HTTP) | Scheduling | Media upload | Analytics retrieval | AI disclosure mechanism (code) | External approval required | Credentials required | Status today |
|---|---|---|---|---|---|---|---|---|---|---|
| **Facebook** | Not implemented — `connect_platform` returns an explicit "OAuth flow not implemented" response even with credentials present | None | None (not-live stub) | Job rows can be created (`enqueue_publish`), never executed | None | `analytics_summary` reads Florisyn's own `marketing_performance_metrics` table (schema-constrained `source='platform_api'`) — **no real ingestion job exists**, so this table is currently always empty for real data | `native_label` (Meta AI-info labels), confidence MEDIUM | Business verification + App Review, ~2-4 weeks — but **not required at all if Ashley only connects her own account** via Instagram/Facebook Tester role in dev mode ([Meta developer docs](https://developers.facebook.com/docs/permissions/)) | `FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID/SECRET` | 🔴 STUBBED |
| **Instagram** | Same as Facebook (Meta's Graph API), but note: publishing is a distinct two-step call (media container → `media_publish`) and requires a **Professional (Business/Creator) account linked to a Facebook Page** — a personal IG account cannot be used | None | None (not-live stub) | Same as Facebook | None | Same caveat as Facebook | `native_label`, same Meta policy | Same as Facebook for Ashley's own account (Tester role, dev mode, no App Review needed for single-account use); Advanced Access (business verification) needed only once Florisyn serves *other* florists' accounts, not for Ashley alone | `FLORISYN_SOCIAL_INSTAGRAM_CLIENT_ID/SECRET` | 🔴 STUBBED |
| **TikTok** | Not implemented | None | None | Job rows only | None | None | `native_label` + auto-detection via C2PA even without self-labeling, confidence HIGH | **Unaudited clients are restricted to `SELF_ONLY` (private) posting** — real public posting requires a compliance audit (2-4 weeks); posts made while unaudited never retroactively become public ([TikTok docs](https://developers.tiktok.com/doc/content-posting-api-get-started)) | `FLORISYN_SOCIAL_TIKTOK_CLIENT_ID/SECRET` | 🔴 STUBBED, additionally 🔵 BLOCKED (audit) for anything beyond private test posts |
| **LinkedIn** | Not implemented | None | None | Job rows only | None | None | `creator_disclosure`, no confirmed structured API field, confidence MEDIUM | Community Management API requires a **legally registered organization** + a super-admin of the LinkedIn Page verifying the app + Development→Standard tiers, the latter needing a screencast demo ([Microsoft Learn / LinkedIn docs](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-06)) | `FLORISYN_SOCIAL_LINKEDIN_CLIENT_ID/SECRET` | 🔴 STUBBED, 🔵 BLOCKED pending business registration + Standard-tier approval |
| **Pinterest** | Not implemented | None | None | Job rows only | None | None | `no_api_mechanism_confirmed` — Pinterest's own Gen-AI-label classifier may auto-detect, but no confirmed API field for Florisyn to proactively set, confidence LOW (fails closed) | Trial access is auto-granted fast, but **Pins stay hidden from the public** until Standard Access is approved (video-demo review, 1-4 weeks) ([Pinterest docs](https://developers.pinterest.com/docs/key-concepts/access-tiers/)) | `FLORISYN_SOCIAL_PINTEREST_CLIENT_ID/SECRET` | 🔴 STUBBED, 🔵 BLOCKED for public-visible pins until Standard Access |
| **Google Business Profile** | Not implemented | None | None | Job rows only | None | None | `no_api_mechanism_confirmed`, confidence LOW (no clear post-specific AI policy found; treated conservatively) | Requires a **GBP verified 60+ days**, a Cloud project, a business website, and a formal access-request review (~14 days; quota stays 0 QPM until approved) ([Google developer docs](https://developers.google.com/my-business/content/prereqs)) | `FLORISYN_SOCIAL_GOOGLE_BUSINESS_CLIENT_ID/SECRET` | 🔴 STUBBED, 🔵 BLOCKED pending GBP API access approval |
| **YouTube** | Not implemented | None | None | Job rows only | None | None | `native_label` (Altered/synthetic content toggle), confidence HIGH | Default 10,000-unit/day quota (uploads now bucketed separately at 100 calls/day since Dec 2025); **quota beyond default requires a Google compliance audit** with a demo-video OAuth flow submission, no guaranteed timeline ([Google developer docs](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)) | `FLORISYN_SOCIAL_YOUTUBE_CLIENT_ID/SECRET` | 🔴 STUBBED |

**Important nuance for Ashley's specific situation (single-shop, own-accounts-only use):** several of the above third-party gates (Meta App Review, TikTok audit's public-posting restriction) exist specifically to protect *other users'* accounts when a platform serves many outside users. For **Phase 1 (Ashley posting to her own accounts only)**, Meta explicitly does not require App Review — a Tester role in dev mode suffices. This meaningfully shrinks the Phase-1 third-party blocker list; the full-review requirements return once Florisyn on-boards other florists' accounts (multi-tenant social publishing), which is a real Phase-2/3 consideration, not a Phase-1 one.

---

## 11. Platform approval research (August 2026) — configure-now vs. review-required

| Platform | Can configure immediately (dev/self-account) | Requires app review | Requires business verification | Requires API access approval | Requires OAuth verification | Source |
|---|---|---|---|---|---|---|
| Meta (Facebook/Instagram) | Yes, for Ashley's own account via Tester role | Only once other users connect | Only for Advanced Access (multi-user) | — | — | [developers.facebook.com/docs/permissions](https://developers.facebook.com/docs/permissions/) |
| TikTok | Yes, but posts stay private (`SELF_ONLY`) | Yes, for public posting | — | Yes (the "audit") | — | [developers.tiktok.com](https://developers.tiktok.com/doc/content-posting-api-get-started) |
| LinkedIn | No — Community Management API requires org registration up front | — | Yes, legal entity registration + Page super-admin verification | Yes, Development→Standard tiers | — | [learn.microsoft.com/linkedin](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-06) |
| Pinterest | Yes, Trial (fast) but pins are non-public | — | — | Yes, Standard Access (video demo, 1-4 wks) | Yes (OAuth flow shown in demo) | [developers.pinterest.com](https://developers.pinterest.com/docs/key-concepts/access-tiers/) |
| Google Business Profile | No | — | Verified 60+ day GBP required | Yes (~14-day review) | — | [developers.google.com/my-business](https://developers.google.com/my-business/content/prereqs) |
| YouTube | Yes, within default 10,000-unit/day quota | Only for quota extension | — | Yes, for extended quota (compliance audit) | Yes, part of the audit | [developers.google.com/youtube](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) |

---

## 12. Scheduler audit

Traced the full chain: **approved content → scheduled time → durable job → execution → provider publish → retry → dead letter → status update.**

- **Approved → scheduled time:** real. `enqueue_publish` (`marketing-studio.js:1582-1650`) only runs once `status === 'approved'`; writes `marketing_publishing_jobs` rows with `next_attempt_at` and an idempotency key (`buildIdempotencyKey()`), and flips the content item to `'scheduled'`.
- **Durable job:** real — a DB-backed table, not an in-memory queue.
- **Execution:** `run_publishing_queue` (`marketing-studio.js:1653`) is a real handler with real due-job selection (`isJobDue()`), but it is a **manually invoked, super-admin-gated action**. Nothing calls it automatically.
- **Provider publish / retry / dead letter:** `marketing-publishing-queue.js`'s `classifyPublishFailure()`, `computeBackoffSeconds()` (60s base, doubling, capped 6h), `nextJobStateAfterFailure()` are all real, well-designed retry logic.
- **What's missing:** a trigger. `netlify.toml` has zero `schedule`/cron entries. There is no GitHub Action, no external cron, no Netlify Scheduled Function calling `run_publishing_queue` on any cadence.

**Per the user's own framing: this is correctly NOT called a scheduler.** It stores `scheduled_at`/`next_attempt_at` and has a real (unautomated) processor with genuine retry engineering — but nothing executes it unattended. **Status: ⚫ MISSING (trigger layer).** The processing logic itself is 🟢 READY; only wiring a cron trigger (Netlify Scheduled Functions support this natively) stands between "real retry logic exists" and "actually runs on a schedule."

> **RESOLVED IN CODE — NOT YET LIVE (2026-08-24 engineering pass).** A real trigger now exists: `netlify/functions/marketing-scheduled-publisher.js`, configured via a `netlify.toml` `[functions."marketing-scheduled-publisher"] schedule = "*/10 * * * *"` entry, claims+processes due jobs across every shop using a new atomic claim engine (`_shared/marketing-publishing-worker.js`) that also replaced `run_publishing_queue`'s old unclaimed SELECT-then-loop (a genuine concurrency gap that existed even for two overlapping manual admin triggers, now closed for both callers). **Not deployed** — committing/pushing to this branch does not itself activate a scheduled invocation on any live site.

---

## 13. Volume audit — Ashley's target (≈30 images + 30 Reels + 30 ~60s videos/month = 90 pieces)

- `marketing-cost-config.js`'s `DEFAULT_MONTHLY_ALLOWANCE` (`image_posts: 30, reels_or_shorts: 30, long_form_videos: 30`) **already matches this target exactly** — the allowance model was clearly designed with this volume in mind.
- **Job throughput:** untested at any real volume — no load test exists in the repo for `run_publishing_queue` or the generation endpoints.
- **Provider rate limits:** HeyGen/ElevenLabs — not researched against Florisyn's specific plan tier this pass (would depend on which tier Ashley buys). Pinterest Trial access is rate-limited per-day/per-app rather than per-minute (coarser, could be a real constraint at 30 pins/mo if combined with other trial-tier apps — unlikely to bind at this volume). YouTube's new 100-calls/day upload bucket comfortably covers 30 uploads/month.
- **Storage:** reuses the existing Supabase Storage/media pipeline; no separate capacity analysis performed this pass — flagged as unverified.
- **Scheduler throughput:** moot until the trigger from Section 12 exists.
- **Retry behavior at volume:** the exponential backoff (60s→6h cap) is volume-appropriate for 90 jobs/month — this is a low-volume system by SaaS standards, unlikely to strain the retry design.
- **Monthly cost:** see Section 23.
- **Conclusion:** nothing structurally blocks 90 pieces/month once the execution gaps in Sections 6/7/9/10/12 close; no volume-specific bottleneck was found *in the code that exists*, but real throughput has never been tested because nothing end-to-end has run yet.

---

## 14. Approval workflow audit

`Generate → Review → Edit → Approve → Schedule → Publish`:

| State | Backend | UI | Authorization | Audit trail |
|---|---|---|---|---|
| Generate | Real (`generate_content`, video-concept, image engine) | No dedicated generation UI beyond Personal Brand Studio's chat/concept flow | `requireSuperAdmin` | `writeCommandAudit()` calls present on mutating actions |
| Review | `list_content` action exists | **No UI** | super_admin only | — |
| Edit | Not confirmed as a distinct action (caption edits would go through `update_*` style actions if any exist — not independently verified this pass) | **No UI** | — | — |
| Approve/Reject | Real state machine (`resolveApprovalDecision()`: approved→`'approved'`, rejected→`'archived'`), `approve_content` action | **No UI** | `requireSuperAdmin` before mutation | `writeCommandAudit()` on `enqueue_publish` at minimum; approve/reject audit coverage not independently re-verified this pass |
| Schedule | Real (`enqueue_publish`) | **No UI** | `requireSuperAdmin` | Yes, `writeCommandAudit("marketing_publish_enqueued", ...)` |
| Publish | Blocked — every platform not-live | **No UI** | `requireSuperAdmin` for `run_publishing_queue` | N/A, never executes |

**Confirms: generation never equals approval.** A generated item's status is distinct from `'approved'`; `enqueue_publish` explicitly checks `currentItem.data.status !== "approved"` and refuses otherwise (`marketing-studio.js:1598-1600`). The gate is real. **The entire workflow is backend-only** — see Section 20 for the UI gap in full.

---

## 15. Disclosure/compliance re-audit

`disclosure-policy.js` (re-confirmed this pass, full file read) remains intact and unmodified by anything in this session:
- `PLATFORM_DISCLOSURE_POLICY` covers all 7 platforms with a `confidence` rating (HIGH/MEDIUM/LOW) and, critically, **fails closed**: platforms where no confirmed API mechanism exists (Pinterest, Google Business Profile) are marked `mechanism: "no_api_mechanism_confirmed"` and still `requiresDisclosureForAIContent: true` — the module explicitly refuses to "invent a disclosure mechanism a platform doesn't actually expose."
- `determineDisclosureRequirement()` is a pure function; any of `avatarUsed`/`voiceUsed`/`generativeVideoUsed`/`generativeImageUsed` being true triggers a requirement, deliberately conservative even where a platform's own language is ambiguous (e.g., voice-only content).
- **One internal inconsistency found this pass, worth flagging as a finding, not silently fixed (per audit-only instructions):** `marketing-publishing-queue.js`'s `requiresAiDisclosure(platform, wasAiGenerated)` only flags Meta+TikTok (`AI_DISCLOSURE_PLATFORMS` — confirmed via grep, not shown in the excerpt above but the function only checks membership in that shorter list), while `disclosure-policy.js`'s richer policy table considers all 7 platforms disclosure-required. **These two modules disagree** — the publishing-queue's simpler gate is narrower than the compliance module's real policy data. Since publishing is not-live everywhere today this has zero live impact, but it is a real gap to close before any platform goes live: the queue should consult `disclosure-policy.js`, not its own shorter hardcoded list.
- **Fail-closed publishing:** confirmed as designed at the policy layer; whether `enqueue_publish`/`run_publishing_queue` actually call into `determineDisclosureRequirement()` before allowing a real publish was not independently re-traced line-by-line this pass (carried forward from architecture, not re-verified against the current file this exact session).

> **RESOLVED IN CODE — NOT YET LIVE (2026-08-24 engineering pass).** The re-trace above found the real defect was more serious than "two functions disagree": `enforcePrePublishDisclosureGate()` was always correctly wired and fail-closed by design, but `ai_disclosure_required` was never computed at the moment AI content was actually attached to a variant — it only ever became `true` via an optional, easy-to-skip `set_content_disclosure` call, so the gate defaulted to "not required" in practice. A new `computeDisclosureFields()` helper is now called at every real content-attachment site (`generate_content`'s image/video branches, `personal_brand_concept_to_content_item`, and — already correct before this pass — `digital-twin-finalization.js`). `requiresAiDisclosure()` now delegates to `determineDisclosureRequirement()` instead of its own narrower list. 15 new/updated tests cover AI image / Digital Twin avatar+voice / synthetic voice / ordinary non-AI media / required+applied / required+not-applied / an uncertain-mechanism platform (Pinterest) / no-provider-call-on-failure / no-infinite-retry.

---

## 16. Consent + revocation re-test

Confirmed still present and still part of the current green test suite (Section 25 — 2383/2383 passing includes these):
- `tests/marketing-clone-consent.test.js`
- `tests/personal-brand-consent.test.js`
- `tests/digital-twin-quarantine.test.js`
- `tests/revoked-media-security-gates.test.js`

These cover (from this session's earlier hardening work, re-confirmed intact, not re-read line-by-line this pass since no code changed): independent per-consent-type revocation (likeness/voice/reference-photo), in-flight-job revocation, quarantine of already-generated media on revocation, post-completion revocation, a direct-ID bypass check (asset-ID-guessing can't route around a revoked consent), and a publishing block tied to revoked media. **Status: 🟢 READY (code-level, tested) — not yet integration-tested against a real HeyGen/ElevenLabs job, since none has ever run.**

---

## 17. Analytics audit

`analytics_summary` (`marketing-studio.js:1843`, read in full earlier this session) reads real Florisyn tables, including `marketing_performance_metrics`. That table is schema-constrained to `source='platform_api'` — meaning **the schema exists to hold real ingested analytics, but no ingestion job that calls a platform's real analytics API and writes rows was found anywhere in this codebase.** Since no platform is live (Section 10), there is nothing to ingest yet regardless.
- **Can Florisyn retrieve real views/reach/impressions/likes/comments/shares/clicks/watch-time/conversions today?** No — 🔴 STUBBED. The query layer is real; the data source is empty because nothing populates it.
- **Can Lily use analytics to improve future marketing?** No evidence of a closed-loop "read past performance → adjust future generation" path was found reachable from the current `planJob()`/content-planner code traced in this pass.
- **Schema-exists vs. real-ingestion-exists:** clearly distinguished — schema: 🟢 READY. Ingestion: ⚫ MISSING.

---

## 18. Comments + DMs audit (audit only)

No retrieval, response, Lily-assisted-reply, or moderation code for social comments/DMs was found anywhere in `marketing-studio.js`'s 48-action inventory or the `_shared/` Marketing Studio modules read this pass. **Status: ⚫ MISSING entirely.** This is not a partial capability — no code path touches platform comment/DM APIs at all (consistent with zero platforms being live to have comments on).

---

## 19. Marketing Studio UI inspection

`public/marketing-studio-admin.js` (594 lines; header explicitly states: *"Deliberately minimal: status + AI Clone enrollment/preview/consent... Content planning/calendar/publishing-queue/analytics UI is not built here yet."*)

| Capability | Backend action exists | UI exists |
|---|---|---|
| Open Marketing Studio (status/overview) | `status` | Yes |
| Talk to Lily (Personal Brand command chat) | `personal_brand_command` | Yes |
| See content calendar | `content_calendar`, `plan_month` | **No** |
| See/list content | `list_content` | **No** |
| Preview images/videos | Clone preview only | Yes, but only for AI-Clone sanity-check jobs (`clone_job_status` polling), not general content preview |
| Edit captions | Not confirmed as a distinct backend action | **No** |
| Approve/reject | `approve_content` | **No** |
| Schedule | `enqueue_publish` | **No** |
| Select platforms | Implicit in variant creation | **No** dedicated UI |
| Inspect costs | `marketing-cost-config.js` data exists | **No** UI surfaces it |
| See connection status | `connections` | Not confirmed wired to UI beyond generic status |
| See analytics | `analytics_summary`, `list_insights` | **No** |
| Manage Personal Brand | Full CRUD action set | Yes — real UI (profile/reference-photos/command-chat/concept-handoff/feedback) |
| Manage Digital Twin (AI Clone) | `request_personal_brand_digital_twin`, enrollment/consent/preview | Enrollment/consent/preview: Yes. Actual Digital Twin *request*: **No** UI hook found |

**Conclusion:** roughly two-thirds of the backend action surface has **no usable UI** at all today. Ashley cannot currently reach the calendar, content list, approval, scheduling, platform-selection, cost, or analytics screens through the app — only Personal Brand management and AI-Clone enrollment/consent/preview are click-through-able.

> **BUILT AND TESTED (2026-08-24 engineering pass) — Calendar/list/preview(partial)/approve/schedule now have real UI.** A new "Content Calendar" panel in `public/marketing-studio-admin.js` lists content items with real status badges (a date-sorted list, deliberately not a full calendar grid), opens a per-item detail view (caption, per-platform disclosure status with an explicit "Disclosure REQUIRED — not yet applied" warning when relevant, honest "Connection required" badges — never a fake green connected state), and wires Approve/Reject/Schedule (real shop-timezone-aware date/time picker)/Queue-for-publishing/Run-publishing-queue-now to the real backend actions, including the two new ones this pass added (`schedule_content_item`). Cost is surfaced shop-wide (not yet per-item) with ESTIMATED/ACTUAL explicitly labeled separately, via the existing `usage_summary` action. 6 Playwright e2e tests run against the real `admin.html`, all passing. **Two real gaps remain, called out rather than papered over:** no caption-editing action or UI exists yet (the detail view displays the caption but cannot change it), and no post-creation add/remove-platform control exists (platforms are fixed at content-item creation time via `plan_month`/`personal_brand_concept_to_content_item`). Preview of generated images/video is still only real for AI-Clone sanity-check jobs, not general content preview, as originally found.

---

## 20. Feature flag / admin access verification

- `MARKETING_STUDIO: false` by default (`feature-flags.js:72`); overridable via `FLORISYN_FLAG_MARKETING_STUDIO=true|false` env var per the module's own doc comment. **Not enabled this pass.**
- Independently of the flag, every Marketing Studio action requires `platformAdmin(event, ["super_admin"], deps)` (`marketing-studio.js:184`) — a second, code-level gate beyond the feature flag. Ashley's account would need `super_admin` platform-admin status, not just the flag flipped, for any of this to be reachable even once enabled.
- **What's needed for "Ashley-only":** flip `FLORISYN_FLAG_MARKETING_STUDIO=true` (env var, no redeploy required per the pattern used elsewhere in this codebase — many other flags already default `true` in production, confirming flags can flip without a deploy) **and** confirm Ashley's account carries `super_admin` in `platform_admins`. Neither was done this pass (explicitly prohibited).

---

## 21. Migrations list for PR #177 (not applied — do not apply)

In filename/date order (which also appears to be the real dependency order):
1. `20260819120000_marketing_campaigns_v1.sql`
2. `20260819140000_marketing_promotions_v1.sql`
3. `20260823000000_marketing_studio_foundation_v1.sql`
4. `20260824000000_creative_ai_webhook_disclosure_media.sql`
5. `20260825000000_personal_brand_studio.sql`
6. `20260826000000_digital_twin_lifecycle.sql`
7. `20260827000000_revoked_media_quarantine.sql`

**None of these have been applied to any live Supabase project (staging or production) as of this audit.** RLS-policy content, rollback risk, and compatibility with the live schema were **not re-verified line-by-line this pass** (would require reading all 7 files in full, which risks materially exceeding this pass's audit-only budget) — flagged as an explicit open item: **before any of these are applied, a dedicated migration-review pass should read each file for RLS coverage on every new table and confirm no destructive `ALTER`/`DROP` against existing production data.** Do not treat "the migrations exist in the PR" as equivalent to "they're safe to apply."

> **REVIEWED — NOT APPLIED (2026-08-24 engineering pass).** All 7 files were read in full. **Correction to the framing above:** only 4 are actually new to PR #177's diff against `beta/august10-stabilization` — `20260824000000_creative_ai_webhook_disclosure_media.sql`, `20260825000000_personal_brand_studio.sql`, `20260826000000_digital_twin_lifecycle.sql`, `20260827000000_revoked_media_quarantine.sql`. `20260819120000_marketing_campaigns_v1.sql`, `20260819140000_marketing_promotions_v1.sql`, and `20260823000000_marketing_studio_foundation_v1.sql` already exist in the base branch (a prior, separate, already-merged PR) — they were reviewed for completeness but are not "this PR's migrations" in the git-diff sense.
>
> **Per-migration classification (all): READY TO APPLY TO STAGING.** Every table: RLS enabled, the standard `is_shop_member(shop_id)` policy (`for all to authenticated using(...) with check(...)`), `anon` revoked, `service_role` full grant, `if not exists`/`drop ... if exists` idempotency throughout. The two secrets/webhook tables (`marketing_social_connection_secrets`, `marketing_webhook_events`) are correctly locked to service-role-only (RLS enabled with zero policies + explicit revoke from both `anon` and `authenticated`) — the token-storage requirement is met. The two `check` constraint widenings (`ai_generated_assets_asset_type_check`, `ai_generated_assets_status_check`) were verified against their actual prior definitions in earlier migrations — both are strict supersets, cannot violate existing data. Dependency ordering (filenames) matches real FK dependency order. No destructive `ALTER`/`DROP` found. **No new migration was needed for the Blocker 3 scheduler** — the safe job-claim pattern was achieved with plain `UPDATE ... WHERE status='queued'` re-checks via the existing schema, not a new stored procedure.
>
> **One real (non-migration) finding from this review, fixed:** `marketing-studio.js`'s handlers run on the service-role client, which bypasses RLS entirely — so tenant isolation for this admin API is enforced ONLY by explicit `.eq("shop_id", shopId)` filters in application code, not by the RLS policies above (those remain real, correct defense-in-depth for any future direct/browser-side query path). A full sweep of every `.from("marketing_*"/"ai_generated_assets")` call in `marketing-studio.js` found two real gaps: `evaluate_ab_experiment`'s variant/metrics lookups trusted a caller-supplied `content_item_id` (from the experiment's own `variants` jsonb, itself never validated at creation time) with no shop filter — a forged/foreign `content_item_id` could pull another shop's real platform-variant and performance-metrics rows; `run_publishing_queue`'s variant read had no shop filter as defense-in-depth (not independently exploitable today, since the job it's reached through was already shop-scoped, but hardened regardless). Both fixed; both covered by new tenant-isolation tests confirming the `shop_id` filter is actually present on both queries.

---

## 22. Environment variable checklist (names only — no values checked or exposed)

| Variable | Area | Status as coded |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Image generation | Referenced, required |
| `CLOUDFLARE_AI_API_TOKEN` / `CLOUDFLARE_AI_TOKEN` | Image generation + Lily chat (shared) | Referenced, required |
| `HEYGEN_API_KEY` | Digital Twin avatar | Referenced, required |
| `HEYGEN_WEBHOOK_SECRET` | Digital Twin webhook verification | Referenced, required |
| `ELEVENLABS_API_KEY` | Voice cloning/synthesis | Referenced, required |
| `FLORISYN_FLAG_MARKETING_STUDIO` | Feature flag override | Referenced, optional (defaults `false`) |
| `FLORISYN_SOCIAL_<PLATFORM>_CLIENT_ID` / `_CLIENT_SECRET` (×7 platforms = 14 vars) | Social OAuth | Referenced, required per-platform once OAuth is implemented (it isn't yet — see §10) |

**Whether any of the above are actually configured in the real Netlify environment cannot be determined from this sandbox** — this session's own `process.env` reflects the sandbox, not the deployed site, and per the explicit "do not expose values" instruction no value-revealing check was attempted anywhere, including indirectly. This must be checked directly in Netlify's site configuration by someone with dashboard access.

---

## 23. Cost audit for Ashley's target volume (30 images + 30 Reel-scripts + 30 ~60s Digital Twin videos/month)

**Ground rule applied throughout:** a master asset is generated once; per-platform reframing (when execution exists) reuses it — costs are never multiplied by 7 platforms.

**Florisyn's own internal cost-config** (`marketing-cost-config.js`, `COST_CONFIG_VERSION = "partially-verified-2026-08-23"` — the module's own version string already flags itself as not fully verified):
`image_standard` 4¢/image, `image_premium` 8¢/image, `video_standard_second` 8¢/sec, `video_premium_second` 40¢/sec, `avatar_video_second` 3¢/sec, `voice_per_1000_chars` 30¢, `copy_request` 1¢.

**Current real provider pricing found (August 2026):**
- HeyGen: **$0.0167–$0.0667/sec** depending on avatar tier, pay-as-you-go, no free tier ([source](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained)).
- ElevenLabs TTS: **$0.05–$0.10/1,000 chars**; Professional Voice Cloning requires Creator plan, **$22/mo minimum** ([source](https://bigvu.tv/blog/elevenlabs-pricing-2026-plans-credits-commercial-rights-api-costs/)).
- Cloudflare Workers AI (Flux Schnell) per-image pricing was **not independently re-verified this pass** — Florisyn's 4¢/8¢ figures are not confirmed against Cloudflare's current published rate card in this session; treat as unverified.

**Finding:** Florisyn's internal `voice_per_1000_chars` estimate (30¢) is **3-6× higher** than ElevenLabs' current real per-character API rate (5-10¢) — this internal number should be revisited; it was likely set conservatively or is stale. Florisyn's `avatar_video_second` (3¢) sits within HeyGen's real range (1.67-6.67¢), plausible.

**Reels have no real execution cost today because there is no rendering engine (Section 6/9) — the "cost" of a Reel today is $0 in provider fees and also $0 in deliverable value: no finished video is produced.**

| Scenario | Images (30 × real Cloudflare rate, unverified — using Florisyn's own 4-8¢ as a placeholder) | Digital Twin videos (30 × 60s) | Voice | Reels (script/plan only) | **Est. monthly total** |
|---|---|---|---|---|---|
| **LOW** | 30 × $0.04 ≈ $1.20 | HeyGen cheapest tier ($0.0167/s × 60s = $1.00/video) × 30 = $30.00 | Stock HeyGen voice, no separate ElevenLabs cost | $0 (no execution) | **≈ $31** |
| **RECOMMENDED** | 30 × $0.06 ≈ $1.80 | Mid HeyGen tier (~$0.035/s × 60s ≈ $2.10/video) × 30 = $63.00 | ElevenLabs Creator plan flat $22/mo (covers cloned-voice usage at this volume) | $0 | **≈ $87** |
| **MAX QUALITY** | 30 × $0.08 ≈ $2.40 | Top HeyGen tier ($0.0667/s × 60s ≈ $4.00/video) × 30 = $120.00 | ElevenLabs Pro plan $99/mo (headroom for retries/longer scripts) | $0 | **≈ $221** |

**Unverified/flagged items:** Cloudflare per-image real rate, Supabase Storage incremental cost at this volume, whether Pinterest/GBP/YouTube/Meta/TikTok/LinkedIn API access carries any *direct* dollar cost beyond review-time delay (current research found none — all are free API access, gated by approval process not price) — treat the totals above as **provider-fee-only estimates**, not a full operating-cost picture, and re-verify Cloudflare's real image price before treating the image line as authoritative.

---

## 24. Security audit — P0/P1 launch blockers

Re-confirmed against `docs/production/SECURITY-REVIEW.md` and the current test suite (`tests/p0-12-closed-beta-tenant-isolation.test.js`, `tests/crash-security-hardening.test.js`, `tests/foundation-release-security.test.js`), not re-derived from scratch:

- **Super-admin enforcement:** real — `platformAdmin()` verifies the bearer JWT before any service-role query; `requireSuperAdmin(admin)` gates every Marketing Studio mutation.
- **Tenant isolation:** `shop_id` filtering is the established pattern platform-wide; Marketing Studio's own handlers were confirmed (Section 1/12 evidence) to `.eq("shop_id", shopId)` consistently on the code read this pass.
- **RLS:** enforced on florist-facing routes generally per the security review; **not independently re-verified per-table for the 7 new Marketing Studio migrations this pass** (Section 21) — this is the one open item that should block a GO decision until closed.
- **Provider-secret isolation:** all provider keys are server-side env vars, never in client code, consistent with the rest of the codebase's pattern.
- **Webhook auth:** HeyGen webhook signature verification is real (`verifyHeygenWebhookSignature()`).
- **Token storage:** N/A today — no OAuth tokens exist yet since no platform OAuth flow is implemented (Section 10).
- **Consent enforcement / revoked-media protection:** real and tested (Section 16).
- **Cross-tenant asset protection:** consistent with the platform-wide `shop_id` pattern; not independently re-audited row-by-row for the new Marketing Studio tables this pass.

**P0 (must close before any live provider connects):** (1) full RLS review of the 7 unapplied migrations before applying them to any live project. (2) Close the disclosure-policy/publishing-queue inconsistency found in Section 15 before any platform goes live, so a real publish can't skip disclosure on a platform the queue's shorter list missed.

**P1 (should close before Founding Florists / Phase 2):** cross-tenant asset-protection re-audit specifically for the new Marketing Studio tables, once real data exists in them to test against.

> **Status update (2026-08-24 engineering pass):** both P0 items above are now RESOLVED IN CODE — NOT YET LIVE (see Sections 15/21's addenda). The migration review additionally surfaced and fixed two real cross-tenant IDOR gaps at the application-code layer (`evaluate_ab_experiment`, `run_publishing_queue`) — see Section 21's addendum for detail. The P1 cross-tenant asset-protection re-audit remains open, unchanged.

No P0 blocker was found that requires code changes for **Phase 1 (Ashley-only)** beyond the RLS review — Phase 1 involves no other tenant, so cross-tenant risk is inherently lower until Phase 2.

---

## 25. Test suite run + verification classification

```
node --test tests/*.test.js
# tests 2383
# pass 2383
# fail 0
```

**2383/2383 passing**, unchanged from the prior pass (no code was modified this session before this run).

> **Update (2026-08-24 engineering pass): 2419/2419 passing** (36 net new tests: disclosure-field computation, tenant-isolation, the publishing-worker claim engine, the shop-timezone DST-aware conversion helper, the scheduled-function handler, and 6 Playwright e2e tests for the new Content Calendar UI, run against the real `admin.html`). All CODE VERIFIED as before this pass — the scheduled function specifically remains NOT YET VERIFIED LIVE (never actually invoked by Netlify's real scheduler, since nothing was deployed).

| Behavior | CODE VERIFIED | INTEGRATION VERIFIED | NOT YET VERIFIED LIVE |
|---|---|---|---|
| Not-live provider fail-closed behavior (avatar/voice/social) | ✅ | — | Never called against a real account |
| Consent/revocation enforcement | ✅ (dedicated test files) | — | Never tested against a real in-flight HeyGen/ElevenLabs job |
| Publishing-queue retry/backoff math | ✅ | — | Never run against a real publish attempt |
| Feature-flag + super-admin gating | ✅ | — | Not tested against Ashley's real account/session |
| Tenant isolation (`shop_id` scoping) | ✅ | Partially, via existing platform-wide RLS/IDOR test suites | New Marketing Studio tables specifically: not re-verified this pass |
| HeyGen webhook signature verification | ✅ (unit test against synthetic payloads) | — | Never received a real HeyGen webhook |
| Cloudflare image generation | ✅ (mocked fetch) | Possibly — if `CLOUDFLARE_AI_API_TOKEN` is already configured for live Lily chat, this may already work in production, but was not independently confirmed live this pass | Not confirmed live this session |

**"2383/2383 passing" means the code behaves as designed in isolation. It does not mean any provider integration, webhook, or publish has ever actually run against a real external account.**

---

## 26. Competitive gap check (current implementation, not vision)

Compared against Predis.ai, Canva, Buffer, Later, Metricool, Hootsuite, SocialBee, Ocoya, HeyGen, Captions, Creatify — current-state only:

**Real gaps that materially prevent Florisyn from beating these tools today:**
1. **No finished-asset execution** (Reels, video transformations) — every one of Buffer/Later/Hootsuite/SocialBee/Ocoya/Metricool can at minimum schedule and publish a human-made asset today; Florisyn cannot publish *anything* to any of the 7 platforms yet (Section 10). This is the single largest gap.
2. **No live social publishing at all** — the entire category's baseline function (Buffer/Later's core job) is not yet live in Florisyn.
3. **No analytics ingestion** — Metricool/Hootsuite's core value (real cross-platform analytics) has a schema but zero real data (Section 17).
4. **No scheduler trigger** — even Buffer-tier tools have a working unattended scheduler; Florisyn's is manually invoked only (Section 12).
5. **No UI for calendar/approval/scheduling** — Later/SocialBee's calendar-first UX has no equivalent surface in Florisyn today (Section 19).

**Where Florisyn's current implementation already has a real, evidenced edge no single competitor combines:**
- Real florist inventory/product/recipe data model exists platform-wide (not yet fully wired into content generation, but the data itself — unlike any general social tool — genuinely exists).
- Flower-vision and Design DNA capability (built earlier this project, not audited in depth this pass but confirmed present in the codebase from prior work).
- Lily as a single conversational surface across the whole business, not just marketing (Buffer/Later/Hootsuite are marketing-only tools).
- Brand Brain + Personal Brand Memory, with real (if narrow) consumption into image generation.
- A genuinely more architecturally complete Digital Twin pathway (Section 7) than most all-in-one competitors attempt — HeyGen/Captions/Creatify each do one piece of this; Florisyn's code, once connected, chains consent→avatar→voice→disclosure in one place.
- Florist-specific occasion calendar already baked into content planning (`nearestOccasion()`).

**Verdict:** Florisyn's *architecture* is more ambitious and more integrated than any single named competitor, but its *current executable capability* trails all of them on the one thing they each do reliably: actually publishing a real post/video to a real platform. Do not claim competitive parity, let alone superiority, until Sections 6/9/10/12 close.

---

## 27. Minimum-launch definition (three phases — do not cram everything into Phase 1)

**Phase 1 — Ashley-only internal beta minimum:**
- Enable `MARKETING_STUDIO` flag for Ashley's account only; confirm her `super_admin` status.
- Apply the 7 migrations to a real project **after** the RLS review flagged in Section 21/24.
- Connect HeyGen + ElevenLabs (Section 7's checklist) — this is the highest-value, lowest-third-party-friction connection since Ashley posting to her own Meta accounts needs no App Review (Section 10/11).
- Build a minimal review/approve/schedule UI (Section 19/20 gap) — does not need to be polished, needs to exist.
- Wire a Netlify Scheduled Function to call `run_publishing_queue` on a cadence (Section 12).
- Implement real Meta (Facebook + Instagram) OAuth + publish adapters — achievable without App Review for Ashley's own account.
- **Explicitly deferred out of Phase 1:** TikTok/LinkedIn/Pinterest/GBP/YouTube (all carry real third-party review timelines, Section 11), the video-transformation execution engine (build a Reel/9:16 renderer — real infrastructure work, not a Phase-1-sized task), analytics ingestion, comments/DMs.

**Phase 2 — Founding Florists additional requirements:**
- Multi-tenant social OAuth (this is where Meta's Advanced Access + business verification actually becomes required, per Section 10's nuance).
- TikTok audit, LinkedIn org registration, Pinterest Standard Access, GBP API access, YouTube quota extension — all have multi-week third-party timelines; start these applications early in Phase 2, not at the start of Phase 3.
- Real analytics ingestion jobs.
- The disclosure-policy/publishing-queue inconsistency (Section 15) must be closed before Phase 2's multi-tenant publishing goes live.
- Cross-tenant asset-protection re-audit (Section 24 P1).

**Phase 3 — what can safely wait:**
- Video transformation's `AI_REFRAME` strategy (beyond basic center-crop).
- Comments/DMs retrieval and Lily-assisted response.
- A/B experiment evaluation UI polish.
- A second image-quality tier as a genuinely distinct model path (not just a cost-config placeholder).
- Closed-loop analytics-informed content generation.

---

## 28. Owner-actions list (only Ashley can do these)

| Action | What | Why | When | Est. cost | Can Claude continue without it? |
|---|---|---|---|---|---|
| Create/fund a HeyGen account | Pay-as-you-go wallet, choose avatar tier | Digital Twin video generation requires a real provider account | Phase 1, before any real video | $5 minimum wallet load, then usage-based ($1-4/60s video) | No — `AvatarEngine` cannot go live without it |
| Set up Digital Twin avatar in HeyGen | Train/register Ashley's photo-avatar group | The "Digital Twin" specifically (vs. a generic stock avatar) requires this | Phase 1 | Included in HeyGen usage | Yes for a stock-avatar fallback, No for the true "her likeness" version |
| Create/fund an ElevenLabs account, choose plan | Creator plan ($22/mo) if voice cloning of her own voice is wanted | Voice cloning requires a paid tier | Phase 1 | $22/mo+ | Yes, with a stock voice instead |
| Record explicit likeness/voice/reference-photo consent | Go through the (to-be-built) consent UI flow | Legal/ethical requirement, already enforced by code (Section 16) | Phase 1, before first real job | $0 | No — code fails closed without it |
| Connect her own Meta (Facebook + Instagram) accounts via OAuth once built | Authorize the app against her Page/Professional IG account | No App Review needed at her own-account scale, but only she can authorize | Phase 1 | $0 | No |
| Choose social-platform priority/order for Phase 2 review applications | Decide which of TikTok/LinkedIn/Pinterest/GBP/YouTube to pursue first | Each carries a multi-week review timeline; sequencing matters | Start of Phase 2 | $0 (review is free, only time cost) | Claude can prepare applications; Ashley must submit/own business-identity attestations |
| Business verification / legal-entity registration if required (LinkedIn specifically) | Confirm Florisyn/her shop is a registered legal entity for LinkedIn's Community Management API | LinkedIn requires this explicitly | Phase 2 | Varies by jurisdiction, not researched | No |
| Approve provider cost scenario (Section 23) | Pick LOW/RECOMMENDED/MAX-QUALITY | Ongoing operating cost decision | Before Phase 1 goes live | $31-$221/mo (Section 23) | No |
| Grant `super_admin` to her own account (or confirm it's already granted) | Platform-admin role assignment | Marketing Studio requires it in addition to the feature flag | Phase 1 | $0 | No |

---

## 29. Engineering-actions list (Claude can do without Ashley — NOT executed this pass, ordered by launch-blocking > value > risk)

1. **Build the Netlify Scheduled Function that calls `run_publishing_queue` on a cadence** (Section 12) — closes the "not really a scheduler" gap; low risk, no schema change.
2. **Fix the disclosure-policy/publishing-queue inconsistency** (Section 15) — `requiresAiDisclosure()` should consult `PLATFORM_DISCLOSURE_POLICY` instead of its own shorter hardcoded platform list; low risk, isolated change.
3. **Full RLS review of the 7 unapplied migrations** (Section 21/24) before any of them are applied anywhere — blocking, but a read/analysis task, zero execution risk.
4. **Build the minimal calendar/list/approve/schedule UI** (Section 19/20) — the single highest-value UI gap; substantial but well-scoped frontend work against already-real backend actions.
5. **Implement real Meta (Facebook + Instagram) OAuth + publish adapters** — highest-value social platform given the no-App-Review path for Ashley's own accounts (Section 10/11); moderate engineering effort, real external-API integration risk (needs a real Meta app + test account to build against, which itself needs Ashley's involvement to create — so this item has an owner-action dependency even though the code work itself is Claude's).
6. **Build the actual video-transformation execution engine** (Section 6/9) — the largest single piece of missing infrastructure (real transcoding/ffmpeg or a managed video API); high value, high effort, and the item most likely to need its own provider-selection research pass before implementation starts.
7. **Wire real inventory/product/recipe data into content generation** (Section 3/4) — closes the "grounded in tomorrow's actual flowers" gap; moderate effort, no new external dependency.
8. **Real analytics ingestion jobs per platform** (Section 17) — depends on Section 5's OAuth work landing first for each platform; sequence after platforms go live.
9. **Comments/DMs retrieval + Lily-assisted response (Section 18)** — explicitly Phase 3; do not build until multi-platform publishing is stable.

**None of the above were executed this pass, per the explicit audit-only instruction.**

---

## 30. Final GO/NO-GO scorecard

| Area | Status |
|---|---|
| Lily orchestration (compound request) | 🔴 BLOCKED (engineering) |
| Brand Brain | 🟡 CONFIGURATION-REQUIRED (partially consumed) |
| Personal Brand | 🟢 READY (backend), 🟠 UI gap |
| Image creation | 🟡 CONFIGURATION-REQUIRED |
| Reel creation | 🔴 BLOCKED (no execution engine) |
| Digital Twin video | 🟡 CONFIGURATION-REQUIRED (code-complete, provider accounts needed) |
| Voice | 🟡 CONFIGURATION-REQUIRED |
| Approval workflow | 🟡 CONFIGURATION-REQUIRED *(was 🟠 — UI built 2026-08-24, real backend + real UI now exist; still needs Marketing Studio flag/deploy to reach Ashley)* |
| Video transformations (platform reframing) | 🔴 BLOCKED (no execution engine — unchanged, out of scope for this pass) |
| Scheduling (trigger) | 🟡 CONFIGURATION-REQUIRED *(was 🟠 — real claim-safe worker + Netlify Scheduled Function built and tested 2026-08-24; needs an actual deploy to go live, not further engineering)* |
| Facebook | 🟠 ENGINEERING-REQUIRED (no review blocker for Ashley's own account) |
| Instagram | 🟠 ENGINEERING-REQUIRED (same, plus Professional-account prerequisite) |
| TikTok | 🔴 BLOCKED (engineering + third-party audit for public posting) |
| LinkedIn | 🔴 BLOCKED (engineering + business registration + tiered approval) |
| Pinterest | 🔴 BLOCKED (engineering + Standard Access approval for public pins) |
| Google Business Profile | 🔴 BLOCKED (engineering + 60-day-verified-GBP + review) |
| YouTube | 🟠 ENGINEERING-REQUIRED (no blocking review needed within default quota) |
| Disclosure | 🟢 READY *(was 🟡 — the internal inconsistency and the underlying fail-open gap are both fixed and tested 2026-08-24)* |
| Consent/revocation | 🟢 READY (code + tests) |
| Analytics | 🔴 BLOCKED (schema only, zero ingestion — unchanged) |
| UI | 🟡 CONFIGURATION-REQUIRED *(was 🔴 — Calendar/Review/Approve/Schedule now real and tested 2026-08-24; caption-editing and post-creation platform selection remain unbuilt)* |
| Security | 🟢 READY *(was 🟡 — migration RLS review complete, zero migration defects found; the two real application-layer IDOR gaps this review surfaced are fixed and tested 2026-08-24)* |
| Cost tracking | 🟡 CONFIGURATION-REQUIRED (config exists, one rate likely stale) |

---

## 31. The most important question

**If Ashley wanted to use Florisyn tomorrow morning to create and automatically publish three pieces of marketing content, what exactly would stop her?**

In plain English: almost everything downstream of "ask Lily" would stop her. Lily would only take one piece of the request at a time, not the whole sentence. She could get a real AI-generated image today, if the image-generation credentials already configured for her chat with Lily are the same ones needed here (likely, but unconfirmed). She could not get a finished Reel — only a script and a thumbnail, because nothing in this codebase actually renders video yet. She could not get her 60-second Digital Twin video, because no HeyGen or ElevenLabs account has ever been connected — the code that would drive it is real and complete, but there is no provider on the other end. Even if all three assets existed, there is no screen where she could see them, edit a caption, or press approve — that workflow only exists as backend code today. And even if she approved something, nothing would actually post it to Facebook, Instagram, or any other platform, because every single platform adapter is an honest "not connected yet" stub — none of the seven has ever made a real API call to a real social platform from this codebase. And even if one did, nothing would fire the publish automatically at the scheduled time, because no scheduler trigger exists — only a manually-run processor.

**The shortest safe path from today's state to that working experience:** (1) Ashley funds a HeyGen account and an ElevenLabs Creator plan and records her consent — this alone lights up the single most complete pathway in the system. (2) Claude fixes the disclosure-policy inconsistency and reviews the 7 unapplied migrations for RLS, then applies them to a real (non-production) project. (3) Claude builds a minimal approve/schedule screen and a Netlify Scheduled Function trigger for the publishing queue. (4) Claude implements real Meta OAuth + publish adapters, which needs no App Review at Ashley's own-account scale. At that point — images, Digital Twin videos, and Meta (Facebook + Instagram) publishing would be genuinely real, on a real schedule, for Ashley alone. Reels (rendered video) and the other five platforms remain a second, larger phase of work — the video-transformation execution engine is the single biggest remaining engineering gap, and TikTok/LinkedIn/Pinterest/GBP each carry real weeks-to-months third-party review timelines that should be started early, in parallel, rather than treated as something to defer until everything else is done.

---

*Sources for external claims cited inline above by hyperlink. Internal claims cited by `path:line`. This document distinguishes verified code-level facts (traced this pass), carried-forward facts (verified in earlier sessions of this project, not re-derived line-by-line here, noted explicitly wherever used), and open unknowns (Cloudflare's real per-image rate, live environment-variable configuration, per-table RLS content of the 7 unapplied migrations) — treat only the first category as fully load-bearing for a launch decision without further verification.*
