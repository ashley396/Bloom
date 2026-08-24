import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import {
  buildCoachSuggestions,
  checkLilyPermission,
  detectIntent,
  planClientAction,
  sanitizeHistoryEntry,
  searchHistory
} from "./_shared/lily-ai-engine.js";
import { normalizePersona, shopVoiceSuffix, suggestHandoff, domainOwner, jobDomainOwner } from "./_shared/florist-ai-personas.js";
import { runCloudflareGenerate } from "./ai-assistant.js";
import { searchMarketplaceForLily, buildMarketplaceSourcingAnswer } from "./_shared/marketplace-lily-sourcing.js";
import { classifyRequest } from "./_shared/ai-intent-router.js";
import { runJob, retryJobStep } from "./_shared/ai-orchestrator.js";
import { getVideoProvider } from "./_shared/ai-video-provider.js";
import { parseRevisionDeltas } from "./_shared/ai-visual-revisions.js";
import { loadStyleMemory, buildStyleSummary, applyExplicitPreferenceUpdates, saveStyleMemory } from "./_shared/ai-style-memory.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import {
  isRequestingUserPlatformSuperAdmin,
  runPersonalBrandCommand,
  findLastPersonalBrandConceptAsset
} from "./_shared/creative-ai/personal-brand-service.js";

const CONVERSATIONS = "lily_conversations";
const MESSAGES = "lily_messages";
const AUDIT = "lily_action_audit";

function isMissingTableError(error) {
  if (!error) return false;
  const message = String(error.message || error.details || "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find the table");
}

async function loadAiContext(client, shopId) {
  const [{ data: shop }, { data: inventory }, { data: orders }, { data: deliveries }, { data: aiProfile }] = await Promise.all([
    client.from("shops").select("name,address,phone,tagline").eq("id", shopId).maybeSingle(),
    client.from("inventory").select("name,color,quantity,low_stock_level,cost,price").eq("shop_id", shopId).is("deleted_at", null).order("created_at", { ascending: false }).limit(40),
    client.from("orders").select("order_number,customer_name,total,payment_status,delivery_date,status,estimated_cost").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(20),
    client.from("deliveries").select("status,recipient_name,address,delivery_date").eq("shop_id", shopId).order("delivery_date", { ascending: true }).limit(15),
    // The florist tells Florisyn how the shop should sound (and any delivery/
    // marketing notes) during onboarding step 4 ("Meet Lily and Rose") — this
    // row is where that lands. Read it here so the promise made at onboarding
    // is actually kept, not just stored.
    client.from("ai_shop_profiles").select("lily_enabled,rose_enabled,shop_tone,delivery_notes,marketing_notes").eq("shop_id", shopId).maybeSingle()
  ]);
  return {
    shop: shop || {},
    inventory: inventory || [],
    recent_orders: orders || [],
    deliveries: deliveries || [],
    ai_profile: aiProfile || null
  };
}

/** Has this florist turned the persona off? Only an explicit false counts —
 * a missing profile row (not yet onboarded, or the table isn't reachable)
 * must never be treated as "disabled". */
export function personaDisabled(persona, aiProfile) {
  if (!aiProfile) return false;
  const who = normalizePersona(persona);
  if (who === "Lily") return aiProfile.lily_enabled === false;
  if (who === "Rose") return aiProfile.rose_enabled === false;
  return false;
}

/**
 * Real conversational answer from Cloudflare Workers AI (persona-aware). Returns
 * null on any failure so the caller can fall back to a safe template.
 *
 * Routed through the shared ai-assistant.js provider layer (not a bespoke fetch)
 * so Lily's chat gets the same input sanitization every other Florisyn AI surface
 * gets — BLOCKED_KEY/DATA_URL scrubbing and size-limited context — instead of a
 * second, independently-truncated Cloudflare call path.
 */
export async function cloudflareChat(persona, message, context) {
  if (!message) return null;
  try {
    const guardrail = "Protect private employee and customer information — never repeat it outside its business purpose.";
    const voice = shopVoiceSuffix(context.ai_profile);
    const result = await runCloudflareGenerate({
      mode: "chat",
      persona,
      prompt: message,
      context: {
        shop: context.shop || {},
        inventory: context.inventory || [],
        recent_orders: context.recent_orders || [],
        upcoming_deliveries: context.deliveries || []
      },
      max_tokens: 500,
      // Persona prompts already say not to claim unconfirmed actions; add the
      // one guardrail that's specific to a live business-context chat turn,
      // plus this shop's own voice/notes from onboarding, when it has any.
      systemSuffix: voice ? `${guardrail}\n${voice}` : guardrail
    });
    return result?.answer?.trim() || null;
  } catch {
    return null;
  }
}

