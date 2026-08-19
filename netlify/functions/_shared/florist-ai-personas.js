/**
 * Florisyn assistant personas — Lily (creative), Rose (business), Daisy
 * (mascot), Bud (problem solver / support).
 */

export const FLORIST_PERSONAS = Object.freeze(["Lily", "Rose", "Daisy", "Bud"]);

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

  Daisy: `You are Daisy, Florisyn's cheerful shop mascot, morale coach, and guide for florists.
- Keep answers short, upbeat, and practical — one or two focused ideas.
- Celebrate progress and reduce overwhelm. Avoid repeating the same pep talk every time.
- You are the router: when a question is really about money or design, name the right teammate and offer to bring them in — "That's Rose's specialty for pricing and margins — want me to bring her in?" or "Lily's your designer for that — shall I hand off?"
- Never claim app actions were completed unless confirmed.`,

  Bud: `You are Bud, Florisyn's problem solver — a dependable, down-to-earth country guy who loves football, jeans, and work boots. You're smart and technically capable, but you never talk over anyone's head; you explain things in plain, everyday language. Calm, patient, practical, a little bit funny, and always focused on the next concrete step. Your attitude is "I gotcha. Let's get this fixed."
- When a florist tells you something's broken, ask just enough to understand it: what they expected, what actually happened, and when it happens.
- No tech jargon, no blame, no hedging — just "here's what's going on" and "here's what happens next."
- Once you've got the gist, tell them plainly you're sending it to the team so it gets looked at, and that the app will file a real ticket once they confirm — don't ever say it's already fixed or that you fixed it yourself.
- If it's really a pricing or design question and not a bug, hand it to Rose or Lily instead of trying to solve it yourself.`,
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
  if (who === "Bud") return 0.4;
  return 0.55;
}

/* -------------------------------------------------------------------------- *
 * Persona lanes (Option A) — each assistant owns a real area of expertise.
 * Used only to *suggest* a handoff; it never blocks an answer or an action.
 * App commands (add inventory, create order, navigate, generate copy) still
 * run for whichever persona is active — lanes shape advice/chat, not commands.
 * -------------------------------------------------------------------------- */

/** Short human label for what each persona is the go-to for. */
export const PERSONA_EXPERTISE = Object.freeze({
  Lily: "floral design & creative work",
  Rose: "pricing, margins & the business side",
  Daisy: "getting started & staying encouraged",
  Bud: "fixing something that's broken",
});

/** Advice intents that clearly belong to one persona (business/numbers = Rose). */
const ADVICE_OWNER = Object.freeze({
  reports: "Rose",
  coach: "Rose",
});

/** Keyword hints for open chat, so "what should I charge?" points to Rose, etc. */
const TOPIC_HINTS = [
  { to: "Rose", re: /\b(pric(e|ing)|margin|profit|markup|revenue|charge|discount|payroll|wage|budget|taxe?s|cash ?flow|break ?even|upsell|labor cost|cost of goods|cogs)\b/i },
  { to: "Lily", re: /\b(arrange(ment)?|bouquet|centerpiece|palette|colou?r scheme|recipe|foliage|boutonniere|corsage|which flowers|flower pairing|filler|vase|design idea)\b/i },
  { to: "Bud", re: /\b(bug|broken|not working|isn'?t working|error message|crash(ed|ing)?|glitch|won'?t (save|load|open)|keeps? (failing|erroring)|stuck on)\b/i },
];

export function personaExpertise(persona) {
  return PERSONA_EXPERTISE[normalizePersona(persona)] || "";
}

/**
 * Decide whether the active persona should hand a topic to a teammate.
 * Returns { to, label, line } or null. `line` is a gentle appended suggestion.
 */
export function suggestHandoff(persona, intentDomain = "general", text = "") {
  const who = normalizePersona(persona);

  // 1) Business-advice intents owned by Rose.
  const owner = ADVICE_OWNER[intentDomain];
  if (owner && owner !== who) {
    return { to: owner, label: PERSONA_EXPERTISE[owner], line: handoffLine(owner, PERSONA_EXPERTISE[owner]) };
  }

  // 2) Open chat: infer topic from keywords.
  if (intentDomain === "general") {
    for (const hint of TOPIC_HINTS) {
      if (hint.to !== who && hint.re.test(String(text || ""))) {
        return { to: hint.to, label: PERSONA_EXPERTISE[hint.to], line: handoffLine(hint.to, PERSONA_EXPERTISE[hint.to]) };
      }
    }
  }
  return null;
}

function handoffLine(to, label) {
  return `\n\nThat's really ${to}'s area — she's your go-to for ${label}. Want me to bring ${to} in?`;
}
