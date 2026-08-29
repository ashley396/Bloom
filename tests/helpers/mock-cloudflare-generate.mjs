/**
 * A single global fetch mock that answers BOTH shapes Cloudflare's API is
 * called with from this codebase — an image-generation call
 * (ai-image-engine.js) and a structured JSON chat-completion call
 * (runCloudflareGenerate in ai-assistant.js, used by generateSocialPost /
 * generateFlyerContent / etc.).
 *
 * Both call types hit the IDENTICAL URL pattern —
 * https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}
 * — differing only in the model slug and the request body shape, so this
 * cannot discriminate by URL. Instead it inspects the outgoing request body:
 * a chat/text call's body is `{messages:[...], max_tokens, temperature}`
 * (confirmed at ai-assistant.js's runCloudflareGenerate fetch call) — an
 * image-generation call's body has no `messages` key.
 *
 * Needed once revise_content's "image" branch could call EITHER or BOTH in
 * one request (an ambiguous instruction now revises the caption too, not
 * only the photo): a test using only the single-purpose mockImageGen/
 * mockSocialPostGen helper would have the SECOND call receive the wrong
 * shape and silently fail to parse, turning a real revision into a 400 with
 * no clue why.
 */
const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

/**
 * @param {object} jsonResult - the parsed object generateSocialPost /
 *   generateFlyerContent should receive back from its structured call.
 */
export function mockCloudflareGenerate(jsonResult) {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    let isTextCall = false;
    try {
      const body = JSON.parse(options?.body || "{}");
      isTextCall = Array.isArray(body.messages);
    } catch {
      isTextCall = false;
    }
    if (isTextCall) {
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) };
    }
    return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
  };
  return { restore: () => (globalThis.fetch = originalFetch) };
}
