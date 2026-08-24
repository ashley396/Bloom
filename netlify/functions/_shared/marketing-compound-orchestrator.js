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
import { computeDisclosureFields } from "./creative-ai/disclosure-policy.js";
import { transformMasterImageForPlatforms } from "./creative-ai/media-transform-executor.js";
import { planVideoRender } from "./marketing-video-render-engine.js";
import { scheduleContentItemVariants } from "./marketing-schedule-content.js";
import { estimateCostCents } from "./marketing-cost-config.js";
import { checkMonthlyBudgetForRequest } from "./marketing-budget-guard.js";
import { shopDateStr } from "./shop-time.js";
import { SUPPORTED_PLATFORMS } from "./marketing-social-providers.js";

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
  if (extracted.wantsDigitalTwin) {
    steps.push({ id: "digital_twin_check", tool: "compound.checkDigitalTwin", label: "Check Digital Twin availability", optional: false });
  }
  if (extracted.wantsImage) {
    steps.push({ id: "generate_image", tool: "compound.generateImage", label: "Generate the master image", optional: false });
  }
  if (extracted.wantsVideo) {
    steps.push({ id: "generate_video_concept", tool: "compound.generateVideoConcept", label: "Write the video script & storyboard", optional: false });
    steps.push({ id: "plan_video_render", tool: "compound.planVideoRender", label: "Build the video render plan", optional: true });
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
    const gen = await generateVideoConcept({ persona, channel: platforms[0], occasion: extracted.occasion, shop, requestText });
    if (!gen.ok) return { ok: false, error: gen.error };
    const persisted = await persistGeneratedAsset(client, { shopId, userId, persona, assetType: "video_concept", model: gen.model, content: gen.content, status: "completed" });
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
    const variantRows = [];
    for (const platform of platforms) {
      // eslint-disable-next-line no-await-in-loop
      const copyGen = await generateSocialPost({ persona, channel: platform, occasion: extracted.occasion, shop, requestText });
      variantRows.push({
        shop_id: shopId,
        content_item_id: inserted.data.id,
        platform,
        status: "pending",
        asset_id: ctx.masterAssetId || null,
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
export async function runCompoundRequest(client, { shopId, userId, persona = "Lily", message, shop = {}, timezone = "America/New_York" } = {}) {
  const extracted = await extractCompoundMarketingRequest(message);
  if (!extracted) {
    return { ok: false, error: "Could not understand this request well enough to plan it — try rephrasing, or ask for one piece at a time." };
  }
  if (!extracted.wantsImage && !extracted.wantsVideo) {
    return { ok: false, error: "This request didn't ask for an image or a video — nothing to create." };
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
