/**
 * The receiving end of CLAUDE_CODE_FIX_WEBHOOK_URL — this is where
 * admin-command-center.js's "Request Claude Code fix" button now
 * actually sends the request, instead of nowhere.
 *
 * This does NOT autonomously investigate or ship a fix by itself — it
 * queues the request into platform_agent_fix_requests (Bud's Fix Queue,
 * visible in the Admin Command Center) so a human can see it landed and
 * hand it to an agent session. What that agent may then do on its own,
 * and what needs a human's yes first, is governed by
 * docs/FLORISYN_AI_AGENT_AUTONOMY_POLICY.md — this endpoint's job ends at
 * "recorded and visible," not "fixed."
 */
import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { admin as realAdmin, fail } from "./_shared/supabase.js";
import { verifyFixIntakeToken, validateFixRequestPayload } from "../../lib/support/fix-requests.js";

export async function handleFixIntake(event, deps = {}) {
  const admin = deps.admin || realAdmin;

  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const auth = verifyFixIntakeToken(event.headers || {});
    if (!auth.ok) return fail(auth.error);

    const body = bodyOf(event);
    const v = validateFixRequestPayload(body);
    if (!v.ok) return json(400, { error: v.error });

    const { data, error } = await admin()
      .from("platform_agent_fix_requests")
      .insert({ ...v.payload, status: "queued" })
      .select("id,status")
      .single();
    if (error) throw error;

    return json(200, { ok: true, id: data.id, status: data.status });
  } catch (error) {
    return fail(error);
  }
}

export async function handler(event) {
  return handleFixIntake(event);
}
