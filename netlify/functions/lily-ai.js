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
import { normalizePersona, shopVoiceSuffix, suggestHandoff } from "./_shared/florist-ai-personas.js";
import { runCloudflareGenerate } from "./ai-assistant.js";
import { searchMarketplaceForLily, buildMarketplaceSourcingAnswer } from "./_shared/marketplace-lily-sourcing.js";
import { classifyRequest } from "./_shared/ai-intent-router.js";
import { runJob, retryJobStep } from "./_shared/ai-orchestrator.js";
import { getVideoProvider } from "./_shared/ai-video-provider.js";

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
    await client.from(CONVERSATIONS).update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  } catch {
    // Tables may not exist until migration is applied.
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
    const conversationId = body.conversation_id || null;
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
      const retried = await retryJobStep(client, {
        shopId,
        userId: user.id,
        persona: normalizePersona(persona),
        jobId: body.job_id,
        stepId: body.step_id
      });
      if (!retried.ok) return json(422, { error: retried.error });
      return json(200, {
        job: retried.job,
        response: formatJobResponse(retried.job)
      });
    }

    if (!message && !["product-generate", "coach", "history-search"].includes(body.action)) {
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
      const routed = await classifyRequest(message);
      if (routed && ["create", "campaign", "video"].includes(routed.action_type)) {
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

        const ran = await runJob(client, {
          shopId,
          userId: user.id,
          persona: normalizePersona(persona),
          routed,
          requestText: message,
          shop: context.shop,
          inventory: context.inventory
        });

        const responseText = ran.ok
          ? formatJobResponse(ran.job, { requestSummary: routed.summary })
          : `I ran into a problem starting that: ${ran.error}`;

        await logAction(client, {
          userId: user.id,
          shopId,
          intent: `marketing.${routed.action_type}`,
          actionType: "job",
          result: ran.ok ? ran.job.status : "failed",
          metadata: { domain: routed.domain, channels: routed.channels, job_id: ran.job?.id || null }
        });

        let convId = conversationId;
        if (!convId) {
          try {
            const { data } = await client
              .from(CONVERSATIONS)
              .insert({ user_id: user.id, shop_id: shopId, title: message.slice(0, 80) || "Lily chat" })
              .select("id")
              .single();
            convId = data?.id || null;
          } catch {
            /* Tables may not exist until migration is applied. */
          }
        }
        if (convId) {
          await persistMessage(client, { conversationId: convId, userId: user.id, shopId, role: "user", content: message, metadata: { intent: `marketing.${routed.action_type}` } });
          await persistMessage(client, { conversationId: convId, userId: user.id, shopId, role: "assistant", content: responseText, metadata: { job_id: ran.job?.id || null } });
        }

        return json(200, {
          conversation_id: convId,
          intent: { domain: routed.domain, intent: `marketing.${routed.action_type}`, confidence: 0.9, slots: routed },
          permission: marketingPermission,
          response: responseText,
          client_action: null,
          generate: null,
          job: ran.ok ? ran.job : null,
          video_provider: routed.action_type === "video" ? getVideoProvider().name : undefined,
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

    let responseText = buildResponseMessage(intent, permission, planned, confirmed);
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
    const handoff = permission.allowed ? suggestHandoff(persona, intent.domain, message) : null;
    if (handoff && responseText) responseText += handoff.line;

    await logAction(client, {
      userId: user.id,
      shopId,
      intent: intent.intent,
      actionType: planned?.type || "chat",
      result: permission.allowed ? (confirmed ? "confirmed" : "planned") : "denied",
      metadata: { domain: intent.domain, confidence: intent.confidence }
    });

    let convId = conversationId;
    if (!convId) {
      try {
        const { data } = await client
          .from(CONVERSATIONS)
          .insert({ user_id: user.id, shop_id: shopId, title: message.slice(0, 80) || "Lily chat" })
          .select("id")
          .single();
        convId = data?.id || null;
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
      }
    }

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
        metadata: { planned, permission: permission.allowed }
      });
    }

    return json(200, {
      conversation_id: convId,
      intent,
      permission,
      response: responseText,
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
