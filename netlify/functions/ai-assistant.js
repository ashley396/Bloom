import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser } from "./_shared/supabase.js";
import { normalizePersona } from "./_shared/florist-ai-personas.js";
import {
  runTextChat,
  extractCloudflareText,
  compact,
  safeText,
  jsonWithinLimit,
} from "./_shared/ai-provider.js";
import { cloudflareAiToken } from "../../lib/ai/provider-config.js";

export { cloudflareAiToken, extractCloudflareText, compact, safeText, jsonWithinLimit };

function cleanJson(text) {
  const raw = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** Shared Cloudflare generate/chat entry for other Netlify handlers. */
export async function runCloudflareGenerate(payload, env = process.env) {
  const persona = normalizePersona(payload.persona);
  const mode = payload.mode === "generate" ? "generate" : "chat";
  if (mode === "generate") {
    const result = await runTextChat({
      persona,
      prompt: `Task: ${payload.task || "Generate content"}\nInput: ${JSON.stringify(payload.input || {})}\nReturn ONLY valid JSON matching: ${JSON.stringify(payload.schema || { text: "result" })}`,
      context: payload.context || {},
      history: payload.history || [],
      mode: "generate",
      maxTokens: payload.max_tokens,
      env,
    });
    return {
      result: cleanJson(result.answer) || { text: result.answer },
      provider: result.provider,
      model: result.model,
      promptChars: result.promptChars,
    };
  }
  return runTextChat({
    persona,
    prompt: payload.prompt,
    context: payload.context || {},
    history: payload.history || [],
    mode: "chat",
    maxTokens: payload.max_tokens,
    env,
  });
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  try {
    await currentUser(event);
    const payload = bodyOf(event);
    if (!payload.prompt && !payload.task) return json(400, { error: "Add a prompt or task." });
    const out = await runCloudflareGenerate(payload);
    if (payload.mode === "generate") return json(200, out);
    return json(200, out);
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || "AI unavailable" });
  }
}
