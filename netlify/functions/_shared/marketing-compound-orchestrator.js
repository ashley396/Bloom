/**
 * Lily compound-request orchestration (Priority 1 of the "as far as
 * technically possible" pass). Turns ONE compound sentence — "Create a
 * Reel for this week's wedding bouquet using flowers I actually have,
 * make versions for Instagram and TikTok, write the captions in my
 * style, schedule them for Friday evening, and don't spend over $2" —
 * into a real, persisted, multi-step execution plan and runs it.
 *
 * Durable model: reuses `ai_execution_jobs` (the SAME table/shape
 * ai-orchestrator.js's planJob/runJob already use for single-domain
 * requests) rather than a second job table — job_type
 * 'marketing_compound' distinguishes these from campaign/create/video/
 * photo jobs, but the persistence, per-step status vocabulary
 * (planned/running/completed/failed), and job-level status summary
 * (completed/partially_completed/failed) are identical, so any future
 * "show me my recent AI jobs" UI already works for these too.
 *
 * Reuses rather than duplicates:
 *   - marketing-inventory-grounding.js  — real inventory, never invented
 *   - ai-creative-engine.js             — generateSocialPost/generateVideoConcept
 *   - ai-image-engine.js                — generateImage/buildImagePrompt
 *   - creative-ai/disclosure-policy.js  — computeDisclosureFields (Blocker 1's fix)
 *   - creative-ai/media-transform-executor.js — real per-platform image reframing
 *   - marketing-video-render-engine.js  — the video-render PLAN (no live provider)
 *   - marketing-schedule-content.js     — the same scheduling logic the
 *                                          schedule_content_item action uses
 *   - marketing-cost-config.js          — the one cost-per-unit source of truth
 *   - shop-time.js                      — shopDateStr (for the deterministic
 *                                          schedule-hint resolver below)
 *
 * Human-approval boundary: this orchestrator NEVER calls approve_content
 * or enqueue_publish itself. Every content item it creates lands in
 * status 'idea'/'draft' — generation is never approval (Section 8 of the
 * launch audit already established this contract; this module inherits
 * it rather than re-deciding it).
 */

import { runCloudflareGenerate } from "../ai-assistant.js";
import { loadGroundedInventory, buildInventoryGroundingBrief } from "./marketing-inventory-grounding.js";
import { generateSocialPost, generateVideoConcept, persistGeneratedAsset } from "./ai-creative-engine.js";
import { generateImage, buildImagePrompt } from "./ai-image-engine.js";
import { evaluateMarketingOutput } from "./marketing-content-revision.js";
import { computeDisclosureFields } from "./creative-ai/disclosure-policy.js";
import { transformMasterImageForPlatforms } from "./creative-ai/media-transform-executor.js";
import { planVideoRender } from "./marketing-video-render-engine.js";
import { scheduleContentItemVariants } from "./marketing-schedule-content.js";
import { estimateCostCents } from "./marketing-cost-config.js";
import { checkMonthlyBudgetForRequest } from "./marketing-budget-guard.js";
import { shopDateStr } from "./shop-time.js";
import { SUPPORTED_PLATFORMS } from "./marketing-social-providers.js";
import { buildConfiguredCloneProviderRegistry, selectCloneProvider, notLiveCloneProvider } from "./marketing-clone-providers.js";
import { uploadClonedVoiceAudio } from "./website-media.js";
import { recordCloneVideoJob } from "./creative-ai/clone-video-jobs.js";
import { loadBrandBrain, buildBrandSummary } from "./marketing-brand-brain.js";
import { loadStyleMemory, buildStyleSummary as buildVisualStyleSummary } from "./ai-style-memory.js";
import { loadCustomerAudienceSummary, buildAudienceGroundingBrief } from "./customer-audience-grounding.js";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TIME_OF_DAY_DEFAULTS = { morning: "09:00", afternoon: "14:00", evening: "18:00", night: "20:00" };

// ── 1. Structured extraction (the ONE LLM call that decomposes the
// compound sentence) ────────────────────────────────────────────────────

const EXTRACT_TASK = `Read this florist's compound marketing request and extract exactly what they're asking Florisyn's AI to do — every clause, not just the first one. Never invent anything not actually stated or clearly implied.

Return JSON:
- wants_image: boolean — an image/photo post is requested.
- wants_video: boolean — a Reel/short/video is requested.
- wants_digital_twin: boolean — true ONLY if they explicitly want THEIR OWN likeness/avatar/voice in the video (not just "a video").
- platforms: array from [facebook,instagram,tiktok,linkedin,pinterest,google_business,youtube] — every platform actually named. Empty array if none named.
- occasion: string|null — the theme/product/occasion (e.g. "wedding bouquet", "Mother's Day").
- inventory_grounded: boolean — true if they reference using real/actual/current/on-hand flowers or stock ("flowers I have", "what I need to move", "using our current inventory").
- audience_grounded: boolean — true if they reference targeting, reaching, or messaging a specific real customer group ("my subscribers", "loyal customers", "people who haven't ordered in a while", "target my VIPs", "customers with birthdays this month").
- budget_dollars: number|null — a dollar budget if one is explicitly stated ("$2", "under $50"), else null. Never guess a number that wasn't stated.
- schedule_relative_day: string|null — today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday, or null if no day was mentioned.
- schedule_time_of_day: string|null — morning|afternoon|evening|night|"HH:MM", or null if no time was mentioned.
- summary: one sentence describing the whole request.`;

