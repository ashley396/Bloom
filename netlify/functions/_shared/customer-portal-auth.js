import crypto from "node:crypto";

export function hashPortalToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function generatePortalToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export async function resolveCustomerPortalSession(client, token) {
  const hash = hashPortalToken(token);
  const { data: row, error } = await client
    .from("customer_portal_access")
    .select("shop_id,customer_id,expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error?.code === "42P01") return { ok: false, error: "portal_not_configured" };
  if (error) throw error;
  if (!row) return { ok: false, error: "invalid_token" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: "expired" };
  return { ok: true, shopId: row.shop_id, customerId: row.customer_id };
}

export function assertPortalCustomer(scope, customerId) {
  if (String(scope.customerId) !== String(customerId)) return { ok: false, error: "forbidden" };
  return { ok: true };
}