async function persistMessage(client, { conversationId, userId, shopId, role, content, metadata }) {
  try {
    await client.from(MESSAGES).insert({
      conversation_id: conversationId,
      user_id: userId,
      shop_id: shopId,
      role,
      content,
      metadata: metadata || {}
    });
    // Pass #3 security review: conversationId comes straight from the
    // client body with nothing else here confirming it's this shop's own
    // conversation — scope the touch explicitly rather than lean only on
    // RLS to keep a stray id from bumping another shop's row.
    await client.from(CONVERSATIONS).update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("shop_id", shopId);
  } catch {
    // Tables may not exist until migration is applied.
  }
}

/** Finds or creates this turn's conversation row. Shared by every response
 * path (job, preference-only, plain chat) so a fresh chat always gets a
 * real conversation_id to persist against and to key visual revisions off
 * of, without three near-duplicate insert blocks drifting out of sync. */
async function ensureConversation(client, { conversationId, userId, shopId, message }) {
  if (conversationId) return conversationId;
  try {
    const { data } = await client
      .from(CONVERSATIONS)
      .insert({ user_id: userId, shop_id: shopId, title: message.slice(0, 80) || "Lily chat" })
      .select("id")
      .single();
    return data?.id || null;
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "lily_conversation_create_skipped",
          detail: String(error.message || error).slice(0, 200)
        })
      );
    }
    return null;
  }
}

async function logAction(client, { userId, shopId, intent, actionType, result, metadata }) {
  try {
    await client.from(AUDIT).insert({
      user_id: userId,
      shop_id: shopId,
      intent,
      action_type: actionType,
      result,
      metadata: metadata || {}
    });
  } catch {
    // optional audit table
  }
}

/**
 * AI-OS Wave 4: real programmatic delegation for the domains that
 * unambiguously belong to one specialist (business/reports questions are
 * Rose's, no matter which persona the florist happens to be talking to),
 * instead of only a client-side "want me to bring her in?" suggestion the
 * florist has to notice and tap before getting any real content.
 *
 * Deliberately narrow: this only fires for domainOwner() — a structured
 * signal detectIntent() already resolved. The fuzzy open-chat keyword
 * hints in suggestHandoff() (TOPIC_HINTS) stay suggest-only; a keyword
 * match inside free chat isn't a confident enough signal to silently swap
 * who's answering, so those keep the deliberate manual tap-to-switch flow.
 * Also never fires on an action that still needs the florist's own
 * confirmation — swapping personas mid-confirmation would break the
 * pending-action resend, which is keyed to the persona that proposed it.
 */
export function shouldDelegate({ persona, intentDomain, permission, planned } = {}) {
  const owner = domainOwner(intentDomain);
  if (!owner) return null;
  if (owner === normalizePersona(persona)) return null;
  if (!permission?.allowed) return null;
  if (planned?.requiresConfirmation) return null;
  return owner;
}

/** Plainly attributes a delegated answer to the specialist who actually
 * wrote it — the active persona never passes off another's voice as its
 * own, and the florist always knows who they're really hearing from. */
export function formatDelegatedAnswer(owner, activePersona, answerText) {
  const who = normalizePersona(activePersona);
  return `**${who} brought in ${owner} for this one:**\n\n${answerText}`;
}

/**
 * AI-OS Wave 5: which persona should actually AUTHOR a job-producing
 * request (runJob()'s persona, not just the chat reply). A marketing/
 * creative job always executes as Lily — Florisyn's designated creative
 * director — even when Bud, Rose, or Daisy is the one the florist is
 * chatting with, so "make me a Facebook post" asked of Bud comes back
 * written in Lily's real creative voice, not paraphrased in Bud's.
 * Returns { author, delegated } — author is always a real persona name
 * (falls back to the active persona when the domain has no owner), and
 * delegated is true only when that author differs from who's chatting.
 */
export function resolveJobPersona(persona, domain) {
  const who = normalizePersona(persona);
  const owner = jobDomainOwner(domain);
  if (!owner || owner === who) return { author: who, delegated: false };
  return { author: owner, delegated: true };
}

/**
 * Visual Creation Studio: finds the most recent visual (background/flyer/
 * revision) this conversation produced, so a follow-up like "make it bigger"
 * or "use less pink" — deterministic or not — chains onto it via
 * parent_asset_id instead of starting a disconnected new asset. Scoped to
 * the SAME conversation deliberately: a florist's other, unrelated chat
 * thread should never get silently revised. Returns null (never throws) on
 * any lookup failure or when there's no prior visual to find.
 */