const EXTRACT_SCHEMA = {
  wants_image: "boolean",
  wants_video: "boolean",
  wants_digital_twin: "boolean",
  platforms: ["string"],
  occasion: "string|null",
  inventory_grounded: "boolean",
  audience_grounded: "boolean",
  budget_dollars: "number|null",
  schedule_relative_day: "string|null",
  schedule_time_of_day: "string|null",
  summary: "string"
};

/** Returns null (never throws) on any provider failure — a caller that
 * gets null must fail the compound request honestly, never guess a plan. */
export async function extractCompoundMarketingRequest(message) {
  const text = String(message || "").trim();
  if (!text) return null;
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona: "Lily",
      task: EXTRACT_TASK,
      input: { message: text },
      schema: EXTRACT_SCHEMA,
      max_tokens: 500
    });
    const raw = result?.result;
    if (!raw) return null;
    const platforms = Array.isArray(raw.platforms)
      ? [...new Set(raw.platforms.map((p) => String(p || "").toLowerCase().trim()).filter((p) => SUPPORTED_PLATFORMS.includes(p)))]
      : [];
    return {
      wantsImage: Boolean(raw.wants_image),
      wantsVideo: Boolean(raw.wants_video),
      wantsDigitalTwin: Boolean(raw.wants_digital_twin),
      platforms,
      occasion: raw.occasion ? String(raw.occasion).trim().slice(0, 200) : null,
      inventoryGrounded: Boolean(raw.inventory_grounded),
      audienceGrounded: Boolean(raw.audience_grounded),
      budgetCents: typeof raw.budget_dollars === "number" && raw.budget_dollars > 0 ? Math.round(raw.budget_dollars * 100) : null,
      scheduleRelativeDay: raw.schedule_relative_day ? String(raw.schedule_relative_day).toLowerCase().trim() : null,
      scheduleTimeOfDay: raw.schedule_time_of_day ? String(raw.schedule_time_of_day).toLowerCase().trim() : null,
      summary: raw.summary ? String(raw.summary).trim().slice(0, 300) : text.slice(0, 300)
    };
  } catch {
    return null;
  }
}

// ── 2. Deterministic schedule-hint resolution (no LLM — never lets a
// model hallucinate an absolute date) ───────────────────────────────────

/** Turns {relativeDay, timeOfDay} (from extraction) into a real
 * "YYYY-MM-DDTHH:mm" LOCAL string for shopLocalDateTimeToUtcIso() to
 * convert. Pure date arithmetic anchored on the shop's own current local
 * calendar day (shopDateStr) — the model never computes or states a real
 * date itself, only a weekday/time-of-day hint. Returns null when neither
 * hint was given (nothing to schedule). */
export function resolveScheduleHint({ relativeDay = null, timeOfDay = null } = {}, { timezone, now = new Date() } = {}) {
  if (!relativeDay && !timeOfDay) return null;

  const todayStr = shopDateStr(timezone, now);
  const [y, m, d] = todayStr.split("-").map(Number);
  // UTC-noon anchor for pure calendar-date arithmetic — same DST-transition
  // -safe pattern shopDateStrDaysAgo() already uses in shop-time.js.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  const todayWeekday = anchor.getUTCDay();

  const rd = String(relativeDay || "").toLowerCase();
  let dayOffset = 0;
  if (rd === "tomorrow") dayOffset = 1;
  else if (rd && rd !== "today") {
    const targetWeekday = WEEKDAYS.indexOf(rd);
    if (targetWeekday !== -1) {
      // "this <weekday>" said on that same weekday means today (offset 0),
      // not seven days later — the modulo below already yields 0 in that
      // case, so no special-casing is needed.
      dayOffset = (targetWeekday - todayWeekday + 7) % 7;
    }
  }
  anchor.setUTCDate(anchor.getUTCDate() + dayOffset);
  const targetDateStr = anchor.toISOString().slice(0, 10);

  const tod = String(timeOfDay || "").toLowerCase().trim();
  let time = "09:00";
  if (/^\d{1,2}:\d{2}$/.test(tod)) {
    const [h, mi] = tod.split(":");
    time = `${h.padStart(2, "0")}:${mi}`;
  } else if (TIME_OF_DAY_DEFAULTS[tod]) {
    time = TIME_OF_DAY_DEFAULTS[tod];
  }

  return `${targetDateStr}T${time}`;
}

