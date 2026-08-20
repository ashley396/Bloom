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

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const { client, user, shopId, role, membership } = await currentUser(event);
    const body = bodyOf(event);
    const message = String(body.message || body.prompt || "").trim();
    const confirmed = Boolean(body.confirm);
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

    if (!message && !["product-generate", "coach", "history-search"].includes(body.action)) {
      return json(400, { error: "Add a message for Lily." });
    }

    const intent = detectIntent(message);
    const permission = checkLilyPermission(intent.intent, membership?.role || role, { isPlatformAdmin: false });
    const planned = planClientAction(intent.intent, intent.slots);
    const context = await loadAiContext(client, shopId);

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
    } else if (intent.intent === "marketing.generate" && permission.allowed) {
      generate = {
        mode: "marketing",
        task: `Write ${intent.slots.channel} marketing copy`,
        input: { prompt: message, shop: context.shop },
        schema: { text: "string", headline: "string", cta: "string" }
      };
    }

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
