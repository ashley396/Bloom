import { admin, fail } from "./_shared/saas.js";
import { json } from "./_shared/saas.js";
import { bootstrapRateLimit, verifyBootstrapSecret } from "./_shared/platform-bootstrap.js";

export async function handler(event) {
  try {
    const method = event.httpMethod || "GET";

    if (method === "OPTIONS") {
      return json(204, {});
    }

    const rate = bootstrapRateLimit(event, method);
    if (!rate.allowed) {
      return json(429, {
        error: "Too many setup requests. Please wait a moment and try again.",
        retryAfterMs: rate.retryAfterMs
      });
    }

    const client = admin();
    const { count, error: countError } = await client
      .from("platform_admins")
      .select("*", { count: "exact", head: true });
    if (countError) throw countError;

    const ownerExists = Number(count || 0) > 0;

    if (method === "GET") {
      return json(200, { ownerExists });
    }

    if (method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    // Permanent lock: after the first platform owner exists, bootstrap POST is never allowed again.
    if (ownerExists) {
      return json(409, {
        error:
          "Platform owner setup is already complete. Sign in at Florisyn Administration—another owner cannot be created here."
      });
    }

    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { error: "Invalid request body" });
    }

    const secretCheck = verifyBootstrapSecret(body);
    if (!secretCheck.ok) {
      throw secretCheck.error;
    }

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!name || !email || password.length < 10) {
      return json(400, {
        error: "Enter your name, a valid email, and a password with at least 10 characters."
      });
    }

    const { data: createData, error: createError } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, account_type: "bloom_platform_owner" }
    });
    if (createError) throw createError;
    const user = createData.user;
    const { error: insertError } = await client.from("platform_admins").insert({
      user_id: user.id,
      role: "super_admin",
      display_name: name,
      active: true
    });
    if (insertError) {
      await client.auth.admin.deleteUser(user.id);
      throw insertError;
    }
    await client.from("platform_admin_audit").insert({
      admin_user_id: user.id,
      shop_id: null,
      action: "platform_owner_created",
      details: { display_name: name }
    });
    return json(201, { ok: true, email });
  } catch (error) {
    return fail(error);
  }
}