// ── 3. Cost estimation across the whole planned request, BEFORE
// anything runs (Priority 8: a stated budget is a real execution
// constraint, never decorative prompt text) ────────────────────────────

/** Sums the real per-unit estimate (marketing-cost-config.js — the one
 * cost source, never re-priced here) for every generation step this plan
 * would run. Video render/Digital Twin steps are NOT included in the
 * dollar estimate when they can't actually execute (no live provider) —
 * their cost is genuinely zero because nothing gets billed; the plan
 * still reports them as blocked, just not as a phantom cost. */
export function estimateCompoundPlanCostCents({ wantsImage, wantsVideo, platformCount = 1 }) {
  let cents = 0;
  if (wantsImage) cents += estimateCostCents({ purpose: "image", unitType: "image", units: 1 }) || 0;
  if (wantsVideo) cents += estimateCostCents({ purpose: "copy", unitType: "request", units: 1 }) || 0; // the video CONCEPT (script/storyboard) is a real copy-generation spend even though rendering itself is blocked
  // One caption-generation call per requested platform.
  cents += (estimateCostCents({ purpose: "copy", unitType: "request", units: 1 }) || 0) * Math.max(1, platformCount);
  return cents;
}

// ── 4. Digital Twin availability check (real, tenant-scoped — never
// invents a ready avatar/voice profile) ─────────────────────────────────

export async function checkDigitalTwinAvailability(client, shopId) {
  const consentResult = await client
    .from("marketing_clone_consent")
    .select("id,avatar_permission,voice_permission,revoked_at")
    .eq("shop_id", shopId)
    .is("revoked_at", null)
    .eq("avatar_permission", true)
    .eq("voice_permission", true)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (consentResult.error || !consentResult.data) {
    return { available: false, reason: "No active Digital Twin consent (avatar + voice) found for this shop." };
  }
  const consentId = consentResult.data.id;

  const [avatarResult, voiceResult] = await Promise.all([
    client.from("marketing_avatar_profiles").select("id,status").eq("shop_id", shopId).eq("consent_id", consentId).eq("status", "ready").limit(1).maybeSingle(),
    client.from("marketing_voice_profiles").select("id,status").eq("shop_id", shopId).eq("consent_id", consentId).eq("status", "ready").limit(1).maybeSingle()
  ]);
  if (!avatarResult.data || !voiceResult.data) {
    return { available: false, reason: "Consent exists, but no READY avatar+voice profile pair was found — complete AI Clone enrollment first." };
  }
  return { available: true, consentId, avatarProfileId: avatarResult.data.id, voiceProfileId: voiceResult.data.id };
}

// ── 5. Plan + run ────────────────────────────────────────────────────────

/** Pure planning — mirrors ai-orchestrator.js's planJob() shape exactly
 * (id/tool/label/optional) so a future shared "show me the plan" UI
 * doesn't need two rendering paths. */
export function planCompoundRequest(extracted) {
  const steps = [];
  const platforms = extracted.platforms.length ? extracted.platforms : ["facebook"];

  steps.push({ id: "budget_check", tool: "compound.checkBudget", label: "Check estimated cost against budget", optional: false });
  if (extracted.inventoryGrounded) {
    steps.push({ id: "inventory_lookup", tool: "compound.lookupInventory", label: "Look up real current inventory", optional: false });
  }
  if (extracted.audienceGrounded) {
    steps.push({ id: "audience_lookup", tool: "compound.lookupAudience", label: "Look up real audience/subscriber counts", optional: false });
  }
  if (extracted.wantsDigitalTwin) {
    steps.push({ id: "digital_twin_check", tool: "compound.checkDigitalTwin", label: "Check Digital Twin availability", optional: false });
  }
  if (extracted.wantsImage) {
    steps.push({ id: "generate_image", tool: "compound.generateImage", label: "Generate the master image", optional: false });
  }
  if (extracted.wantsVideo) {
    steps.push({ id: "generate_video_concept", tool: "compound.generateVideoConcept", label: "Write the video script & storyboard", optional: false });
    steps.push({ id: "plan_video_render", tool: "compound.planVideoRender", label: "Build the video render plan", optional: true });
    if (extracted.wantsDigitalTwin) {
      // Digital Twin completion pass: availability alone (checkDigitalTwin)
      // used to be a dead end — ctx.digitalTwin was set and never read
      // again anywhere in this file. This is the real step that actually
      // uses it: kicks off the real HeyGen/ElevenLabs render the moment a
      // shop has a ready avatar+voice pair, using the script this SAME
      // request just wrote (never a second, disconnected script).
      steps.push({ id: "request_digital_twin_render", tool: "compound.requestDigitalTwinRender", label: "Render the Digital Twin video", optional: true });
    }
  }
  steps.push({ id: "create_content_item", tool: "compound.createContentItem", label: `Create the content item + platform variants (${platforms.join(", ")})`, optional: false });
  if (extracted.wantsImage) {
    steps.push({ id: "transform_platforms", tool: "compound.transformForPlatforms", label: "Create platform-specific image variants", optional: true });
  }
  if (extracted.scheduleRelativeDay || extracted.scheduleTimeOfDay) {
    steps.push({ id: "schedule", tool: "compound.schedule", label: "Set the review schedule", optional: true });
  }
  return steps;
}

