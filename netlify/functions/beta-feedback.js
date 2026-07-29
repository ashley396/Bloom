import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { clampText } from "./_shared/validation.js";
import { BLOOM_VERSION_CODE } from "./_shared/bloom-release.js";
import { structuredLog } from "./_shared/production.js";

const TABLE = "platform_beta_feedback";

function isMissingTable(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("could not find");
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const { client, user, shopId } = await currentUser(event);
    const body = bodyOf(event);
    const message = clampText(body.message, 4000);
    const category = clampText(body.category || "general", 80);
    if (!message) return json(400, { error: "Add feedback before sending." });

    try {
      const { data, error } = await client
        .from(TABLE)
        .insert({
          shop_id: shopId,
          user_id: user.id,
          category,
          message,
          app_version: BLOOM_VERSION_CODE,
          metadata: { path: body.path || null, user_agent: event.headers["user-agent"]?.slice(0, 200) }
        })
        .select("id, created_at")
        .single();
      if (error) throw error;
      return json(201, { ok: true, id: data.id, created_at: data.created_at });
    } catch (error) {
      if (isMissingTable(error)) {
        structuredLog("warn", "beta_feedback_table_missing", { shop_id: shopId });
        return json(503, {
          error: "Beta feedback storage is not enabled yet. Apply release_candidate_v1 migration after review."
        });
      }
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
