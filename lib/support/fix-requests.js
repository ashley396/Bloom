import crypto from "node:crypto";

/**
 * Bud's Fix Queue intake — authentication + payload validation (pure).
 * See netlify/functions/claude-code-fix-intake.js for the handler that
 * uses this, and docs/FLORISYN_AI_AGENT_AUTONOMY_POLICY.md for what
 * happens to a request once it's queued.
 */

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/**
 * This endpoint is server-to-server only — it's the receiving end of
 * admin-command-center.js's "Request Claude Code fix" webhook call, never
 * a florist's own session. Fails closed both ways: no configured token
 * means the endpoint refuses everything (503), and a missing/wrong
 * bearer token is rejected (401) rather than silently accepted.
 */
export function verifyFixIntakeToken(headers = {}, env = process.env) {
  const configured = String(env.CLAUDE_CODE_FIX_WEBHOOK_TOKEN || "").trim();
  if (!configured) {
    const err = new Error("CLAUDE_CODE_FIX_WEBHOOK_TOKEN is not configured on this environment.");
    err.statusCode = 503;
    err.code = "fix_intake_not_configured";
    return { ok: false, error: err };
  }
  const authHeader = String(headers.authorization || headers.Authorization || "");
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!provided || !timingSafeEqual(provided, configured)) {
    const err = new Error("Invalid or missing fix-intake token.");
    err.statusCode = 401;
    err.code = "fix_intake_unauthorized";
    return { ok: false, error: err };
  }
  return { ok: true };
}

export function validateFixRequestPayload(body = {}) {
  const subject = String(body.subject || "").trim();
  if (!subject) return { ok: false, error: "Fix request payload is missing a subject." };
  return {
    ok: true,
    payload: {
      ticket_id: body.ticket_id || null,
      item_type: body.item_type || null,
      subject: subject.slice(0, 200),
      body: body.body ? String(body.body).slice(0, 4000) : null,
      shop_id: body.shop_id || null,
      requested_by: body.requested_by || null,
      requested_at: body.requested_at || new Date().toISOString(),
      recent_shop_errors: body.recent_shop_errors ?? null,
      policy_doc: body.policy_doc || null,
      policy_summary: body.policy_summary || null
    }
  };
}