function summarizeStatus(plan) {
  const required = plan.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.status === "completed");
  const requiredFailed = required.filter((s) => s.status === "failed" || s.status === "blocked");
  if (requiredFailed.length === required.length && required.length > 0) return "failed";
  if (requiredDone.length === required.length) return "completed";
  if (requiredDone.length > 0) return "partially_completed";
  return "failed";
}

/**
 * Executes one step. Every branch either does something real or reports
 * an honest blocked/failed state — never a fake success. `ctx` accumulates
 * results across steps (masterAssetId/masterImageUrl/contentItemId/...),
 * matching ai-orchestrator.js's runStep's own ctx-accumulation pattern.
 */
/**
 * Priority F wiring: same read-time gap closed in marketing-studio.js's
 * classic generate_content action, applied to the compound-request path —
 * buildBrandSummary() existed but was never handed to a real generation
 * call here either. Memoized on ctx so a multi-step compound request
 * (image + video concept, say) only ever loads Brand Brain once, not once
 * per generation step.
 */
async function getBrandVoiceSummary(client, ctx) {
  if (ctx._brandVoiceSummary === undefined) {
    const { preferences } = await loadBrandBrain(client, ctx.shopId);
    ctx._brandVoiceSummary = buildBrandSummary(preferences);
  }
  return ctx._brandVoiceSummary;
}

/** Same memoization pattern as getBrandVoiceSummary() above, for the
 * shop's separate VISUAL style memory (ai-style-memory.js) — kept as its
 * own cached field so a multi-step compound request still only loads it
 * once, and so it's never blended into the brand-voice (writing) summary. */
async function getVisualStyleSummary(client, ctx) {
  if (ctx._visualStyleSummary === undefined) {
    const { preferences } = await loadStyleMemory(client, ctx.shopId);
    ctx._visualStyleSummary = buildVisualStyleSummary(preferences);
  }
  return ctx._visualStyleSummary;
}

