# Florisyn Creative AI — Master Plan (Phase A: Foundation)

Status: **Phase A deliverable — audit, design, plan.** No provider code changed. HeyGen and
ElevenLabs remain fully active and unmodified. This document is the "FIRST TASK" output required
before any Phase B (Florisyn Voice R&D) work begins, per the master directive.

## 0. Mandate, restated in one sentence

Build Florisyn-owned creative-AI models (voice, avatar/digital-human, image, video, floral
intelligence) behind a single internal provider abstraction, alongside the existing HeyGen/
ElevenLabs/Cloudflare integrations — never replacing them until a Florisyn model passes measured
production gates — so a florist can eventually ask Lily for a full campaign and get one, with
Florisyn's own models doing the generation instead of a rented API.

## 1. What already exists (the real audit)

This codebase already went through an earlier "AI-OS rebuild" (Phases 1–5, referenced in code
comments across `ai-creative-engine.js`, `ai-orchestrator.js`, `ai-intent-router.js`,
`ai-image-engine.js` — no standalone doc was ever written for it, so this section is that record,
reconstructed from the code itself). A significant amount of what the master directive asks for
under "Provider Abstraction," "Brand & Style Memory," and "Floral Intelligence" **already exists**,
under different names, and should be extended rather than rebuilt.

| Capability | Current implementation | Vendor(s) | Ownership level* | Abstraction status |
|---|---|---|---|---|
| Copy/text generation | `ai-creative-engine.js`, `ai-orchestrator.js`, `lily-ai-engine.js`, `ai-intent-router.js` | Cloudflare Workers AI (LLM) | Level 1 (hosted API) | Centralized, one call path |
| Image generation | `ai-image-engine.js` | Cloudflare Workers AI (diffusion) | Level 1 | Centralized (`generateImage()`), used by Marketing Studio, Photo Studio, Website Builder X, Lily |
| Arrangement/flower vision (Floral Intelligence, partial) | `florist-ai-vision.js` | Cloudflare Workers AI (vision models, 2-tier fallback + captioning) | Level 1 | Already the `FloralVisionEngine` the directive asks for — real, live, feeds Lily's recipe extraction |
| Brand & Style Memory | `ai-style-memory.js` | None (pure internal state, DB-backed) | N/A — fully Florisyn-owned already | This **is** item 5 of the directive, already built: explicit-statement writes, repetition-based promotion, rejection-based decay |
| General video rendering (B-roll, text-to-video) | `ai-video-provider.js` | **None connected** — explicit no-op (`createNullVideoProvider`) | N/A | Clean provider-registry pattern already in place (`getVideoProvider()`), zero real providers registered |
| Avatar video (talking clone) | `marketing-clone-provider-heygen-elevenlabs.js` via `marketing-clone-providers.js` | HeyGen (Photo Avatar Group, `/v3/videos`) | Level 1 | `clone.*` interface + `selectCloneProvider(criteria, registry)` — same registry pattern as video provider, already documented as "Florisyn owns the workflow, not the model" |
| Voice cloning + TTS (Marketing Studio clone) | `marketing-elevenlabs-client.js` | ElevenLabs (`/v1/voices/add`, `/v1/text-to-speech/{id}`) | Level 1 | Wrapped inside the same composite `clone.*` adapter as avatar — **not a standalone VoiceEngine today** (see gap below) |
| Voice (assistant personas: Lily/Rose/Daisy/Bud) | `assistant-tts.js` | ElevenLabs (separate, direct `fetch` to `api.elevenlabs.io`) | Level 1 | **Not centralized** — a second, independent ElevenLabs client, duplicating `marketing-elevenlabs-client.js`'s logic (see gap below) |
| Cost tracking | `marketing-cost-config.js` + `marketing_generation_usage` table | N/A | N/A | Real per-unit cost table (image/video-second/avatar-second/character), `estimated_cost_cents`/`actual_cost_cents`/`status` columns already exist — foundation for item 10 (Cost Router) already laid, just not yet capturing GPU/inference-time granularity (nothing runs in-house yet, so there's nothing to meter) |
| Consent (voice/likeness) | `marketing-clone-consent.js` + `marketing_clone_consent` table | N/A | N/A | Already covers item 13's core: named person, explicit avatar/voice permission, closed-vocabulary approved usage/platforms, revocation cascades to suspend dependent profiles |

\* Ownership levels per the directive's own scale (§11): Level 1 = external hosted API, Level 2 =
third-party weights on Florisyn infra, Level 3 = Florisyn-trained weights, Level 4 = original
Florisyn architecture/research. **Nothing in this codebase is above Level 1 today.** Any future
claim of a "Florisyn model" must be checked against this table before being called that.

### Gaps found (real, concrete, worth fixing before Phase B)

1. **Duplicated ElevenLabs client.** `assistant-tts.js` (assistant voices) and
   `marketing-elevenlabs-client.js` (Marketing Studio clone) each independently call
   `api.elevenlabs.io` with their own `fetch` logic, error handling, and API-key wiring. Both
   should sit behind one `VoiceEngine.synthesize()` call. Today they're two code paths that will
   drift.
2. **No standalone VoiceEngine.** ElevenLabs is only reachable today through the avatar-coupled
   `clone.*` composite provider — there's no way to request voice-only synthesis (e.g., for a
   voicemail greeting, or the assistant personas) through the same abstraction the directive
   specifies (`VoiceEngine.FlorisynVoice` / `VoiceEngine.ElevenLabsAdapter`).
