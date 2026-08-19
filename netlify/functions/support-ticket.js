/**
 * Lets a signed-in florist file a real support ticket — the first in-app
 * path to platform_support_items that isn't admin-only. Used by Bud's
 * confirmed chat action (see support.report_issue in lily-ai-engine.js),
 * but works as a plain POST for any future "report a problem" UI too.
 *
 * platform_support_items has row-level security enabled with no client
 * policies (Command Center reads/writes it via the service-role client
 * only — see admin-command-center.js). Rather than opening that table up
 * with a new RLS policy, this follows the same established pattern: a
 * florist authenticates normally via their own session, and this
 * function — after checking that session — writes with the service-role
 * client, scoped in code to exactly one ticket for exactly that shop/user.
 */
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser as realCurrentUser, admin as realAdmin, fail } from "./_shared/supabase.js";
import { validateTicketPayload } from "../../lib/support/tickets.js";

/**
 * Core handler logic, dependency-injectable for handler-level tests (see
 * tests/support-ticket.test.js) without a real Stripe/Supabase connection.
 * `handler` below is the thin Netlify entrypoint that always uses the
 * real dependencies.
 */
export async function handleSupportTicket(event, deps = {}) {
  const currentUser = deps.currentUser || realCurrentUser;
  const admin = deps.admin || realAdmin;

  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  try {
    const { user, shopId } = await currentUser(event);
    const body = bodyOf(event);
    const action = body.action || "create";

    if (action === "create") {
      const v = validateTicketPayload(body);
      if (!v.ok) return json(400, { error: v.error });

      const now = new Date().toISOString();
      const record = {
        item_type: "bug_report",
        status: "open",
        subject: v.payload.subject,
        body: v.payload.body,
        shop_id: shopId,
        user_id: user.id,
        notes: [{ type: "source", text: "Reported via Bud in AI Studio chat.", at: now }],
        created_at: now,
        updated_at: now
      };
      const { data, error } = await admin()
        .from("platform_support_items")
        .insert(record)
        .select("id,status,created_at")
        .single();
      if (error) throw error;
      return json(201, { item: data, message: "Bud sent that in — Florisyn will follow up." });
    }

    if (action === "list") {
      // A florist can only ever see their own reports — filtered here in
      // code since the table has no client-facing RLS policy at all.
      const { data, error } = await admin()
        .from("platform_support_items")
        .select("id,subject,body,status,created_at,updated_at")
        .eq("shop_id", shopId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return json(200, { items: data || [] });
    }

    return json(400, { error: "Unknown action." });
  } catch (error) {
    return fail(error);
  }
}

export async function handler(event) {
  return handleSupportTicket(event);
}