async function runCompoundStep(client, step, ctx) {
  const { shopId, userId, persona, shop, extracted, platforms, requestText } = ctx;

  if (step.tool === "compound.checkBudget") {
    const estimatedCents = estimateCompoundPlanCostCents({ wantsImage: extracted.wantsImage, wantsVideo: extracted.wantsVideo, platformCount: platforms.length });

    // 1. The stated PER-REQUEST ceiling ("don't spend over $2") — this
    // request's own cost alone, never blended with unrelated spend
    // earlier in the month. No DB query needed; checked first since it's
    // the cheapest and most specific signal.
    if (extracted.budgetCents != null && estimatedCents > extracted.budgetCents) {
      return {
        ok: false,
        blocked: true,
        error: `Estimated cost $${(estimatedCents / 100).toFixed(2)} exceeds the stated budget of $${(extracted.budgetCents / 100).toFixed(2)} — nothing was generated. Raise the budget or ask for less (e.g. fewer platforms) and try again.`,
        result: { estimatedCents, budgetCents: extracted.budgetCents }
      };
    }

    // 2. The shop's own persisted MONTHLY default (Priority 2) — a real,
    // cumulative ceiling independent of what any one request states for
    // itself. Degrades to a no-op (checkMonthlyBudgetForRequest resolves
    // to "none") until the migration is applied and/or no default is
    // configured for this shop, so this is safe to always run.
    const monthlyCheck = await checkMonthlyBudgetForRequest(client, { shopId, additionalCostCents: estimatedCents, requestedCapCents: null });
    if (!monthlyCheck.allowed) {
      return {
        ok: false,
        blocked: true,
        error:
          monthlyCheck.reason === "shop_budget_lookup_failed"
            ? `Could not verify this month's committed spend before generating — nothing was generated. (${monthlyCheck.error})`
            : `Generating this would bring this month's committed spend to $${(monthlyCheck.wouldBeCents / 100).toFixed(2)}, over this shop's configured $${(monthlyCheck.capCents / 100).toFixed(2)} monthly budget — nothing was generated.`,
        result: { estimatedCents, ...monthlyCheck }
      };
    }

    return { ok: true, result: { estimatedCents, budgetCents: extracted.budgetCents, monthlyCapCents: monthlyCheck.capCents, monthlyRemainingCents: monthlyCheck.remainingCents } };
  }

  if (step.tool === "compound.lookupInventory") {
    const inv = await loadGroundedInventory(client, shopId);
    if (!inv.ok || !inv.items.length) {
      return { ok: false, error: inv.error || "No real inventory on file to ground this request in — add inventory first, or ask without 'flowers I have'." };
    }
    const brief = buildInventoryGroundingBrief(inv.items);
    ctx.inventoryBrief = brief;
    return { ok: true, result: { itemCount: inv.items.length, sources: brief.sources } };
  }

  if (step.tool === "compound.lookupAudience") {
    // Same intent-gated, honest-or-fail pattern as compound.lookupInventory
    // above — only runs when the florist's own words actually asked to
    // target/reach a real customer group, and fails clearly rather than
    // silently continuing with a fabricated audience when there's nothing
    // real to ground on (Marketing Campaigns disabled for this shop, or a
    // real but empty subscriber list).
    const audience = await loadCustomerAudienceSummary(client, shopId);
    if (!audience.enabled) {
      return { ok: false, error: "Marketing Campaigns isn't set up for this shop yet, so there's no real audience data to target — nothing was generated." };
    }
    if (!audience.subscriberCount) {
      return { ok: false, error: "No customers have opted in to marketing yet, so there's no real audience to target — nothing was generated." };
    }
    const brief = buildAudienceGroundingBrief(audience);
    ctx.audienceBrief = brief;
    return { ok: true, result: { subscriberCount: audience.subscriberCount, segments: audience.segments } };
  }

  if (step.tool === "compound.checkDigitalTwin") {
    const availability = await checkDigitalTwinAvailability(client, shopId);
    if (!availability.available) {
      return { ok: false, blocked: true, error: `Digital Twin not available: ${availability.reason} CONNECTION REQUIRED — complete AI Clone enrollment (avatar + voice) before Lily can use your likeness/voice automatically.` };
    }
    ctx.digitalTwin = availability;
    return { ok: true, result: { consentId: availability.consentId } };
  }

  if (step.tool === "compound.generateImage") {
    const groundedProducts = ctx.inventoryBrief?.sources?.map((s) => s.name) || [];
    const prompt = buildImagePrompt({ occasion: extracted.occasion, products: groundedProducts, shopName: shop?.name });
    const gen = await generateImage(client, shopId, { prompt, filename: `compound-${Date.now()}.jpg` });
    if (!gen.ok) return { ok: false, error: gen.error };
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, assetType: "image", provider: gen.provider, model: gen.model, prompt: gen.prompt,
      content: { url: gen.url, grounded_in_inventory: ctx.inventoryBrief?.sources || [] },
      status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    ctx.masterAssetId = persisted.asset.id;
    ctx.masterImageUrl = gen.url;
    return { ok: true, result: { assetId: persisted.asset.id, url: gen.url } };
  }

  if (step.tool === "compound.generateVideoConcept") {
    const brandVoiceSummary = await getBrandVoiceSummary(client, ctx);
    const visualStyleSummary = await getVisualStyleSummary(client, ctx);
    // Phase 4 wiring: only reuses ctx.inventoryBrief when an earlier
    // compound.lookupInventory step actually ran for THIS request's own
    // plan (i.e. the florist's own words asked about stock) — never a new,
    // unconditional query here. A compound request that never mentioned
    // "flowers I have" gets no inventory section, exactly as before.
    const inventorySummary = ctx.inventoryBrief?.summaryText || null;
    // Same reuse discipline as inventorySummary above — only real when a
    // compound.lookupAudience step already ran for this request's own plan.
    const audienceSummary = ctx.audienceBrief?.summaryText || null;
    const gen = await generateVideoConcept({ persona, channel: platforms[0], occasion: extracted.occasion, shop, requestText, brandVoiceSummary, visualStyleSummary, inventorySummary, audienceSummary });
    if (!gen.ok) return { ok: false, error: gen.error };
    // Batch 1 rebuild: same detection-only video-concept safety check as
    // the other two Marketing/Lily job runners — no headline/body/cta
    // shape to repair field-by-field, so this is recorded for
    // observability rather than blocking the compound job outright.
    const compoundVideoEval = evaluateMarketingOutput({
      route: "compound.generateVideoConcept",
      request: requestText,
      shopEvidence: { name: shop?.name, phone: shop?.phone },
      inventoryEvidence: ctx.inventoryBrief?.sources || [],
      candidate: [gen.content.concept, gen.content.script, ...(gen.content.scenes || []), ...(gen.content.captions || [])].filter(Boolean).join(" "),
      component: "video_concept",
      isRetryAttempt: true
    });
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, assetType: "video_concept", model: gen.model,
      content: { ...gen.content, safety_check: { decision: compoundVideoEval.reasons.length ? "reject" : "pass", reasonCount: compoundVideoEval.reasons.length } },
      status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    ctx.videoConceptAssetId = persisted.asset.id;
    ctx.videoConcept = gen.content;
    return { ok: true, result: { assetId: persisted.asset.id, content: gen.content } };
  }

  if (step.tool === "compound.planVideoRender") {
    const sourceImageUrls = ctx.masterImageUrl ? [ctx.masterImageUrl] : [];
    const planResult = planVideoRender({
      sourceImageUrls,
      captions: ctx.videoConcept?.captions?.join(" ") || null,
      durationSeconds: ctx.videoConcept?.suggested_length_seconds || 15,
      aspectRatio: "9:16"
    });
    if (!planResult.ok) return { ok: false, error: planResult.error };
    return {
      ok: false,
      blocked: true,
      error: "Video RENDER PLAN is real and saved — actual rendering is CONNECTION REQUIRED (no video-rendering provider connected). This step is optional and does not block the rest of the request.",
      result: { plan: planResult.plan }
    };
  }

  // Digital Twin completion pass (Priority 8): the real generation call —
  // reuses the exact same provider-selection/job-recording primitives
  // personal-brand-service.js's requestDigitalTwinGeneration() uses for
  // its own (founder_concept-scoped) flow, called directly here rather
  // than through that function, since this compound flow's asset is a
  // video_concept (different content shape: script/concept, not
  // body/founder_presence_brief) — never silently misreading the wrong
  // fields for a "real" render.
  if (step.tool === "compound.requestDigitalTwinRender") {
    if (!ctx.digitalTwin) {
      return { ok: false, blocked: true, error: "Digital Twin availability was not confirmed earlier in this request — cannot render." };
    }
    const script = [ctx.videoConcept?.script, ctx.videoConcept?.concept].filter(Boolean).join(" ").trim();
    if (!script) {
      return { ok: false, error: "No video script/concept was generated to render as a Digital Twin video." };
    }
    const cloneRegistry = buildConfiguredCloneProviderRegistry({
      env: process.env,
      uploadAudio: (buffer, filename) => uploadClonedVoiceAudio(client, shopId, buffer, filename)
    });
    const provider = selectCloneProvider({}, cloneRegistry);
    if (provider === notLiveCloneProvider) {
      return {
        ok: false,
        blocked: true,
        error: "Digital Twin render is CONNECTION REQUIRED — no avatar/voice provider is connected yet. The script above is real and ready to render the moment one is."
      };
    }
    try {
      const result = await provider.generateVideo({
        avatarProfileId: ctx.digitalTwin.avatarProfileId,
        voiceProfileId: ctx.digitalTwin.voiceProfileId,
        script,
        title: extracted.occasion || "Digital Twin video"
      });
      try {
        await recordCloneVideoJob(client, {
          shopId,
          provider: result.provider || "heygen",
          providerJobId: result.jobId,
          source: "content_generation",
          sourceAssetId: ctx.videoConceptAssetId || null,
          avatarProfileId: ctx.digitalTwin.avatarProfileId,
          voiceProfileId: ctx.digitalTwin.voiceProfileId,
          consentId: ctx.digitalTwin.consentId,
          usage: "social_video",
          platform: platforms[0],
          createdBy: userId
        });
      } catch (correlationError) {
        // Same non-fatal pattern as personal-brand-service.js: the render
        // was already kicked off (real spend committed) — losing the
        // correlation row must never be reported as the whole step
        // failing, or a real in-flight render would be retried/duplicated.
        console.warn(JSON.stringify({ level: "warn", fn: "marketing-compound-orchestrator", message: "digital_twin_job_record_failed", reason: String(correlationError?.message || correlationError) }));
      }
      ctx.digitalTwinJobId = result.jobId;
      return { ok: true, result: { jobId: result.jobId, status: result.status || "rendering" } };
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 300) };
    }
  }

  if (step.tool === "compound.createContentItem") {
    const contentType = extracted.wantsVideo ? "reel" : "image_post";
    const title = extracted.occasion ? `${extracted.occasion} — ${extracted.summary}`.slice(0, 120) : extracted.summary.slice(0, 120);
    const inserted = await client
      .from("marketing_content_items")
      .insert({
        shop_id: shopId,
        created_by: userId,
        content_type: contentType,
        title,
        brief: extracted.summary,
        status: "idea",
        uses_ai_clone: extracted.wantsDigitalTwin,
        requires_human_approval: true
      })
      .select("id,content_type,title,status")
      .single();
    if (inserted.error) return { ok: false, error: inserted.error.message };
    ctx.contentItemId = inserted.data.id;

    // One caption per platform (reuses generateSocialPost — never a
    // second copy-generation implementation), each with disclosure
    // computed the moment real content is attached (Blocker 1's fix,
    // reused here rather than left to an optional follow-up).
    const brandVoiceSummary = await getBrandVoiceSummary(client, ctx);
    const visualStyleSummary = await getVisualStyleSummary(client, ctx);
    // Same intent-driven reuse as compound.generateVideoConcept above —
    // only real when this request's own plan already ran
    // compound.lookupInventory.
    const inventorySummary = ctx.inventoryBrief?.summaryText || null;
    // Same reuse discipline — only real when compound.lookupAudience ran
    // for this request's own plan.
    const audienceSummary = ctx.audienceBrief?.summaryText || null;
    const variantRows = [];
    for (const platform of platforms) {
      // eslint-disable-next-line no-await-in-loop
      const copyGen = await generateSocialPost({ persona, channel: platform, occasion: extracted.occasion, shop, requestText, brandVoiceSummary, visualStyleSummary, inventorySummary, audienceSummary });
      // Batch 1 rebuild: this compound-request path had no output-safety
      // check at all before persisting a per-platform caption — same
      // deterministic-repair-always pattern as marketing-studio.js's own
      // generate_content.
      if (copyGen.ok) {
        const compoundCaptionEval = evaluateMarketingOutput({
          route: "compound.createContentItem",
          request: requestText,
          shopEvidence: { name: shop?.name, phone: shop?.phone },
          inventoryEvidence: ctx.inventoryBrief?.sources || [],
          candidate: copyGen.content,
          component: "caption",
          isRetryAttempt: true
        });
        if (compoundCaptionEval.safeCandidate) {
          copyGen.content.headline = compoundCaptionEval.safeCandidate.headline;
          copyGen.content.body = compoundCaptionEval.safeCandidate.body;
          copyGen.content.cta = compoundCaptionEval.safeCandidate.cta;
        }
      }
      variantRows.push({
        shop_id: shopId,
        content_item_id: inserted.data.id,
        platform,
        status: "pending",
        // Prefer the video-concept asset (its traits_used is what makes
        // approve_content able to reinforce/weaken Brand Brain + My Style
        // for a video-type compound request) over the master image when
        // both exist; masterAssetId alone for an image-only request.
        asset_id: ctx.videoConceptAssetId || ctx.masterAssetId || null,
        caption: copyGen.ok ? copyGen.content.body : null,
        hashtags: copyGen.ok ? copyGen.content.hashtags : [],
        ...computeDisclosureFields({
          platform,
          avatarUsed: extracted.wantsDigitalTwin,
          voiceUsed: extracted.wantsDigitalTwin,
          generativeVideoUsed: extracted.wantsVideo,
          generativeImageUsed: extracted.wantsImage,
          aiContentType: extracted.wantsDigitalTwin ? "avatar_video" : extracted.wantsVideo ? "generative_video" : extracted.wantsImage ? "generative_image" : "none"
        })
      });
    }
    const insertedVariants = await client.from("marketing_platform_variants").insert(variantRows).select("id,platform");
    if (insertedVariants.error) return { ok: false, error: insertedVariants.error.message };
    ctx.variantsByPlatform = Object.fromEntries(insertedVariants.data.map((v) => [v.platform, v.id]));
    return { ok: true, result: { contentItemId: inserted.data.id, variants: insertedVariants.data } };
  }

  if (step.tool === "compound.transformForPlatforms") {
    if (!ctx.masterAssetId || !ctx.masterImageUrl) return { ok: false, error: "No master image was generated to transform." };
    const transformResult = await transformMasterImageForPlatforms(client, {
      shopId, userId, persona,
      masterAssetId: ctx.masterAssetId,
      masterUrl: ctx.masterImageUrl,
      masterAspectRatio: "1:1", // flux-1-schnell's default output — see ai-image-engine.js
      targetPlatforms: platforms
    });
    if (!transformResult.ok) return { ok: false, error: transformResult.error };
    return { ok: true, result: { transforms: transformResult.results, warnings: transformResult.warnings } };
  }

  if (step.tool === "compound.schedule") {
    if (!ctx.contentItemId) return { ok: false, error: "No content item was created to schedule." };
    const scheduledAtLocal = resolveScheduleHint({ relativeDay: extracted.scheduleRelativeDay, timeOfDay: extracted.scheduleTimeOfDay }, { timezone: ctx.timezone });
    if (!scheduledAtLocal) return { ok: false, error: "No schedule was requested." };
    const result = await scheduleContentItemVariants(client, { shopId, contentItemId: ctx.contentItemId, scheduledAtLocal, timezone: ctx.timezone, platforms });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, result: { scheduledAtUtc: result.scheduledAtUtc, timezone: result.timezone } };
  }

  return { ok: false, error: `Unknown compound step tool: ${step.tool}` };
}

