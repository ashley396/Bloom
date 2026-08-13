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
import { systemPromptFor, suggestHandoff } from "./_shared/florist-ai-personas.js";

const CONVERSATIONS = "lily_conversations";
const MESSAGES = "lily_messages";
const AUDIT = "lily_action_audit";

function isMissingTableError(error) {
  if (!error) return false;
  const message = String(error.message || error.details || "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find the table");
}

async function loadAiContext(client, shopId) {
  const [{ data: shop }, { data: inventory }, { data: orders }, { data: deliveries }] = await Promise.all([
    client.from("shops").select("name,address,phone,tagline").eq("id", shopId).maybeSingle(),
    client.from("inventory").select("name,color,quantity,low_stock_level,cost,price").eq("shop_id", shopId).is("deleted_at", null).order("created_at", { ascending: false }).limit(40),
    client.from("orders").select("order_number,customer_name,total,payment_status,delivery_date,status,estimated_cost").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(20),
    client.from("deliveries").select("status,recipient_name,address,delivery_date").eq("shop_id", shopId).order("delivery_date", { ascending: true }).limit(15)
  ]);
  return { shop: shop || {}, inventory: inventory || [], recent_orders: orders || [], deliveries: deliveries || [] };
}

const AI_CHAT_MODEL = process.env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";

/**
 * Real conversational answer from Cloudflare Workers AI (persona-aware). Returns
 * null on any failure so the caller can fall back to a safe template.
 * Persona identity comes from the single shared source (florist-ai-personas.js).
 */
async function cloudflareChat(persona, message, context) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_API_TOKEN;
  if (!account || !token || !message) return null;
  const system = `${systemPromptFor(persona, "chat")} Never claim an action was saved, published, paid, ordered, or completed unless Florisyn confirms it. Your suggestions are editable and need florist approval. Protect private employee and customer information.`;
  const ctx = JSON.stringify({
    shop: context.shop || {},
    inventory: (context.inventory || []).slice(0, 15),
    recent_orders: (context.recent_orders || []).slice(0, 8),
    upcoming_deliveries: (context.deliveries || []).slice(0, 8)
  }).slice(0, 8000);
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${AI_CHAT_MODEL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: `My shop's current context (for reference only): ${ctx}\n\nMy question: ${message}` }
        ],
        max_tokens: 500,
        temperature: 0.4
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.success) return null;
    const answer = String(data.result?.response || data.result?.result || "").trim();
    return answer || null;
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

function buildResponseMessage(intent, permission, planned, confirmed) {
  if (!permission.allowed) {
    return "I can help with that, but your Florisyn role does not allow this action. Ask a shop owner or manager if you need access.";
  }
  if (planned?.message) return planned.message;
  if (planned?.requiresConfirmation && !confirmed) {
    return `I can ${planned.label || "do that"}. Confirm below and I will guide Florisyn — I will not change anything without your approval.`;
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

    let responseText = buildResponseMessage(intent, permission, planned, confirmed);
    if (responseText == null) {
      // Conversational turn (general chat): answer with the real model, persona-aware,
      // instead of a static template. Falls back to the template if AI is unavailable.
      const aiAnswer = permission.allowed ? await cloudflareChat(persona, message, context) : null;
      responseText = aiAnswer ||
        `I understand you want help with ${intent.domain.replace("_", " ")}. I can chat, suggest next steps, and prepare actions for your confirmation.`;
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