3. **No standalone AvatarEngine either** — same coupling issue, mirrored for HeyGen.
4. **General Florisyn Video AI (item 6) has zero implementation** — `ai-video-provider.js` is a
   real, clean abstraction with nothing registered behind it. This is a fully open gap, not a
   migration.
5. **Floral Intelligence (item 4) is partially built** (vision/flower ID via `florist-ai-vision.js`)
   but arrangement recipes, mechanics, container/style taxonomies, and substitution logic live
   scattered across `marketing-content-planner.js`/community recipe code rather than one
   `FloralVisionEngine`-adjacent knowledge module. Worth consolidating, not rebuilding.
6. **No CopyEngine formalized** — copy generation works and is centralized in practice
   (`ai-creative-engine.js`), but it isn't named/exposed as a peer engine alongside
   Voice/Avatar/Image/Video the way the directive's §8 architecture wants.

## 2. Target architecture: `CreativeAI`

Rather than introduce a parallel abstraction, this formalizes and extends the pattern that already
works in `marketing-clone-providers.js` / `ai-video-provider.js` — registry + `isConfigured(env)` +
fail-closed default — as the one shape every engine uses.

```
netlify/functions/_shared/creative-ai/
  voice-engine.js        // synthesize(), clone(), delete() — wraps ElevenLabsAdapter today
  avatar-engine.js        // createAvatarProfile(), generateVideo(), getJobStatus() — wraps HeyGenAdapter today
  image-engine.js          // generate(), edit() — wraps ai-image-engine.js's Cloudflare call (no behavior change)
  video-engine.js           // renderVideo() — renamed/promoted ai-video-provider.js, still zero providers registered
  copy-engine.js              // generate() — wraps ai-creative-engine.js (no behavior change)
  floral-vision-engine.js       // identify(), analyze() — wraps florist-ai-vision.js (no behavior change)
  registry.js                     // one place every engine's adapter registry is built from env
```

Each engine keeps the exact contract shape already proven in this codebase:

```js
// Every adapter, every engine:
{
  name: "florisyn_voice" | "elevenlabs" | ...,
  isConfigured(env) => boolean,
  async <capability>(params) => { ok: true, ... } | throws a typed "<engine>_not_live" error
}

// Every engine module:
function select<Engine>Provider(criteria, registry) { /* same pattern as selectCloneProvider */ }
function buildConfigured<Engine>Registry({ env, ...deps }) { /* same pattern as buildConfiguredCloneProviderRegistry */ }
```

