# Florisyn Creative AI — Capability Matrix

**Research date:** 2026-08-23/24. **Status:** Step 4 deliverable — research and analysis only. No
provider code changed, no infrastructure touched, nothing connected or purchased.

## Methodology and honesty rules

- **Florisyn capabilities** are verified directly against the repository — file paths, exported
  function names, and test counts are cited inline. Nothing here credits Florisyn for a planned or
  aspirational feature; the classification legend below distinguishes what's actually live from
  what's scaffolded-but-inactive from what doesn't exist yet.
- **Competitor capabilities** come from web research conducted August 2026. Official vendor
  documentation was used where it surfaced (HeyGen's own `developers.heygen.com`/`help.heygen.com`,
  Synthesia's own legal/policy pages); most pricing and feature-comparison data came from
  third-party review/aggregator sites (clearly marked as such below each table) since a large
  fraction of current vendor pricing pages are not scrapable from this environment. Where multiple
  independent sources agreed, confidence is higher; single-source claims are flagged. **Anything I
  could not verify is marked UNVERIFIED, never guessed.**
- Every number is a snapshot as of the research date — this space moves fast; treat prices as
  approximate and re-check before any purchasing decision.

### Florisyn status legend
`LIVE` = real, working, callable today · `BUILT BUT PROVIDER/CONFIG REQUIRED` = real code exists,
inactive until credentials/env are set (matches this repo's own "NOT LIVE — PROVIDER CONNECTION
REQUIRED" convention) · `PARTIAL` = works for a subset of the stated capability · `NOT BUILT` = no
code exists · `RESEARCH ONLY` = documented as a future direction, zero implementation.

---

## 1. Competitor/provider snapshot (research findings)

### Avatar / Digital Twin

| Provider | Realism / notable capability | Multi-scene / outfit change | Pricing (aggregator-sourced, Aug 2026) | Consent/likeness policy |
|---|---|---|---|---|
| **HeyGen** | Avatar IV (Aug 2025): full-body motion, micro-expressions, natural head movement, script-driven hand gestures. Avatar V adds arbitrary outfit/setting/angle changes while preserving identity — this is the feature Florisyn's current adapter does *not* yet use (it's on the older Photo Avatar Group flow, not Avatar V). Real async job architecture with **webhooks** (`avatar_video.success` push notification, 3 retries, 5s ack window) — our adapter only polls today, doesn't register a webhook. | Yes (Avatar V) | API ~$1–4/generated minute (aggregator estimate); Creator plan $29/mo ≈ 30 min/mo of Avatar IV | Not independently verified this pass — see Synthesia below for the industry pattern |
| **Synthesia** | Strong at training-video use case; broad avatar library | Yes, multiple scenes per video | Free (10 credits/mo) → Starter $33/mo (100 credits) → Pro $49/mo (200 credits) | **Verified from Synthesia's own policy pages**: custom avatars require explicit consent via a KYC-like procedure; opt-out guarantees full deletion of data/likeness from their databases ([synthesia.io/ethics](https://www.synthesia.io/ethics), [synthesia.io/legal/ai-governance-practices](https://www.synthesia.io/legal/ai-governance-practices)) |
| **Arcads** | UGC-ad-style: 1,000+ stock AI performers, strong lip-sync + gesture/micro-expression quality, 30+ language localization with re-synced lips, actor cloning available on Pro | Product-in-hand / branded-outfit compositing | $110/mo (10 videos) → $220/mo (20 videos) → custom Pro (unlimited + API + actor cloning) | UNVERIFIED this pass |
| **Captions (Mirage)** | Wins on avatar realism + cheap multilingual editing per aggregator reviews | UNVERIFIED | Free tier → ~$24.99/mo | UNVERIFIED this pass |
| **JoggAI** | Named in the research brief; aggregator coverage was too thin to extract verified specifics this pass | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| **Creatify** | UGC-ad specialist, URL-to-video, 1,500+ avatars via API, enterprise white-label | UNVERIFIED | From ~$39/mo; Enterprise API volume pricing | UNVERIFIED this pass |

*Sources: [heygen.com/avatars/avatar-iv](https://www.heygen.com/avatars/avatar-iv), [help.heygen.com Avatar V](https://help.heygen.com/en/articles/14602974-avatar-v-is-now-available-on-heygen), [developers.heygen.com/avatar-iv](https://developers.heygen.com/avatar-iv), [help.heygen.com Usage Limits](https://developers.heygen.com/docs/usage-limits), [synthesia.io/ethics](https://www.synthesia.io/ethics), [eesel.ai Arcads pricing](https://www.eesel.ai/blog/arcads-ai-pricing), [ezugc.ai Arcads review](https://www.ezugc.ai/blog/arcads-ai), aggregator comparisons at forasoft.com, creatify.ai, ezugc.ai (Aug 2026).*

### Voice

| Provider | Realism / cloning | Latency | Pricing (Aug 2026, aggregator-sourced) |
|---|---|---|---|
| **ElevenLabs** *(Florisyn's current adapter)* | Industry realism/cloning benchmark per multiple aggregators. Professional Voice Clone (PVC) trains from ~30 min of audio for the strongest quality; Instant Voice Clone (what our adapter uses — `/v1/voices/add`) needs less. | Flash v2.5 ≈ 75ms TTFA | ≈$0.05/1K chars (Flash/Turbo) to $0.10/1K chars (Multilingual v2/v3) — i.e. **$50–100 per million characters**. Starter plan from ~$6/mo. |
| **Cartesia** | Clones from **3 seconds** of audio, unlimited instant clones on paid plans (vs. ElevenLabs' ~30s minimum and tiered voice limits) | **~40ms TTFA (Sonic-Turbo)** — roughly half ElevenLabs' latency | **$5–37 per million characters** — cheaper than ElevenLabs at every tier; Scale plan $239/mo for 8M credits |
| **OpenAI (GPT-Realtime-2)** | GPT-5-class reasoning layered on voice; conversational, not primarily a cloning product | Real-time by design | $32/1M audio input tokens, $64/1M audio output tokens; companion `GPT-Realtime-Translate` $0.034/min (70+ languages), `GPT-Realtime-Whisper` $0.017/min (speech-to-text) |
| **HeyGen (own voice)** | Bundled into HeyGen's avatar pipeline as an alternative to feeding it externally-synthesized audio | N/A | Bundled in HeyGen's own credit pricing |

**Reading this for Florisyn specifically:** Cartesia is not a drop-in ElevenLabs replacement — it wins on latency and instant-clone cost, but multiple aggregators independently rank ElevenLabs' clone *fidelity* higher, and fidelity is what matters most for a founder's cloned voice used in finished marketing video (not a real-time conversational agent). OpenAI's realtime voice line is priced and positioned for live conversation, not batch marketing-video narration — a poor fit for this use case regardless of quality.

*Sources: [murf.ai Cartesia vs ElevenLabs](https://murf.ai/blog/cartesia-vs-elevenlabs), [futureagi.com TTS 2026](https://futureagi.com/blog/elevenlabs-vs-cartesia-tts-2026/), [futureagi.com best TTS APIs](https://futureagi.com/blog/best-text-to-speech-providers-2026/), [layer3labs.io OpenAI Realtime pricing](https://www.layer3labs.io/guides/openai-realtime-api-pricing), [9to5mac OpenAI voice models](https://9to5mac.com/2026/05/07/openai-has-new-voice-models-that-reason-translate-and-transcribe-as-you-speak/).*

### Generative video (B-roll / text-to-video / image-to-video)

| Provider | Notable capability | Pricing (Aug 2026, per-second where billed that way) |
|---|---|---|
| **Google Veo 3 / 3.1** | Native audio generation alongside video; Vertex AI enterprise availability | $0.75/sec (video+audio, Veo 3, Vertex AI) · $0.50/sec (video-only) · Veo 3.1 Fast from $0.10/sec · Veo 3.1 Lite $0.05/sec (720p) — an 8-second clip with audio ≈ $6.00 |
| **Kling 3.0** | Strong multi-shot cinematic sequences with subject consistency across shots | ≈$0.10/sec (1080p, no native audio: 8 credits/sec; with audio: 12 credits/sec) |
| **Runway Gen-4 / Gen-4.5** | Gen-4 Turbo fast/cheap tier; Gen-4.5 flagship quality | Gen-4 Turbo $0.05/sec (~$0.50/10s clip) · Gen-4.5 $0.12/sec (~$1.20/10s clip) |
| **Luma Ray 3.2** | Resolution scaling is steep — 1080p costs 4x the credits of 720p | 100 credits/5s @720p vs. 400 credits/5s @1080p; ≈$3–9 for six 5-second clips |
| **ByteDance Seedance 2.5** | First major model accepting 4 input modalities simultaneously (text/image/audio/video), up to 12 reference files/request — the strongest reference-consistency story found this pass | ≈¥3.74/sec (1080p) ≈ **US$0.52/sec**; general access ≈$0.02–0.04/sec at 720p depending on tier |

**Reading this for Florisyn:** none of these are currently wired into Florisyn at all — `ai-video-provider.js` (`createNullVideoProvider`) is a real, clean registry with zero real adapters registered. This is a genuinely open integration decision, not a migration.

*Sources: [veo3ai.io API pricing](https://www.veo3ai.io/blog/veo-3-api-pricing-2026), [cometapi.com Veo 3 cost](https://www.cometapi.com/how-much-does-veo-3-cost-all-you-need-to-know/), [eesel.ai Kling pricing](https://www.eesel.ai/blog/kling-ai-pricing), [atlascloud.ai Kling vs Runway vs Luma](https://www.atlascloud.ai/blog/guides/kling-ai-vs-runway-vs-luma), [openrouter.ai Seedance 2.0](https://openrouter.ai/bytedance/seedance-2.0), [chatslide.ai Seedance 2.5](https://www.chatslide.ai/pages/seedance-2-5-api).*

### Image generation/editing

| Provider | Strength | Pricing (Aug 2026) | Commercial licensing |
|---|---|---|---|
| **FLUX.2 [pro]** (Black Forest Labs) | Aggregator consensus: best photorealism for product/portrait/architectural work, ahead of Midjourney for human subjects | $0.03/MP (pro tier) · open-weight FLUX.2 [dev] ≈$0.04/image on Replicate | `[dev]` open weights are **non-commercial** unless separately licensed — a real licensing trap if ever self-hosted |
| **Google Imagen 4** | Vertex AI integration | ≈$0.02/image | Standard commercial Vertex AI terms |
| **OpenAI gpt-image-2** | Cheapest entry point found | From $0.005/image | Standard OpenAI commercial terms |
| **Ideogram v3/4.0** | Best in-image text rendering | ≈$0.03–0.05/image | 4.0 open weights non-commercial unless licensed |
| **Adobe Firefly 4** | **Only generator found with full commercial copyright indemnification** — trained exclusively on licensed content | $5–60/mo tiers (Creative Cloud-bundled) | Cleanest commercial-safety story of any provider researched |
| **Canva Magic Studio** | Wins on integrated workflow: generation + template library + resizing + scheduling in one product, not raw model quality | $0–15/mo (Pro) | Standard Canva commercial terms |
| **Cloudflare `flux-1-schnell`** *(Florisyn's current model — see §2)* | Fast, low-step (8 steps) distilled model — this is FLUX's speed-optimized *fast* tier, not the photorealism-leading `[pro]` tier competitors use | Bundled in existing Cloudflare Workers AI spend | — |

**Reading this for Florisyn:** the model Florisyn already calls (`flux-1-schnell`) is in the same
model family aggregators rank #1 for photorealistic product photography — but it's the distilled,
low-step *speed* variant, not the `[pro]` quality tier. This is a real, cheap, low-risk lever: the
same vendor family, a different tier, no architecture change required to test.

**Real, live-tested finding (2026-08-26, shop owner's own account, via Photo Studio's "Generate a
marketing image with Lily" — the one live path that reaches this model):** three real floral
background generations were run against the actual deployed `flux-1-schnell` endpoint. The shop
owner's own verdict: **"clean but does not yet match the premium floral quality reference"** — i.e.
the images are real, usable, on-topic floral photography, not garbled or broken, but they fall
short of the luxury-editorial photorealism bar set by a ChatGPT-image-generation-quality reference
sample. This is the first *actually observed* result for this model in Florisyn's own account,
not an aggregator estimate — it corroborates the aggregator-sourced §1 finding above (fast/distilled
tier ≠ `[pro]`-tier photorealism) with a real, first-party data point, and moves the `schnell` →
`[pro]`-tier swap (§9 item 4, §12 launch-critical list) from "aggregator-recommended" to
"first-party-confirmed worth pursuing." No `[pro]`-tier sample has been generated or compared yet —
that remains the next real test before committing to the swap.

*Sources: [aiweekly.co image generators 2026](https://aiweekly.co/learning-ai/ai-applications/best-ai-image-generators), [atlascloud.ai image APIs 2026](https://www.atlascloud.ai/blog/guides/best-ai-image-generation-apis-in-2026-complete-developer-guide), [aimagicx.com Midjourney vs Flux vs Ideogram](https://www.aimagicx.com/blog/midjourney-vs-flux-vs-ideogram-image-comparison-2026), [saascrmreview.com Firefly pricing](https://saascrmreview.com/adobe-firefly-pricing/).*

### AI-content disclosure requirements (platform policy, Aug 2026)

**Verified from platform-policy aggregator coverage, cross-checked across multiple sources:**
YouTube requires labeling "realistic altered or synthetic content" depicting real people/places
(enforced since early 2025; does not affect monetization or recommendations). TikTok requires
visible labels on AI-generated visuals/audio of realistic people/scenes, and **auto-detects via
C2PA Content Credentials even without self-disclosure** — unlabeled content risks reduced
distribution or removal. Meta requires disclosure for synthetic media on political/social topics
and reserves the right to label high-risk content more prominently. **This directly affects any
Digital Ashley video Florisyn ships to these platforms** — see §5.

*Sources: [influencermarketinghub.com AI disclosure rules](https://influencermarketinghub.com/ai-disclosure-rules/), [storrito.com TikTok labeling](https://storrito.com/resources/tiktoks-2026-ai-labeling-rules-and-what-they-signal-for-platform-governance/), [virvid.ai disclosure requirements](https://virvid.ai/blog/ai-video-ad-disclosure-requirements-2026-meta-youtube-tiktok).*

---

## 2. Florisyn today — verified against the actual repository

| Module (file) | What it actually does | Status | Evidence |
|---|---|---|---|
| `creative-ai/voice-engine.js` | Standalone VoiceEngine, fail-closed registry, ElevenLabs adapter | **LIVE** (architecture) / **BUILT BUT PROVIDER/CONFIG REQUIRED** (ElevenLabs itself needs `ELEVENLABS_API_KEY`) | 10 tests, `tests/creative-ai-voice-engine.test.js` |
| `creative-ai/avatar-engine.js` | Standalone AvatarEngine, fail-closed registry, HeyGen adapter | Same pattern | 8 tests, `tests/creative-ai-avatar-engine.test.js` |
| `marketing-clone-provider-heygen-elevenlabs.js` | Composite: avatar+voice clone together, orchestrates synthesize→upload→render | **BUILT BUT PROVIDER/CONFIG REQUIRED** | 18 tests, `tests/marketing-clone-provider-heygen-elevenlabs.test.js` |
| `assistant-tts.js` | Lily/Rose/Daisy/Bud voice, via VoiceEngine | **LIVE** once `ELEVENLABS_API_KEY` set (already is, per this session) | 8 tests, `tests/assistant-tts.test.js` |
| `marketing-heygen-client.js` / `marketing-elevenlabs-client.js` | Raw vendor HTTP clients | LIVE (HeyGen video create/status: HIGH confidence, independently verified against current docs; Photo Avatar Group flow: LOWER confidence, not yet smoke-tested against a live account) | 12 + 8 tests |
| `ai-orchestrator.js` | Real plan/execute engine — turns a classified request into an ordered multi-step job, tracks partial success/failure honestly | LIVE | referenced by `tests/ai-orchestrator.test.js`, `tests/lily-ai-platform.test.js` |
| `ai-creative-engine.js` | Real structured copy generation (platform/headline/body/cta/visual-brief/hashtags) via Cloudflare; video path always returns `renderingAvailable: false` — a script/storyboard, never a rendered file, unless routed through the clone provider | LIVE (copy) / **PARTIAL** (video — script only, confirmed via `renderingAvailable: false` at `ai-creative-engine.js:126`) | `tests/ai-creative-engine.test.js` |
| `ai-image-engine.js` | **Text-to-image only.** Calls Cloudflare `@cf/black-forest-labs/flux-1-schnell` at `steps: 8` (the fast/distilled tier, not FLUX's photorealism-leading `[pro]` tier) | LIVE, but confirmed **no image-to-image, no inpainting/editing, no background replacement, no object removal/insertion** anywhere in the codebase (verified via grep across `_shared/*.js`) | `tests/ai-image-engine.test.js`; source read directly, `ai-image-engine.js:18,33-83` |
| Photo Studio background removal (`public/photo-studio.js`) | **Not an AI model at all** — a deterministic algorithm: samples the border ring to estimate background color, flood-fills connected background-colored regions, with a client-side ONNX (`@imgly/background-removal`) fallback for busy backgrounds. Runs entirely in-browser. | LIVE, and genuinely differentiated — **zero per-image cost, no image ever leaves the browser, no vendor dependency** | `public/photo-studio.js:1-571`, verified by direct read |
| `florist-ai-vision.js` | Real flower/arrangement identification from photos via Cloudflare Workers AI (2-tier fallback + captioning model), feeds Lily's recipe extraction | LIVE | `tests/florist-ai-vision.test.js`, `tests/photo-studio-ai.test.js` |
| `ai-style-memory.js` | Real Brand & Style Memory — explicit statements write immediately, repeated traits promote, rejected traits decay | LIVE | `tests/ai-style-memory.test.js`, `tests/ai-style-memory-endpoint.test.js` |
| `marketing-clone-consent.js` | Named-person consent, explicit avatar/voice permission, closed-vocabulary usage/platform scope, cascading revocation (suspends dependent avatar/voice profile rows) | LIVE | `tests/marketing-clone-consent.test.js` |
| `marketing-content-planner.js` | Monthly content planning/scheduling logic | LIVE (planning) — floral-specific recipe/mechanics/substitution intelligence is **spread across community recipe code, not consolidated into one FloralVisionEngine-adjacent module** (confirmed gap from Phase A audit, unchanged this pass) | `tests/marketing-content-planner.test.js` |
| `ai-video-provider.js` | General video-rendering provider registry | **NOT BUILT** (zero real adapters registered — `createNullVideoProvider()` is the only implementation) | Direct source read |
| `marketing-social-providers.js` | 7-platform registry: `facebook, instagram, tiktok, linkedin, pinterest, google_business, youtube` — matches this directive's platform list exactly | **BUILT BUT PROVIDER/CONFIG REQUIRED** — every platform's OAuth adapter is real machinery, zero live credentials configured for any | Direct source read, `marketing-social-providers.js:20-28` |
| `marketing-cost-config.js` + `marketing_generation_usage` | Real per-unit cost table + usage ledger (estimated vs. actual cost per generation) | LIVE, `COST_CONFIG_VERSION: "partially-verified-2026-08-23"` — not yet capturing GPU/inference-time granularity (nothing runs in-house to meter) | Direct source read |

---

## 3. Full capability matrix

| Capability | Florisyn Today | Best Competitor/Provider | Gap | Already Better | Better Through Orchestration | Proprietary R&D Required | Do Not Build | Recommended Action |
|---|---|---|---|---|---|---|---|---|
| Realistic avatar/digital twin | BUILT, provider-required (HeyGen Photo Avatar Group, lower-confidence flow) | HeyGen Avatar V, Synthesia | Florisyn's own adapter uses the *older* Photo Avatar Group flow, not Avatar V's outfit/scene flexibility | — | — | — | ✅ | Smoke-test current flow first (needed regardless); evaluate migrating to Avatar V once HeyGen relationship is validated |
| Avatar training requirements | BUILT (photo-only enrollment via HeyGen) | Same vendor | None beyond confidence gap above | — | — | — | ✅ | No action — same provider either way |
| Lip sync quality | Delegated to HeyGen (`/v3/videos`) | HeyGen/Synthesia/Arcads all strong | None Florisyn-specific | — | — | — | ✅ | Depends entirely on HeyGen — fine to depend on it |
| Multi-outfit / multi-scene avatar | NOT BUILT (adapter doesn't call Avatar V) | HeyGen Avatar V | Real, closeable gap without new R&D | — | — | — | — | Upgrade to Avatar V endpoints once current flow is verified |
| Voice cloning | LIVE via ElevenLabs (Instant Voice Clone) | ElevenLabs (fidelity), Cartesia (speed/cost) | None for fidelity; latency/cost gap vs. Cartesia | — | — | — | ✅ (see §6 Voice R&D) | Keep ElevenLabs primary; consider Cartesia as a second registered VoiceEngine adapter for cost-sensitive bulk narration |
| Emotional voice delivery / pacing / pronunciation control | PARTIAL — `synthesizeElevenLabsSpeech` now accepts `voiceSettings` (stability/similarity/style) but nothing in Florisyn's own UI exposes per-generation control | ElevenLabs v3 supports inline emotion tags (`[whispers]`, `[sarcastically]`) — not yet used by Florisyn's adapter (still on `eleven_multilingual_v2`) | Real, cheap gap — no new vendor needed | — | ✅ | — | — | Add `eleven_v3` as an opt-in model + expose emotion-tag scripting in the clone preview UI |
| Multilingual voice | BUILT, provider-required — ElevenLabs supports it, Florisyn's adapter passes `modelId` through but no UI exposes language selection | ElevenLabs (dozens of languages), Arcads (30+ with lip re-sync) | UI gap, not a provider gap | — | ✅ | — | — | Surface language selection in the enrollment/preview UI |
| Text-to-image | LIVE — Cloudflare `flux-1-schnell` | FLUX.2 [pro], Firefly 4 (commercial-safety) | Model *tier* gap, not model *family* gap | — | ✅ | — | — | Test `flux-1-schnell` → `flux.2-pro` swap; same vendor family |
| Image-to-image / conversational editing ("change roses to peonies", "remove the vase") | **NOT BUILT** — zero image-to-image anywhere in the codebase | FLUX.2, Firefly, Ideogram all support this | Real, substantial gap | — | — | — | — | Real build item — see §7 top gaps |
| Background replacement (product photo) | LIVE, but via a **deterministic browser algorithm**, not an AI model (`photo-studio.js`) | Every competitor uses a cloud model, per-image cost | **None — Florisyn is cheaper and faster for the common case** | ✅ | — | — | — | Keep as-is; this is a real cost/privacy advantage, don't replace it with a paid API for the common case |
| Object removal/insertion | NOT BUILT | FLUX.2, Firefly | Real gap | — | — | — | — | Roadmap item, not urgent — bundle with image-to-image work |
| Text-to-video / B-roll | NOT BUILT (`ai-video-provider.js` has zero adapters) | Veo 3.1, Kling 3.0, Seedance 2.5, Runway | Real, open integration decision | — | — | — | — | See §8 provider stack recommendation |
| Product-photo → video (image-to-video) | NOT BUILT | Seedance 2.5 (up to 12 reference files, 4 modalities) — strongest reference-consistency story found | Real gap | — | — | — | — | High-value: lets a florist turn an existing arrangement photo into a Reel without a video shoot |
| Captions | NOT BUILT in Florisyn's own pipeline | Every competitor bundles this | Real gap, but low-complexity | — | ✅ | — | — | Cheapest possible build: Whisper-class transcription + burned-in captions is a solved, low-cost problem — don't overinvest here |
| Aspect-ratio adaptation / platform reformatting | PARTIAL — `aspectRatio` param exists on the HeyGen adapter (`createHeygenVideo`), no automated multi-platform repackaging pipeline | Canva Magic Studio (resize is a core feature), most avatar vendors | Real gap | — | ✅ | — | — | Build a thin reformatting step once one real video source exists — no new vendor needed |
| Flower/arrangement recognition | LIVE (`florist-ai-vision.js`) | No competitor researched offers florist-specific recognition — general vision models don't know floral taxonomy | — | ✅ | — | — | — | Keep extending — this is a real moat |
| Floral recipe/mechanics/substitution intelligence | PARTIAL — logic exists but scattered across community recipe code, not a consolidated engine | No competitor has this at all | — | ✅ | — | — | — | Consolidate into a named module — pure refactor, no new capability needed to still be ahead |
| Brand & Style Memory | LIVE (`ai-style-memory.js`) — explicit/promoted/decayed preference learning | Generic tools have no equivalent; Canva has saved brand kits (static, not learned) | — | ✅ | — | — | — | Keep extending; this is architecturally unique to Florisyn today |
| Business-context-aware generation (products, inventory, customers, calendar) | PARTIAL — Lily's business context exists (`ai-context.js` per earlier session work) but isn't yet threaded into every generation call (image prompts, video scripts) uniformly | No competitor has this — HeyGen/ElevenLabs/Canva know nothing about a specific florist's business | — | — | ✅ (this is the core orchestration thesis) | — | — | This is THE highest-leverage differentiator — see §9 |
| Consent/likeness/revocation | LIVE, real cascading revocation | Synthesia has an equivalent verified system; most avatar vendors' policies were unverifiable this pass | — | ✅ (verified equal-or-better than the one competitor with a verifiable policy) | — | — | — | — | Keep as-is |
| Cost tracking | LIVE (estimated + actual, not yet GPU-granular) | N/A — internal to Florisyn | — | ✅ | — | — | — | Extend only once anything runs in-house to meter |
| Publishing across 7 platforms | BUILT, provider-required (real OAuth machinery, zero live credentials) | Buffer/Predis-class tools, all live today | Config gap, not architecture gap | — | — | — | — | Configure real OAuth credentials — separate workstream from Creative AI |
| Webhook-driven async avatar rendering | NOT BUILT — Florisyn's HeyGen adapter only polls (`getHeygenVideoStatus`), doesn't register HeyGen's own webhook | HeyGen supports `avatar_video.success` push webhooks natively | Real, cheap gap | — | ✅ | — | — | Small, high-value fix: register a webhook instead of polling — less latency, fewer wasted requests |

---

## 4. Digital Ashley / owner-clone standard — evaluated

**Requirement:** ~60-second, realistic-enough-for-regular-social-marketing founder video: persistent
likeness, optional cloned voice, natural lip sync/expressions/gestures, multiple outfits/scenes,
brand/product integration, captions, and platform-ready output for Facebook, Instagram/Reels,
TikTok, LinkedIn, Pinterest, Google Business Profile (where video is supported), YouTube/Shorts.

**Strongest combination available today, unconnected:** **HeyGen Avatar V** (outfit/scene
flexibility, the specific gap Florisyn's current lower-tier flow doesn't cover) **+ ElevenLabs**
(voice fidelity) — this is a *deeper* integration of the same two vendors already chosen, not a new
vendor relationship. **Fallback:** current Photo Avatar Group flow (already built, lower fidelity,
already smoke-test-ready) + ElevenLabs — degrades gracefully to what exists today rather than an
outage.

**What's real and unsolved regardless of provider:**
1. **Platform disclosure labeling.** TikTok auto-detects via C2PA regardless of self-disclosure; a
   Digital Ashley video published without a label risks reduced distribution or removal on TikTok
   specifically, and a YouTube-policy violation if unlabeled. **This needs to be a real, enforced
   step in Florisyn's publishing pipeline before Digital Ashley content goes out**, not an
   afterthought — a genuine finding from this research pass, not something the earlier Phase A
   audit surfaced.
2. **No aspect-ratio/caption pipeline exists yet** (§3) — a rendered HeyGen video isn't
   automatically Reels-ready, TikTok-ready, and LinkedIn-ready today; that reformatting step has to
   be built regardless of which avatar vendor is used.
3. **Google Business Profile** video support is limited/platform-specific — UNVERIFIED whether
   Florisyn's target format would even be accepted there; flag for direct verification against
   Google Business Profile's own current posting requirements before promising this platform.

**This is a build-the-pipeline-around-existing-providers problem, not a proprietary-model
problem.** Nothing about Digital Ashley requires Florisyn to own an avatar or voice model — it
requires orchestration Florisyn hasn't built yet (captioning, reformatting, disclosure-labeling,
Avatar V migration).

---

## 5. Voice R&D decision

**What Florisyn currently gets from ElevenLabs:** industry-benchmark cloning fidelity (per multiple
independent aggregator rankings), Instant Voice Clone from real consented audio, synthesis at
~75ms latency (Flash) — already live for both the Marketing Studio clone path and the Lily/Rose/
Daisy/Bud assistant voices (Phase A Step 2, this session).

**What VoiceEngine adds:** nothing about voice *quality* — it's a pure architecture win (one HTTP
client instead of two, a real extension point for a second adapter). Quality is 100% ElevenLabs'
today.

**What a competitor (Cartesia) can do better today:** ~2x lower latency, meaningfully cheaper at
volume ($5–37/M chars vs. $50–100/M chars), 3-second instant clones vs. ElevenLabs' ~30 seconds.
None of this requires Florisyn to train anything — it requires registering a second `VoiceEngine`
adapter, a pure engineering task.

**What would actually require training a Florisyn-owned model:** florist-specific pronunciation
(botanical Latin names, wholesale trade terms ElevenLabs' general model may mispronounce),
delivery style tuned specifically for short-form marketing narration, and eventually true model
ownership (Level 3 per the master plan's ownership scale). None of these are validated needs yet —
no evidence has been gathered that ElevenLabs actually mispronounces florist terminology badly
enough to matter; this would need to be measured first, not assumed.

**Dataset/GPU/complexity reality (unchanged from the Phase A doc, restated for this decision):** a
real Level-3 voice model needs a licensed or fully first-party consented speech dataset, GPU
training infrastructure with a real budget, and typically weeks-to-months of ML engineering even
once that infrastructure exists. **No such infrastructure exists in this environment or anywhere
connected to it.**

### Recommendation: **PROVIDER ORCHESTRATION**

Not `BUILD PROPRIETARY VOICE`, not `HYBRID R&D`, not `DEFER` — the honest middle ground the
directive's four options don't quite name is "add a second provider and richer control over the one
we have," which is closest to `PROVIDER ORCHESTRATION`. Reasoning:

- ElevenLabs' quality is not a proven bottleneck — no measured evidence Florisyn's actual output is
  failing florists on pronunciation, naturalness, or delivery today.
- The two real, cheap wins (Cartesia as a cost/latency fallback adapter; `eleven_v3` + emotion tags
  for richer delivery) require zero GPU spend, zero dataset licensing, and are ordinary engineering
  work already scoped in §3.
- `DEFER` would be too passive — there are real, low-cost improvements available right now that
  `DEFER` would leave on the table.
- `BUILD PROPRIETARY VOICE` or `HYBRID R&D` are premature: no measured quality gap justifies the
  GPU/dataset/licensing commitment yet, and jumping straight to training would violate the master
  plan's own Cost Control gate (no GPU spend without a presented, approved experiment).

**If this changes:** if florist feedback or a real quality audit surfaces a specific, measurable
ElevenLabs shortfall (e.g., botanical terminology mispronunciation at a rate that matters), that
becomes the trigger to revisit `HYBRID R&D` — fine-tuning on top of an open model rather than
training from scratch, which is a meaningfully smaller GPU/dataset commitment than full Level-3
ownership.

---

## 6. Marketing Studio advantage — "Lily, handle my marketing this month"

**Can Florisyn's existing architecture beat Canva + HeyGen + ElevenLabs + Buffer + Predis + separate
analytics as five disconnected products?** Yes, architecturally — and this is where the Phase A
finding matters most: **Florisyn already has the pieces a stitched-together stack structurally
cannot have**, because those tools don't share a florist's business data with each other. Brand
Brain, product/inventory data, prior campaign performance, and floral intelligence all living in one
system is not something Canva+HeyGen+Buffer can replicate by definition — they're separate
companies with separate data.

**What's real today vs. what the full "30 images, 30 Reels, 30 avatar videos" vision needs:**

| Piece | Status |
|---|---|
| Strategy / monthly planning | LIVE (`marketing-content-planner.js`) |
| Brand Brain-aware copy | LIVE (`ai-creative-engine.js` + `ai-style-memory.js`) |
| Images | LIVE for text-to-image; NOT BUILT for on-brand conversational editing |
| Reels/short-form video | NOT BUILT (no video-engine adapter registered) |
| Avatar/founder videos | BUILT, provider-required (HeyGen), lower-confidence flow, no Avatar V |
| Platform adaptation (7 platforms) | BUILT, provider-required — real registry, zero live OAuth credentials |
| Approval workflow | LIVE (existing content-approval gate, unchanged this pass) |
| Scheduling/publishing | LIVE machinery, honestly fails every attempt today (no live social adapter) |
| Analytics/learning | LIVE machinery over honestly-empty data until real publishing happens |

**Verdict:** the *orchestration substrate* is real and ahead of what a stitched-together stack could
ever offer. The *content-generation surface* (video, image editing) has genuine gaps that need
either new provider integrations (video) or a provider-tier upgrade (image) — not new proprietary
models.

---

## 7. Top 10 Florisyn advantages (with evidence)

1. **Photo Studio's algorithmic background removal** — zero cost, zero vendor dependency, runs
   entirely client-side. Every researched competitor charges per-image for this. (`photo-studio.js`)
2. **Floral flower/arrangement recognition** (`florist-ai-vision.js`) — no researched competitor has
   florist-specific vision at all.
3. **Brand & Style Memory** (`ai-style-memory.js`) — learned, correctable, resettable preferences;
   Canva's "brand kit" is static by comparison.
4. **Consent/revocation cascade** (`marketing-clone-consent.js`) — verified equal-or-better than the
   one competitor (Synthesia) whose policy was independently verifiable this pass.
5. **Provider-registry architecture itself** — `selectVoiceProvider`/`selectAvatarProvider`/
   `selectCloneProvider` all fail closed and share one pattern; swapping or adding a vendor is a new
   adapter file, never a rewrite. This is exactly the flexibility the directive's §8 asked for, and
   it already exists.
6. **Real cost ledger** (`marketing_generation_usage`) tracking estimated vs. actual cost per
   generation — most competitors' own dashboards don't expose this granularity to their customers.
7. **One shared image engine** used by Marketing Studio, Photo Studio, Website Builder X, and Lily —
   competitors' generation tools are siloed per product even within one vendor's own suite.
8. **Honest-failure design throughout** — every not-live path returns a typed, labeled error rather
   than a fake success (`notLiveVoiceProvider`, `notLiveAvatarProvider`, `notLiveCloneProvider`,
   `renderingAvailable: false`). This is a real trust asset once florists start relying on it.
9. **7-platform registry already matches the exact platform list this directive named** — the
   integration surface is already scoped correctly, just not yet credentialed.
10. **Business-context orchestration potential** — no researched competitor can access a specific
    florist's product catalog, inventory, and customer history the way Lily structurally can.

## 8. Top 10 real gaps (no sugarcoating)

1. **No image-to-image / conversational editing at all.** Every serious image competitor
   (FLUX.2, Firefly, Ideogram) has this; Florisyn has zero.
2. **No general video engine connected** — `ai-video-provider.js` is an empty registry.
3. **Avatar flow uses HeyGen's lower-fidelity Photo Avatar Group path, not Avatar V** — the
   multi-outfit/scene capability the Digital Ashley standard needs isn't wired.
4. **Photo Avatar Group field names are still LOWER confidence, unverified against a live HeyGen
   account** — this has been flagged since Stage G and remains unresolved.
5. **No aspect-ratio/reformatting pipeline** — a rendered video isn't automatically multi-platform
   ready.
6. **No caption-burning pipeline** for any generated video.
7. **No AI-content disclosure/labeling step** anywhere in the publishing pipeline — a real
   compliance gap this research pass specifically surfaced (TikTok auto-detects and penalizes
   unlabeled synthetic content regardless of self-disclosure).
8. **Image model is on the fast/distilled tier**, not the photorealism-leading tier of the same
   model family Florisyn already pays for access to.
9. **Zero live social-platform OAuth credentials** — the entire publishing layer is honest
   machinery with nothing to actually publish to yet.
10. **Floral recipe/mechanics/substitution logic is scattered**, not consolidated into a queryable
    module the way flower-vision is — a real inconsistency in an otherwise-strong area.

## 9. Top 10 highest-value improvements (ranked: value / effort / cost / defensibility)

1. **Register HeyGen's webhook instead of polling.** Trivial engineering, real latency/reliability
   win, zero new vendor relationship.
2. **AI-content disclosure labeling step in the publishing pipeline.** Real compliance risk,
   moderate effort, high defensibility (protects every future Digital Ashley post).
3. **Smoke-test the Photo Avatar Group flow against a live HeyGen account.** Already flagged as
   needed; resolves the single lowest-confidence piece of already-built code.
4. **Swap `flux-1-schnell` → `flux.2-pro` for image generation.** Same vendor, same integration,
   likely meaningfully better product photography.
5. **Consolidate floral recipe/mechanics intelligence into one named module** alongside
   `florist-ai-vision.js`. Pure refactor, strengthens an already-unique advantage.
6. **Build image-to-image / conversational editing.** Real gap, real effort — highest customer
   value on this list but the most engineering.
7. **Migrate avatar flow to HeyGen Avatar V** for multi-outfit/scene support. Same vendor, real
   effort, directly closes the Digital Ashley gap.
8. **Register a second VoiceEngine adapter (Cartesia)** for cost/latency-sensitive bulk use, keeping
   ElevenLabs primary for fidelity-critical clone work.
9. **Add a video-reformatting/aspect-ratio step** once any real video source exists (avatar or
   general).
10. **Connect one general video provider** (Seedance 2.5, given its reference-consistency strength
    for product-photo-driven B-roll) behind the existing `ai-video-provider.js` registry — the
    architecture is already built for exactly this.

---

## 10. Provider stack recommendation (recommendation only — nothing connected)

| Role | Primary | Backup |
|---|---|---|
| Avatar | HeyGen (upgrade path: Avatar V) | Synthesia (verified consent/policy story; would need a new adapter) |
| Voice | ElevenLabs (fidelity) | Cartesia (cost/latency; new adapter, same VoiceEngine pattern) |
| Generative video (general/B-roll) | Seedance 2.5 (reference-consistency strength for product-photo-driven content) | Kling 3.0 (cinematic multi-shot consistency) |
| Image | Cloudflare FLUX (upgrade `schnell`→`pro` tier) | Adobe Firefly (commercial-indemnification story, worth it for anything customer-facing/paid-ad-adjacent) |
| When to use Florisyn's own engines | Copy (`ai-creative-engine.js`), flower/arrangement recognition (`florist-ai-vision.js`), background removal (`photo-studio.js`), brand memory (`ai-style-memory.js`) — all already ahead or cost-free, no vendor needed | — |

## 11. Build vs. buy vs. orchestrate — explicit per capability

| Capability | Decision |
|---|---|
| Avatar rendering | **BUY** (HeyGen) |
| Voice synthesis/cloning | **BUY** (ElevenLabs, + Cartesia as second adapter) |
| Generative B-roll video | **BUY** (Seedance/Kling) |
| Base image generation | **BUY** (Cloudflare/FLUX, tier upgrade) |
| Image-to-image editing | **BUY** (integrate FLUX.2's editing endpoints — not a build) |
| Background removal (simple case) | **BUILD** — already built, already better, keep it |
| Flower/arrangement recognition | **BUILD** — already built, real moat, keep extending |
| Brand & Style Memory | **BUILD** — already built, real moat, keep extending |
| Business-context orchestration (Lily) | **BUILD** — the actual differentiator; no vendor sells this |
| Disclosure labeling / compliance pipeline | **BUILD** — thin, Florisyn-specific logic, no vendor to buy |
| Reformatting/captions pipeline | **BUILD** — thin orchestration layer over generated output |
| Foundation voice/avatar/video/image models | **DO NOT BUILD** at Level 3+ today — no measured quality gap justifies it (see §5) |

## 12. 12-month Creative AI roadmap

**Launch-critical (next 1–2 engineering passes, no new infra/spend):**
HeyGen webhook migration · disclosure-labeling step · Photo Avatar Group live smoke test ·
`flux-1-schnell`→`flux.2-pro` swap · floral-intelligence consolidation.

**Near-term (new provider integrations, ordinary spend, no GPU/training):**
Image-to-image/editing · Avatar V migration · one general video provider connected ·
reformatting/captioning pipeline · Cartesia as second VoiceEngine adapter.

**Experimental R&D (requires an owner-approved proposal before any spend, per §5):**
Measure whether ElevenLabs actually underperforms on florist-specific terminology/delivery before
deciding whether fine-tuning (not from-scratch training) is worth scoping as a real experiment.

**Kept explicitly separate:** none of the above requires GPU training infrastructure, dataset
licensing, or a proprietary-model commitment. The 12-month roadmap is entirely orchestration and
provider-tier work.

---

## Owner decisions required

1. **Video provider selection** — Seedance vs. Kling vs. Veo vs. Runway for the first general video
   integration. This is a real spend decision (per-second billing, ongoing) even though it's not a
   GPU/training decision — worth your sign-off before any credentials get requested.
2. **Image-tier upgrade** (`flux-1-schnell` → `flux.2-pro`) — small, ongoing per-image cost increase;
   worth a quick approval since it touches every image generation call across Marketing Studio,
   Photo Studio, and Website Builder X.
3. **HeyGen Avatar V vs. staying on Photo Avatar Group** — Avatar V likely costs more per generation
   than the current flow; worth confirming before committing engineering time to the migration.

No GPU/dataset/proprietary-model decision is being asked for in this pass — per §5, the evidence
doesn't support one yet.
