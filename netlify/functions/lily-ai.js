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
import { runTextChat } from "./_shared/ai-provider.js";
import { aiUnavailableMessage } from "../../lib/ai/provider-config.js";

async function loadConversationHistory(client, conversationId, userId, shopId, limit = 12) {
  if (!conversationId) return [];
  try {
    const { data: conv } = await client
      .from(CONVERSATIONS)
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (!conv) return [];
    const { data: msgs } = await client
      .from(MESSAGES)
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(limit);
    return (msgs || [])
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content).slice(0, 2000),
      }));
  } catch {
    return [];
  }
}

async function summarizeMemory(client, conversationId, userId, shopId) {
  const history = await loadConversationHistory(client, conversationId, userId, shopId, 20);
  if (history.length < 8) return null;
  try {
    const summary = await runTextChat({
      persona: "Lily",
      prompt: `Summarize this florist shop conversation in 3 bullet points for future context. Keep flower names and decisions.\n${history.map((h) => `${h.role}: ${h.content}`).join("\n")}`,
      context: {},
      history: [],
      mode: "chat",
      maxTokens: 220,
    });
    return summary.answer?.slice(0, 1200) || null;
  } catch {
    return null;
  }
}

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
    client.from("inventory").select("name,color,quantity,low_stock_level,cost,price").eq("shop_id", shopId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(40),
    client.from("orders").select("order_number,customer_name,total,payment_status,delivery_date,status,estimated_cost").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(20),
    client.from("deliveries").select("status,recipient_name,address,scheduled_date").eq("shop_id", shopId).order("scheduled_date", { ascending: true }).limit(15)
  ]);
  return { shop: shop || {}, inventory: inventory || [], recent_orders: orders || [], deliveries: deliveries || [] };
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

function shouldUseGenerativeChat(intent, planned) {
  if (intent.intent === "general.chat") return true;
  if (intent.intent === "coach.business" && !planned?.type) return true;
  if (intent.intent === "florist.photo_placeholder") return false;
  if (planned?.type === "navigate" || planned?.type === "api" || planned?.requiresConfirmation) return false;
  if (intent.confidence < 0.72 && !planned?.message) return true;
  return false;
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

    if (event.httpMethod === "POST" && body.action === "history-search") {
      const history = Array.isArray(body.history) ? body.history.map(sanitizeHistoryEntry) : [];
      return json(200, { results: searchHistory(history, body.query) });
    }

    if (event.httpMethod === "POST" && body.action === "coach") {
      const context = await loadAiContext(client, shopId);
      return json(200, { suggestions: buildCoachSuggestions(context) });
    }

    if (event.httpMethod === "POST" && body.action === "clear-memory") {
      if (conversationId) {
        try {
          await client.from(MESSAGES).delete().eq("conversation_id", conversationId).eq("user_id", user.id).eq("shop_id", shopId);
          await client.from(CONVERSATIONS).delete().eq("id", conversationId).eq("user_id", user.id).eq("shop_id", shopId);
        } catch {
          /* optional tables */
        }
      }
      return json(200, { cleared: true });
    }

    if (!message && !["product-generate", "coach", "history-search", "clear-memory"].includes(body.action)) {
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

    let responseText =
      buildResponseMessage(intent, permission, planned, confirmed) ||
      `I understand you want help with ${intent.domain.replace(/_/g, " ")}. I can chat, suggest next steps, and prepare actions for your confirmation.`;

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
              detail: String(error.message || error).slice(0, 200),
            })
          );
        }
      }
    }

    if (permission.allowed && shouldUseGenerativeChat(intent, planned) && message) {
      const history = await loadConversationHistory(client, convId, user.id, shopId);
      const memorySummary = convId ? await summarizeMemory(client, convId, user.id, shopId) : null;
      const enrichedContext = memorySummary ? { ...context, conversation_summary: memorySummary } : context;
      try {
        const persona = body.persona === "Rose" ? "Rose" : body.persona === "Daisy" ? "Daisy" : "Lily";
        const ai = await runTextChat({
          persona,
          prompt: message,
          context: enrichedContext,
          history,
          mode: "chat",
        });
        if (ai.answer) responseText = ai.answer;
      } catch (aiError) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "lily_generative_chat_fallback",
            detail: String(aiError.message || aiError).slice(0, 200),
          })
        );
        if (intent.intent === "general.chat") {
          responseText = aiUnavailableMessage(String(aiError.message || ""));
        }
      }
    }

    await logAction(client, {
      userId: user.id,
      shopId,
      intent: intent.intent,
      actionType: planned?.type || "chat",
      result: permission.allowed ? (confirmed ? "confirmed" : "planned") : "denied",
      metadata: { domain: intent.domain, confidence: intent.confidence }
    });

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
      client_action: permission.allowed && (!planned?.requiresConfirmation || confirmed) ? planned : planned?.requiresConfirmation && !confirmed ? { ...planned, pending: true } : null,
      generate,
      coach: buildCoachSuggestions(context),
      stream: false
    });
  } catch (error) {
    return fail(error);
  }
}