**Migration for existing code is additive, not a rewrite:** `marketing-clone-provider-heygen-
elevenlabs.js`'s avatar half becomes the first `AvatarEngine` HeyGen adapter, its voice half becomes
the first `VoiceEngine` ElevenLabs adapter (the two are composed together only where the calling
code actually needs both — Marketing Studio's enrollment flow — via a thin composite that calls
into both engines, rather than each provider file re-implementing both vendors' HTTP clients).
`assistant-tts.js` switches to calling `VoiceEngine.synthesize()` instead of its own `fetch`,
eliminating gap #1. Nothing in `marketing-studio.js`'s action handlers changes shape — same
request/response contracts, same tests, same `NOT LIVE — PROVIDER CONNECTION REQUIRED` fallback
behavior.

## 3. Provider policy (today)

| Provider | Status | Role |
|---|---|---|
| HeyGen | **ACTIVE** | Avatar/video — sole real adapter |
| ElevenLabs | **ACTIVE** | Voice — sole real adapter (both Marketing Studio clone + assistant personas) |
| Cloudflare Workers AI | **ACTIVE** | Copy, image, floral vision — sole real adapter for all three |
| Florisyn Voice | Not started | N/A |
| Florisyn Digital Clone | Not started | N/A |
| Florisyn Image | Not started | N/A |
| Florisyn Video (general) | Not started | N/A |

No Florisyn-owned model exists yet at any level above 1, so there is no PRIMARY/FALLBACK question
to answer today — every capability has exactly one real, active provider. This table gets a new row
the moment any Florisyn engine passes its production gate.

## 4. Incremental plan

| Phase | Content | Requires infra/budget decision? |
|---|---|---|
| **A — Foundation** (this doc) | Audit (done), `CreativeAI` design (done), extract `VoiceEngine`/`AvatarEngine` from the existing composite adapter with zero behavior change, migrate `assistant-tts.js` onto `VoiceEngine` | No — safe, local, reversible, no new dependencies |
| **B — Florisyn Voice R&D** | Speaker enrollment schema, dataset registry, training pipeline scaffold, eval harness | **Yes** — needs a GPU training vendor + budget decision and a licensed/consented dataset before any training run. Scaffold (schema, interfaces, eval-metric code) can be built without GPU spend; the training run itself cannot. |
| **C — Voice quality gate** | Run Florisyn Voice against production gates (speaker similarity, intelligibility, naturalness, latency, reliability, cost, safety) vs. ElevenLabs | Depends on B existing |
| **D — Digital Clone R&D** | Avatar/digital-human model development | **Yes** — same infra/budget/licensing prerequisite as B, larger scope |
| **E — Image/Video models** | Reduce dependence on Cloudflare/external video providers | Partial — depends on which technique (fine-tune vs. from-scratch) |
| **F — Unified Creative Agent** | Lily orchestrates full campaigns across all engines | No new infra — pure orchestration work once B–E have real engines to call |

Phase A is what's actionable right now. Phases B and D each need a real, explicit infrastructure
and budget decision from Ashley before any GPU spend happens — per the directive's own Cost
Control section, that decision needs an experiment/GPU/runtime/cost/dataset/objective/success-
criterion proposal in front of her first, not a unilateral start.

## 5. Production gates (carried over from the directive, for reference)

**Voice:** speaker similarity, intelligibility, naturalness, pronunciation, latency, reliability,
cost, safety — evaluated automated + controlled human eval, against ElevenLabs as the baseline.

**Avatar/video:** identity consistency, lip-sync accuracy, temporal consistency, motion quality,
visual quality, instruction following, rendering reliability, latency, cost — against HeyGen as the
baseline.

No engine moves from ACTIVE-alongside to PRIMARY until it clears its gate. HeyGen/ElevenLabs never
get deleted — they become FALLBACK, still registered, still callable if the Florisyn engine's
health check fails.

## 6. What needs your decision before Phase B can start for real

1. **GPU training vendor + budget** — no such infrastructure exists in this environment or
   anywhere connected to it today.
2. **Dataset sourcing** — a commercially-licensed (or fully first-party, consented) speech dataset
   for voice cloning. Using scraped or research-only data would violate the directive's own §12
   licensing rule and must fail closed, not get worked around.
3. **Where training runs execute** — the directive's §14 requires GPU jobs stay isolated from
   Florisyn's transactional web infrastructure (Netlify Functions are the wrong place to run a
   training job even if credentials existed).

