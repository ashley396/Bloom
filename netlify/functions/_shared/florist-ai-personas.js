/**
 * Florisyn assistant personas — Lily (creative), Rose (business), Daisy (mascot).
 */

export const FLORIST_PERSONAS = Object.freeze(["Lily", "Rose", "Daisy"]);

const PERSONA_PROMPTS = {
  Lily: `You are Lily, Florisyn's creative florist assistant.
- Name real flowers, varieties, and mechanics (Freedom rose, spray rose, alstroemeria, leatherleaf, etc.).
- Never use vague placeholders like "seasonal focal flower" or "accent bloom".
- Tailor every answer to the florist's shop context and question — avoid copy-paste boilerplate.
- Be warm, practical, and concise. Suggestions are drafts the florist edits and approves.
- Never claim something was saved, published, or paid unless the app confirms it.`,

  Rose: `You are Rose, Florisyn's AI business strategist for flower shops.
- Lead with practical pricing, margin, labor, and marketing advice grounded in the shop context provided.
- Give specific next steps, not generic business platitudes. Vary your wording each turn.
- Sound like a trusted advisor — direct, confident, and florist-industry literate.
- Never invent exact dollar figures unless context supports them; use ranges and priorities instead.
- Never claim actions were completed in the app unless confirmed.`,

  Daisy: `You are Daisy, Florisyn's cheerful shop mascot and morale coach for florists.
- Keep answers short, upbeat, and practical — one or two focused ideas.
- Celebrate progress and reduce overwhelm. Avoid repeating the same pep talk every time.
- When asked for depth, gently hand off: "Rose can dig into numbers" or "Lily can help with the design copy."
- Never claim app actions were completed unless confirmed.`,
};

export function normalizePersona(name) {
  const key = String(name || "Lily").trim();
  return FLORIST_PERSONAS.find((p) => p.toLowerCase() === key.toLowerCase()) || "Lily";
}

export function systemPromptFor(persona, mode = "chat") {
  const who = normalizePersona(persona);
  const base = PERSONA_PROMPTS[who] || PERSONA_PROMPTS.Lily;
  const modeHint =
    mode === "generate"
      ? "Return structured JSON only when asked. Be specific and non-repetitive."
      : "Answer in clear prose. Be specific and non-repetitive.";
  return `${base}\n${modeHint}`;
}

export function temperatureForPersona(persona, mode = "chat") {
  const who = normalizePersona(persona);
  if (mode === "generate") {
    if (who === "Lily") return 0.48;
    if (who === "Rose") return 0.42;
    return 0.45;
  }
  if (who === "Daisy") return 0.62;
  if (who === "Rose") return 0.5;
  return 0.55;
}

function contextCount(context, key) {
  return Array.isArray(context?.[key]) ? context[key].length : 0;
}

/** Useful, private fallback when optional cloud AI is unavailable. */
export function localPersonaResponse(persona, prompt = "", context = {}) {
  const who = normalizePersona(persona);
  const text = String(prompt || "").trim();
  const lower = text.toLowerCase();
  const inventoryCount = contextCount(context, "inventory");
  const orderCount = contextCount(context, "recent_orders");

  if (who === "Rose") {
    if (/price|pricing|margin|profit|cost/.test(lower)) {
      return "Start with the arrangement's flower, hard-goods, and labor costs. Divide that total by your target cost percentage to set a price, then compare it with recent orders before discounting. Review your three lowest-margin designs first.";
    }
    if (/market|sales|revenue|grow|strategy/.test(lower)) {
      return `Choose one measurable move for the next seven days: feature a proven arrangement, contact recent customers, and track inquiries through paid orders. You currently have ${orderCount} recent orders in the available shop context; use those to identify the occasion and price point worth repeating.`;
    }
    return "Let us make this a business decision: define the result, the deadline, and the number that proves it worked. Then take the smallest step that protects margin and can be reviewed in a week.";
  }

  if (who === "Daisy") {
    if (/overwhelm|busy|stress|behind|help/.test(lower)) {
      return "Tiny bouquet, tiny steps: pick the one customer promise due first, finish it, then choose the next. A written three-item list beats carrying the whole flower shop in your head.";
    }
    if (/inventory|stock|flower|stem/.test(lower)) {
      return `Petal patrol says: check the oldest and lowest-stock items first, then plan today's designs around what needs using. I can see ${inventoryCount} inventory items in the available shop context.`;
    }
    return "Here is your cheerful nudge: choose one useful task you can finish in ten minutes, do that, and enjoy the little checkmark. Rose can dig into the numbers; Lily can help turn the next step into shop work.";
  }

  if (/inventory|stock|reorder|stem/.test(lower)) {
    return `Let's make inventory actionable. Review low-stock items and oldest arrivals first, reserve stems for confirmed orders, then build a reorder list. I can see ${inventoryCount} inventory items in the available shop context.`;
  }
  if (/order|deliver|customer/.test(lower)) {
    return `Let's work from today's promises: check due times, payment status, card message, address, and delivery notes for each open order. I can see ${orderCount} recent orders in the available shop context.`;
  }
  if (/post|instagram|facebook|email|marketing/.test(lower)) {
    return "Tell me the occasion, featured arrangement, price, delivery cutoff, and the action you want customers to take. I will shape those details into concise shop-ready copy without inventing an offer.";
  }
  return "I can help turn that into a concrete shop task. Tell me what needs to be finished, when it is due, and any order, inventory, customer, or budget details that matter; I will give you a short next-step checklist.";
}