/**
 * The full entry point: extract → plan → run, persisted to
 * ai_execution_jobs throughout. Returns { ok:false, error } only for a
 * request that couldn't even be understood (extraction failure) or
 * couldn't be planned at all — every OTHER outcome (partial success,
 * budget-blocked, Digital-Twin-blocked, video-render-blocked) is a real
 * completed job row with per-step detail, never a bare error.
 */
export async function runCompoundRequest(
  client,
  { shopId, userId, persona = "Lily", message, shop = {}, timezone = "America/New_York", now = new Date(), dedupeWindowMs = 60_000 } = {}
) {
  const extracted = await extractCompoundMarketingRequest(message);
  if (!extracted) {
    return { ok: false, error: "Could not understand this request well enough to plan it — try rephrasing, or ask for one piece at a time." };
  }
  if (!extracted.wantsImage && !extracted.wantsVideo) {
    return { ok: false, error: "This request didn't ask for an image or a video — nothing to create." };
  }

  // Orchestration hardening (Priority 9): request-level idempotency. This
  // is a synchronous, real-money-spending flow with no queue/claim layer
  // in front of it (unlike marketing-publishing-worker.js) — a double-
  // click, a client-side retry after a slow response, or a flaky network
  // resubmit used to just run every real generation call a second time,
  // with a second real charge and a second content_item. The exact same
  // (shop, request text) within a short window returns the ALREADY-
  // running/produced job instead of starting a new one. A prior FAILED
  // attempt is deliberately NOT deduped — a genuine retry after a
  // transient failure must be allowed to actually try again, never
  // trapped behind its own failure.
  const recentResult = await client
    .from("ai_execution_jobs")
    .select("id,status,plan,result,error,title,context,created_at")
    .eq("shop_id", shopId)
    .eq("job_type", "marketing_compound")
    .eq("request_text", message)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!recentResult.error && recentResult.data) {
    const createdAtMs = new Date(recentResult.data.created_at).getTime();
    const ageMs = now.getTime() - createdAtMs;
    const dedupableStatus = ["running", "completed", "partially_completed", "waiting_for_approval"].includes(recentResult.data.status);
    if (dedupableStatus && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < dedupeWindowMs) {
      return { ok: true, job: recentResult.data, deduped: true };
    }
  }

  const platforms = extracted.platforms.length ? extracted.platforms : ["facebook"];
  const plan = planCompoundRequest(extracted).map((s) => ({ ...s, status: "planned", result: null, error: null }));

  const { data: job, error: createError } = await client
    .from("ai_execution_jobs")
    .insert({
      shop_id: shopId,
      created_by: userId,
      persona,
      job_type: "marketing_compound",
      title: extracted.summary,
      status: "running",
      request_text: message,
      plan,
      context: { extracted, platforms }
    })
    .select()
    .single();
  if (createError) return { ok: false, error: createError.message };

  const ctx = { shopId, userId, persona, shop, extracted, platforms, requestText: message, timezone };
  let haltedOnBudget = false;

  for (let i = 0; i < plan.length; i += 1) {
    if (haltedOnBudget) {
      plan[i].status = "skipped_over_budget";
      continue;
    }
    plan[i].status = "running";
    // eslint-disable-next-line no-await-in-loop
    const outcome = await runCompoundStep(client, plan[i], ctx);
    if (outcome.ok) {
      plan[i].status = "completed";
      plan[i].result = outcome.result || null;
    } else if (outcome.blocked) {
      plan[i].status = "blocked";
      plan[i].error = outcome.error;
      plan[i].result = outcome.result || null;
      if (step_id_requires_halt(plan[i].id)) haltedOnBudget = true;
    } else {
      plan[i].status = "failed";
      plan[i].error = outcome.error || "Unknown error";
    }
  }

  const jobStatus = haltedOnBudget ? "waiting_for_approval" : summarizeStatus(plan);
  const result = { platforms, steps: plan.map((s) => ({ id: s.id, tool: s.tool, label: s.label, status: s.status, result: s.result, error: s.error })) };

  const { data: updated, error: updateError } = await client
    .from("ai_execution_jobs")
    .update({ status: jobStatus, plan, result })
    .eq("id", job.id)
    .select()
    .single();
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, job: updated };
}

// Only the budget-check step actually halts the whole plan (a hard
// execution constraint, per Priority 8) — every other "blocked" step
// (Digital Twin unavailable, video render not-live) is reported honestly
// but never stops unrelated steps (an image can still be generated even
// if the video-render plan is blocked).
function step_id_requires_halt(stepId) {
  return stepId === "budget_check";
}