export async function findLastVisualAsset(client, { shopId, conversationId }) {
  if (!conversationId) return null;
  try {
    // Scans back through several recent photo-domain jobs, not just the
    // single most recent one — the latest job in the conversation might
    // itself have failed (e.g. an image-gen error) and produced zero
    // completed visual steps, which would otherwise hide an earlier,
    // perfectly revisable asset from a follow-up like "make it bigger".
    const { data: jobs } = await client
      .from("ai_execution_jobs")
      .select("id, result")
      .eq("shop_id", shopId)
      .eq("conversation_id", conversationId)
      .eq("context->>domain", "photo")
      .order("created_at", { ascending: false })
      .limit(8);
    for (const job of jobs || []) {
      const steps = job.result?.steps || [];
      const visualSteps = steps.filter(
        (s) =>
          s.status === "completed" &&
          ["creative.generateBackground", "creative.renderFlyerContent", "creative.reviseVisual"].includes(s.tool) &&
          s.result?.asset_id
      );
      if (visualSteps.length) {
        const last = visualSteps[visualSteps.length - 1];
        return { assetId: last.result.asset_id, jobId: job.id };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether a classified (or synthetic deterministic-revision) request should
 * actually run through runJob() — the traditional marketing create/campaign/
 * video actions, plus Visual Creation Studio's photo-domain edits
 * (background_change/style/revise/flyer). A pure decision function, kept
 * separate from the handler so the "what counts as a job" rule is directly
 * testable without a fake Supabase client.
 */
export function shouldRunJob(routed) {
  if (!routed) return false;
  if (["create", "campaign", "video"].includes(routed.action_type)) return true;
  if (routed.action_type !== "edit") return false;
  return routed.domain === "photo" && ["background_change", "style", "revise", "flyer"].includes(routed.visual_op);
}

/**
 * Personal Brand Studio routing decision (Lily + Digital Twin integration
 * pass, Section 3) — whether a classifyRequest()-routed object should be
 * handed to Personal Brand Studio instead of the ordinary marketing/photo
 * job pipeline. Pure and directly testable, mirroring shouldRunJob()'s
 * own convention. A routed object carrying domain:"personal_brand" has
 * NONE of the fields runJob()'s job builder expects — this check exists
 * specifically so it's intercepted before shouldRunJob()/runJob() ever
 * see it, never so it could accidentally fall into that pipeline.
 */
export function isPersonalBrandDomain(routed) {
  return Boolean(routed) && routed.domain === "personal_brand";
}

/**
 * Whether a runPersonalBrandCommand() result is actually actionable (a
 * generated concept, or a real memory statement applied) versus a
 * "nothing resolved" result that should fall through to Lily's ordinary
 * chat reply instead of a dead-end response. This is the false-positive
 * safety net Section 3 calls for: classifyRequest()'s coarse domain call
 * already said "personal_brand", but classifyPersonalBrandCommand() (the
 * detailed, second-stage classifier) must ALSO find something real
 * before Personal Brand Studio takes over the turn — two independent
 * classifiers, not one keyword match, deciding together.
 */
export function isPersonalBrandResultActionable(result) {
  return Boolean(result?.understood) && (Boolean(result.asset) || Boolean(result.memoryAck));
}

/** Turns a runPersonalBrandCommand() result into a real chat reply — never
 * a raw JSON dump, matching formatJobResponse()'s own convention for the
 * marketing job pipeline. */
export function formatPersonalBrandResponse(result) {
  const parts = [];
  if (result.memoryAck) parts.push(result.memoryAck);
  if (result.asset && result.content) {
    const c = result.content;
    parts.push(`**${c.headline || "Founder concept"}**\n\n${c.body || ""}${c.cta ? `\n\n*${c.cta}*` : ""}`);
    parts.push('This is a draft — tell me to send it to Marketing Studio, or say "use my Digital Twin" to turn it into a video.');
  }
  const twin = result.digitalTwin;
  if (twin?.attempted) {
    if (twin.ok && twin.statusCode === 202) {
      parts.push(`I started your Digital Twin video (job ${twin.body.job_id}) — I'll let you know when it's ready.`);
    } else if (twin.reason === "not_enrolled") {
      parts.push("You haven't set up your Digital Twin yet — an admin can enroll your avatar/voice from the Marketing Studio console first.");
    } else if (twin.reason === "no_concept_to_render") {
      parts.push('I don\'t have anything to turn into a video yet — describe what you want first, then ask me to use your Digital Twin.');
    } else if (twin.reason === "profile_not_ready") {
      parts.push("Your Digital Twin isn't ready to use yet — its avatar/voice profile is still training.");
    } else if (twin.body?.note) {
      parts.push(twin.body.note);
    } else if (twin.body?.error) {
      parts.push(`I couldn't start that video: ${twin.body.error}`);
    }
  }
  return parts.join("\n\n") || "Got it.";
}

/** Plain acknowledgment for a standing style preference Lily just learned —
 * per the shop-style-memory rule, this ONLY fires for an explicit statement
 * ("I like soft luxury backgrounds"), never a one-time override, so telling
 * the florist it was remembered is always accurate. */
export function describePreferenceAck(updates = []) {
  const positives = updates.filter((u) => u.polarity !== "negative").map((u) => u.text);
  const negatives = updates.filter((u) => u.polarity === "negative").map((u) => u.text);
  const parts = [];
  if (positives.length) parts.push(`I'll remember you like ${positives.join(", ")}`);
  if (negatives.length) parts.push(`I'll steer away from ${negatives.join(", ")}`);
  if (!parts.length) return "Got it — noted for next time.";
  return `Got it — ${parts.join(", and ")}. You can review or change this anytime under My Style.`;
}

export function buildResponseMessage(intent, permission, planned, confirmed) {
  if (!permission.allowed) {
    return "I can help with that, but your Florisyn role does not allow this action. Ask a shop owner or manager if you need access.";
  }
  if (planned?.message) return planned.message;
  if (planned?.requiresConfirmation && !confirmed) {
    return `I can ${planned.label || "do that"}. Confirm below and I will guide Florisyn — I will not change anything without your approval.`;
  }
  // Already confirmed: the earlier "confirm below" line is stale here — Florisyn
  // is acting on it right now, so say that instead of asking to confirm again.
  if (planned?.requiresConfirmation && confirmed) {
    return `Got it — sending "${planned.label || "that"}" to Florisyn now.`;
  }
  if (planned?.type === "navigate") return "Opening the right workspace for you.";
  if (intent.intent === "general.chat") return null;
  // Florisyn's florist business assistant — customer-facing Lily identity copy.
  return "Here is what I prepared. Review the suggestion and confirm if Florisyn should take action.";
}

/** Turns a finished ai_execution_jobs row into a real, readable preview —
 * never the raw JSON.stringify dump the old marketing.generate path
 * produced. Failed/partial steps are named plainly rather than hidden. */
export function formatJobResponse(job, { requestSummary } = {}) {
  const steps = job?.result?.steps || [];
  const lines = [];

  const campaignStep = steps.find((s) => s.tool === "marketing.createCampaign");
  if (campaignStep?.status === "completed") {
    lines.push(`**Campaign created** — saved as a draft in Marketing Command Center.`);
  }

  for (const step of steps) {
    if (step.tool === "marketing.createCampaign") continue;
    if (step.status === "completed" && step.tool === "marketing.createSocialPost") {
      const c = step.result?.content;
      lines.push(`**${(c?.platform || "Facebook").replace(/^\w/, (m) => m.toUpperCase())} post (draft):**`);
      if (c?.headline) lines.push(c.headline);
      if (c?.body) lines.push(c.body);
      if (c?.cta) lines.push(`*${c.cta}*`);
      if (c?.hashtags?.length) lines.push(c.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "));
    } else if (step.status === "completed" && step.tool === "marketing.createWebsiteSectionDraft") {
      const c = step.result?.content;
      lines.push(`**Website section (draft):**`);
      if (c?.headline) lines.push(c.headline);
      if (c?.subheadline) lines.push(c.subheadline);
      if (c?.cta_label) lines.push(`*${c.cta_label}*`);
    } else if (step.status === "completed" && step.tool === "marketing.createVideoConcept") {
      const c = step.result?.content;
      lines.push(`**Video concept (script rendering not connected yet):**`);
      if (c?.concept) lines.push(c.concept);
      lines.push(`I wrote the full script, storyboard, and captions below — final AI video rendering needs a video provider connected first.`);
    } else if (step.status === "completed" && step.tool === "creative.generateImage") {
      lines.push(`**Image generated** — see the preview below.`);
    } else if (step.status === "failed") {
      lines.push(`I couldn't finish "${step.label}" this time (${step.error || "unknown error"}). Everything else here is saved — say "retry the image" (or the failed step) and I'll try just that part again.`);
    }
  }

  if (!lines.length) {
    return requestSummary ? `I worked on: ${requestSummary}, but nothing came back to show you. Try again?` : "I couldn't complete that. Try again?";
  }

  const closing =
    job.status === "completed"
      ? "Everything above is a draft — review it, then tell me to schedule or publish it."
      : job.status === "partially_completed"
      ? "Some of this is ready now — the rest is still waiting or can be retried."
      : "";
  if (closing) lines.push(closing);
  return lines.join("\n\n");
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const { client, user, shopId, role, membership } = await currentUser(event);
    const body = bodyOf(event);
    const message = String(body.message || body.prompt || "").trim();
    const confirmed = Boolean(body.confirm);
    // Visual Creation Studio: whether a photo is attached to THIS turn.
    // Only a boolean crosses the wire — the actual bytes never leave the
    // browser (compositing is entirely client-side, see lily-platform.js's
    // buildVisualPreview()), so there's nothing for the server to do with
    // the raw image except use its presence as a classification signal.
    const hasImage = Boolean(body.has_image);
    // Pass #3 security review: a raw client-supplied conversation_id used
    // to be trusted outright — reused as-is to append messages and bump
    // updated_at. Verify it's actually this shop's own conversation before
    // treating it as one; otherwise fall back to starting a fresh
    // conversation, same as if none had been supplied.
    let conversationId = body.conversation_id || null;
    if (conversationId) {
      const owned = await client.from(CONVERSATIONS).select("id").eq("id", conversationId).eq("shop_id", shopId).maybeSingle();
      if (owned.error || !owned.data) conversationId = null;
    }
    const persona = body.persona || body.assistant || "lily";

    if (event.httpMethod === "POST" && body.action === "history-search") {
      const history = Array.isArray(body.history) ? body.history.map(sanitizeHistoryEntry) : [];
      return json(200, { results: searchHistory(history, body.query) });
    }

    if (event.httpMethod === "POST" && body.action === "coach") {
      const context = await loadAiContext(client, shopId);
      return json(200, { suggestions: buildCoachSuggestions(context) });
    }

    // "Preserve successful work and allow retry of the failed step" — a
    // partial job failure never means redoing everything that already
    // worked. Re-runs exactly one step in place.
    if (event.httpMethod === "POST" && body.action === "retry-job-step") {
      if (!body.job_id || !body.step_id) return json(400, { error: "job_id and step_id are required." });
      // A retried background/flyer step blends the shop's CURRENT style, not
      // a snapshot from whenever the job first ran — see runJob()'s own
      // docstring for why styleSummary is deliberately never persisted on
      // the job row itself.
      const { preferences: retryPrefs } = await loadStyleMemory(client, shopId);
      const retried = await retryJobStep(client, {
        shopId,
        userId: user.id,
        persona: normalizePersona(persona),
        jobId: body.job_id,
        stepId: body.step_id,
        styleSummary: buildStyleSummary(retryPrefs)
      });
      if (!retried.ok) return json(422, { error: retried.error });
      return json(200, {
        job: retried.job,
        response: formatJobResponse(retried.job)
      });
    }

    // Visual Creation Studio: "Undo to previous version" needs to fetch a
    // specific prior asset by id (its parent_asset_id, read off the asset
    // the florist is currently looking at) — a plain scoped read, not a
    // job re-run, so it's its own tiny action rather than routed through
    // classifyRequest()/runJob().
    if (event.httpMethod === "POST" && body.action === "get-asset") {
      if (!body.asset_id) return json(400, { error: "asset_id is required." });
      const { data: asset, error } = await client
        .from("ai_generated_assets")
        .select("*")
        .eq("id", body.asset_id)
        .eq("shop_id", shopId)
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!asset) return json(404, { error: "That version couldn't be found." });
      return json(200, { asset });
    }

    if (!message && !["product-generate", "coach", "history-search", "get-asset"].includes(body.action)) {
      return json(400, { error: "Add a message for Lily." });
    }

    const intent = detectIntent(message);
    const permission = checkLilyPermission(intent.intent, membership?.role || role, { isPlatformAdmin: false });
    const planned = planClientAction(intent.intent, intent.slots);
    const context = await loadAiContext(client, shopId);

    // AI-OS Phase 2/4: nothing in the fast-path regex chain matched, so
    // this isn't one of the small set of genuinely unambiguous single-word
    // commands (add inventory, clock in, etc.) — read the whole sentence
    // with the LLM classifier instead of dropping straight to plain chat.
    // This is what actually fixes "create a Facebook post" (used to become
    // a paraphrase) and "make a campaign for Facebook and my website"
    // (used to either hijack on the word "website" or vanish into chat).
    if (intent.intent === "general.chat" && message && !confirmed) {
      // Visual Creation Studio: a deterministic follow-up ("make the phone
      // number bigger", "use less pink", "use a marble background instead")
      // never needs classifyRequest at all when this conversation has a
      // recent visual to revise — parse it directly and skip straight to a
      // synthetic "revise" routed object. See ai-visual-revisions.js's
      // docstring for why this is safe (and free) to do; when there's
      // nothing recent to revise, fall through to real classification like
      // any other message (a bare "make it bigger" with no visual history
      // isn't a revision, it's just chat).
      const deterministicDeltas = parseRevisionDeltas(message);
      const priorVisual = deterministicDeltas ? await findLastVisualAsset(client, { shopId, conversationId }) : null;

      const routed = priorVisual
        ? {
            action_type: "edit",
            domain: "photo",
            channels: [],
            occasion: null,
            audience: null,
            summary: message,
            visual_op: "revise",
            visual_brief: null,
            visual_style_signal: false,
            target_aspect_ratio_hint: null,
            traits_used: [],
            preference_statement: false,
            preference_updates: [],
            source: "deterministic"
          }
        : await classifyRequest(message, { hasImage });

      // Personal Brand Studio (Lily + Digital Twin integration pass,
      // Section 2) — the smallest safe extension into this dispatcher.
      // Intercepted here, BEFORE shouldRunJob()/runJob() ever see the
      // routed object: routed carries the marketing/photo job-builder
      // shape, never Personal Brand's mode/memory/digital-twin structure.
      // Gated to the platform's own super_admin during Founding Beta
      // (Section 3/17) — the entire Marketing Studio surface is
      // admin-only today (see marketing-studio.js's own header); routing
      // it through normal chat must never quietly widen that. For
      // anyone else this check is false and the branch does nothing —
      // existing Lily behavior for every other shop member is completely
      // unchanged, exactly as before this pass.
      if (isPersonalBrandDomain(routed) && isFeatureEnabled("MARKETING_STUDIO") && (await isRequestingUserPlatformSuperAdmin(user.id))) {
        const personalBrandPermission = checkLilyPermission("marketing.generate", membership?.role || role, { isPlatformAdmin: false });
        if (personalBrandPermission.allowed) {
          const conversationAsset = await findLastPersonalBrandConceptAsset(client, shopId);
          const pbResult = await runPersonalBrandCommand(client, {
            shopId,
            userId: user.id,
            message,
            conversationAssetId: conversationAsset?.id || null
          });
          // The false-positive safety net (Section 3): classifyRequest()
          // already said domain=personal_brand, but if
          // classifyPersonalBrandCommand() — the detailed, independent
          // second-stage classifier — finds nothing actionable, fall
          // through to Lily's ordinary chat reply below rather than a
          // dead-end response.
          if (isPersonalBrandResultActionable(pbResult)) {
            const responseText = formatPersonalBrandResponse(pbResult);
            await logAction(client, {
              userId: user.id,
              shopId,
              intent: "personal_brand.command",
              actionType: "job",
              result: "completed",
              metadata: { mode: pbResult.classification?.mode || null, asset_id: pbResult.asset?.id || null, digital_twin_attempted: Boolean(pbResult.digitalTwin?.attempted) }
            });
            const convId = await ensureConversation(client, { conversationId, userId: user.id, shopId, message });
            if (convId) {
              await persistMessage(client, { conversationId: convId, userId: user.id, shopId, role: "user", content: message, metadata: { intent: "personal_brand.command" } });
              await persistMessage(client, { conversationId: convId, userId: user.id, shopId, role: "assistant", content: responseText, metadata: { asset_id: pbResult.asset?.id || null } });
            }
            return json(200, {
              conversation_id: convId,
              intent: { domain: "personal_brand", intent: "personal_brand.command", confidence: 0.9, slots: pbResult.classification },
              permission: personalBrandPermission,
              response: responseText,
              client_action: null,
              generate: null,
              job: null,
              personal_brand: pbResult,
              coach: buildCoachSuggestions(context),
              stream: false
            });
          }
        }
      }

      // Shop style memory: an explicit standing statement ("I like soft
      // luxury backgrounds") writes immediately — regardless of whether
      // this same message also asks for a job — never a one-time override.
      // See ai-style-memory.js's docstring for the explicit-vs-inferred
      // distinction classifyRequest()'s preference_statement flag enforces.
      let preferenceAck = null;
      if (routed?.preference_statement && routed.preference_updates?.length) {
        const { preferences: currentPrefs } = await loadStyleMemory(client, shopId);
        const nextPrefs = applyExplicitPreferenceUpdates(currentPrefs, routed.preference_updates);
        await saveStyleMemory(client, shopId, nextPrefs);
        preferenceAck = describePreferenceAck(routed.preference_updates);
      }

      const runsJob = shouldRunJob(routed);

      if (runsJob) {
        const marketingPermission = checkLilyPermission("marketing.generate", membership?.role || role, { isPlatformAdmin: false });
        if (!marketingPermission.allowed) {
          const denied = "I can help with that, but your Florisyn role does not allow this action. Ask a shop owner or manager if you need access.";
          return json(200, {
            conversation_id: conversationId,
            intent: { domain: routed.domain, intent: `marketing.${routed.action_type}`, confidence: 0.9, slots: routed },
            permission: marketingPermission,
            response: denied,
            client_action: null,
            generate: null,
            job: null,
            coach: buildCoachSuggestions(context),
            stream: false
          });
        }

        // AI-OS Wave 5: this job runs as its real author, not necessarily
        // the persona the florist happens to be chatting with — see
        // resolveJobPersona()'s docstring.
        const { author: jobAuthor, delegated: jobDelegated } = resolveJobPersona(persona, routed.domain);

        // Photo-domain-only: the shop's learned style (priority: current
        // message > saved style > generic defaults, enforced inside
        // buildVisualBrief()) and the visual this conversation was already
        // working on, if any — so "make it bigger" or a fresh "change the
        // background" both chain onto it via parent_asset_id instead of
        // starting a disconnected new asset.
        let styleSummary = null;
        let parentAssetId = typeof body.parent_asset_id === "string" ? body.parent_asset_id : priorVisual?.assetId || null;
        if (routed.domain === "photo") {
          const { preferences: currentPrefs } = await loadStyleMemory(client, shopId);
          styleSummary = buildStyleSummary(currentPrefs);
          if (!parentAssetId) {
            const found = await findLastVisualAsset(client, { shopId, conversationId });
            parentAssetId = found?.assetId || null;
          }
        }

        const ran = await runJob(client, {
          shopId,
          userId: user.id,
          persona: jobAuthor,
          routed,
          requestText: message,
          shop: context.shop,
          inventory: context.inventory,
          conversationId,
          parentAssetId,
          revisionDeltas: routed.visual_op === "revise" ? deterministicDeltas : null,
          styleSummary
        });

        let responseText = ran.ok
          ? jobDelegated
            ? formatDelegatedAnswer(jobAuthor, persona, formatJobResponse(ran.job, { requestSummary: routed.summary }))
            : formatJobResponse(ran.job, { requestSummary: routed.summary })
          : `I ran into a problem starting that: ${ran.error}`;
        if (preferenceAck) responseText = `${preferenceAck}\n\n${responseText}`;

        await logAction(client, {
          userId: user.id,
          shopId,
          intent: `marketing.${routed.action_type}`,
          actionType: "job",
          result: ran.ok ? ran.job.status : "failed",
          metadata: { domain: routed.domain, channels: routed.channels, job_id: ran.job?.id || null, answered_by: jobDelegated ? jobAuthor : null }
        });

        const convId = await ensureConversation(client, { conversationId, userId: user.id, shopId, message });
        if (convId) {
          await persistMessage(client, { conversationId: convId, userId: user.id, shopId, role: "user", content: message, metadata: { intent: `marketing.${routed.action_type}` } });
          await persistMessage(client, { conversationId: convId, userId: user.id, shopId, role: "assistant", content: responseText, metadata: { job_id: ran.job?.id || null, answered_by: jobDelegated ? jobAuthor : null } });
        }

        return json(200, {
          conversation_id: convId,
          intent: { domain: routed.domain, intent: `marketing.${routed.action_type}`, confidence: 0.9, slots: routed },
          permission: marketingPermission,
          response: responseText,
          // Real programmatic delegation (AI-OS Wave 5) — set only when
          // another persona actually authored this job's content.
          answered_by: jobDelegated ? jobAuthor : null,
          client_action: null,
          generate: null,
          job: ran.ok ? ran.job : null,
          video_provider: routed.action_type === "video" ? getVideoProvider().name : undefined,
          coach: buildCoachSuggestions(context),
          stream: false
        });
      }

      if (preferenceAck) {
        // A standing style statement with nothing else to do this turn (no
        // job requested) — acknowledge it directly rather than routing a
        // real preference save through the generic chat model, which could
        // paraphrase or second-guess something that's already been saved.
        await logAction(client, {
          userId: user.id,
          shopId,
          intent: "photo.preference",
          actionType: "preference",
          result: "saved",
          metadata: { updates: routed.preference_updates }
        });
        const convId = await ensureConversation(client, { conversationId, userId: user.id, shopId, message });
        if (convId) {
          await persistMessage(client, { conversationId: convId, userId: user.id, shopId, role: "user", content: message, metadata: { intent: "photo.preference" } });
          await persistMessage(client, { conversationId: convId, userId: user.id, shopId, role: "assistant", content: preferenceAck, metadata: {} });
        }
        return json(200, {
          conversation_id: convId,
          intent: { domain: routed.domain, intent: "photo.preference", confidence: 0.9, slots: routed },
          permission,
          response: preferenceAck,
          client_action: null,
          generate: null,
          job: null,
          coach: buildCoachSuggestions(context),
          stream: false
        });
      }
    }

    let generate = null;
    if (body.action === "product-generate" || intent.intent === "product_ai.generate") {
      if (!permission.allowed) {
        return json(403, { error: "You do not have permission to run product AI." });
      }
      generate = {
        mode: "product",
        schema: {
          title: "string",
          description: "string",
          seo_title: "string",
          seo_description: "string",
          tags: ["string"],
          category: "string",
          keywords: ["string"],
          suggested_price: "number",
          variants: [{ name: "string", sku: "string", price: "number" }]
        },
        task: "Generate wholesale/florist product listing fields from seller input",
        input: { prompt: message || body.prompt, fields: body.fields || {}, shop: context.shop }
      };
    }
    // marketing.generate is no longer produced by detectIntent() (see
    // lily-ai-engine.js) — real marketing creation now runs through the
    // classifyRequest()/runJob() branch above, which returns a finished,
    // persisted asset instead of a bare generate directive for the client
    // to complete on its own.

    // Marketplace vision: "Lily should use REAL marketplace information.
    // Never invent supplier availability or pricing." — a real DB search
    // against marketplace_listings composed into a deterministic answer,
    // never handed to the freeform LLM chat path where pricing/
    // availability could be paraphrased into something that isn't real.
    if (intent.intent === "marketplace.search" && permission.allowed && intent.slots.flowers?.length) {
      const matches = await searchMarketplaceForLily(client, intent.slots.flowers);
      planned.message = buildMarketplaceSourcingAnswer(matches, intent.slots.flowers);
    }

    // AI-OS Wave 4: for the domains that unambiguously belong to one
    // specialist, actually get that specialist's real answer in this same
    // turn — through the exact shared cloudflareChat() any persona uses —
    // instead of leaving the florist with a generic placeholder and a
    // suggestion they have to tap before getting real content.
    let responseText = null;
    let answeredBy = null;
    const delegateTo = shouldDelegate({ persona, intentDomain: intent.domain, permission, planned });
    if (delegateTo && !personaDisabled(delegateTo, context.ai_profile)) {
      const delegatedAnswer = await cloudflareChat(delegateTo, message, context);
      if (delegatedAnswer) {
        responseText = formatDelegatedAnswer(delegateTo, persona, delegatedAnswer);
        answeredBy = delegateTo;
      }
    }

    if (responseText == null) responseText = buildResponseMessage(intent, permission, planned, confirmed);
    if (responseText == null) {
      if (personaDisabled(persona, context.ai_profile)) {
        // A shop can turn a persona off (ai_shop_profiles.lily_enabled /
        // rose_enabled); say so plainly instead of quietly answering anyway.
        responseText = `${normalizePersona(persona)} is turned off for this shop right now. Contact Florisyn support if you'd like her re-enabled.`;
      } else {
        // Conversational turn (general chat): answer with the real model, persona-aware,
        // instead of a static template. Falls back to the template if AI is unavailable.
        const aiAnswer = permission.allowed ? await cloudflareChat(persona, message, context) : null;
        responseText = aiAnswer ||
          `I understand you want help with ${intent.domain.replace("_", " ")}. I can chat, suggest next steps, and prepare actions for your confirmation.`;
      }
    }

    // Option A: when the topic sits in another persona's lane, gently suggest a
    // handoff (never blocks the answer or action). Front-end can offer a one-tap switch.
    // Skipped when this turn already delegated — the specialist just answered
    // directly, so suggesting a switch to reach them again would be redundant.
    const handoff = !answeredBy && permission.allowed ? suggestHandoff(persona, intent.domain, message) : null;
    if (handoff && responseText) responseText += handoff.line;

    await logAction(client, {
      userId: user.id,
      shopId,
      intent: intent.intent,
      actionType: planned?.type || "chat",
      result: permission.allowed ? (confirmed ? "confirmed" : "planned") : "denied",
      metadata: { domain: intent.domain, confidence: intent.confidence }
    });

    const convId = await ensureConversation(client, { conversationId, userId: user.id, shopId, message });

    if (convId) {
      await persistMessage(client, {
        conversationId: convId,
        userId: user.id,
        shopId,
        role: "user",
        content: message,
        metadata: { intent: intent.intent }
      });
      await persistMessage(client, {
        conversationId: convId,
        userId: user.id,
        shopId,
        role: "assistant",
        content: responseText,
        metadata: { planned, permission: permission.allowed, answered_by: answeredBy }
      });
    }

    return json(200, {
      conversation_id: convId,
      intent,
      permission,
      response: responseText,
      // Real programmatic delegation (AI-OS Wave 4) — set only when another
      // persona actually wrote this answer, so the client can attribute it
      // honestly without permanently switching who the florist is chatting with.
      answered_by: answeredBy,
      handoff: handoff ? { to: handoff.to, label: handoff.label } : null,
      client_action: permission.allowed && (!planned?.requiresConfirmation || confirmed) ? planned : planned?.requiresConfirmation && !confirmed ? { ...planned, pending: true } : null,
      generate,
      coach: buildCoachSuggestions(context),
      stream: false
    });
  } catch (error) {
    return fail(error);
  }
}