None of these are code problems — they're commitments only you can make. I'll present the actual
experiment/cost/runtime proposal once you've picked a direction, per the Cost Control gate.

## 7. Phase A progress log

**Pass 1 — audit + design (docs only).** This file. No provider code touched.

**Pass 2 — VoiceEngine / AvatarEngine extraction (COMPLETED).**

`netlify/functions/_shared/creative-ai/voice-engine.js` and `.../avatar-engine.js` now exist as
standalone provider-registry modules, matching `marketing-clone-providers.js`'s exact pattern
(`notLive*Provider` fail-closed default, `build*Registry({env})`, `select*Provider(criteria,
registry)`). Each wraps the existing vendor HTTP client (`marketing-elevenlabs-client.js`,
`marketing-heygen-client.js`) rather than re-implementing it — zero new vendor-calling logic.

- `marketing-clone-provider-heygen-elevenlabs.js` (Marketing Studio's clone composite) is now
  *built from* these two engines instead of importing the vendor clients directly. Its external
  contract (`PROVIDER_NAME`, `heygenElevenLabsConfigured`, `createHeygenElevenLabsCloneProvider`
  and every method on it) is byte-identical — all 18 pre-existing tests for this file pass
  unchanged, with zero test edits.
- `assistant-tts.js` (Lily/Rose/Daisy/Bud voices) now calls `VoiceEngine` instead of running its
  own independent `fetch()` to `api.elevenlabs.io` — **gap #1 from the audit is closed**: there is
  now exactly one ElevenLabs HTTP client in the codebase
  (`grep -rl "api.elevenlabs.io\|api.heygen.com" netlify/functions` returns only the two client
  files themselves). Assistant voice tuning (`stability`/`similarity_boost`/`style`/
  `use_speaker_boost`) is preserved via an optional `voiceSettings` passthrough added to
  `synthesizeElevenLabsSpeech()` — omitted entirely for every other caller, so ElevenLabs' own
  defaults keep applying unchanged for the Marketing Studio clone path.
- `marketing-elevenlabs-client.js` gained two purely additive fields on failure responses
  (`httpStatus`, and the optional `voiceSettings` request param) — no existing field removed or
  renamed, all 8 pre-existing tests for this file pass unchanged.
- `assistant-tts.js` had zero test coverage before this pass; added 8 new handler tests (missing
  key, missing text, missing persona voice, success path with voice-settings assertion, 401→502
  mapping, generic failure→503, network exception→503, OPTIONS/method handling).
- 18 new tests for the two engines themselves (fail-closed defaults, registry building, real HTTP
  delegation via mocked `fetch`).

**Verified (per §29's checklist):** assistant TTS works (8 new tests) · Lily/Rose/Daisy/Bud voice
tuning intact (voiceSettings assertion) · Marketing Clone voice/avatar/video generation unchanged
(18 pre-existing tests, zero edits, all passing) · consent/revocation untouched (no file in that
path was touched) · provider selection deterministic (`selectVoiceProvider`/`selectAvatarProvider`
return the first — and today, only — registered adapter) · unavailable providers fail closed
(`notLiveVoiceProvider`/`notLiveAvatarProvider`, both throw typed errors on every method) · no
direct vendor `fetch()` remains outside the two client files · full repo suite:
**2123/2123 passing** (2095 before this pass + 28 new).

**Step 3 (provider coupling audit) — result:** clean. The only two files that import `fetch()`
against `api.elevenlabs.io`/`api.heygen.com` are the vendor client files themselves
(`marketing-elevenlabs-client.js`, `marketing-heygen-client.js`), both now reached exclusively
through their respective engine. No further consolidation needed.

**Not done in this pass (deliberately out of scope):** the Capability Matrix (§30/Step 4) and the
Voice Experiment 001 proposal (§Step 5) are separate deliverables, not bundled into this
architecture-extraction commit so each can be reviewed on its own.
