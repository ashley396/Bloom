import { authenticatedUser } from './saas.js';

export async function platformAdmin(event, allowedRoles = []) {
  const { client, user } = await authenticatedUser(event);
  const { data, error } = await client
    .from('platform_admins')
    .select('user_id,role,display_name,active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data || !data.active) {
    const err = new Error('This account is not authorized for Florisyn Administration.');
    err.statusCode = 403;
    throw err;
  }
  if (allowedRoles.length && !allowedRoles.includes(data.role) && data.role !== 'super_admin') {
    const err = new Error('Your admin role does not allow this action.');
    err.statusCode = 403;
    throw err;
  }
  return { client, user, admin: data };
}

/** Closed Beta: only `super_admin` may run high-impact platform mutations. */
export function requireSuperAdmin(adminRecord, message = "This action requires a Florisyn super admin.") {
  if (String(adminRecord?.role || "").toLowerCase() === "super_admin") return;
  const err = new Error(message);
  err.statusCode = 403;
  throw err;
}

export async function writeAdminAudit(client, adminUserId, shopId, action, details = {}) {
  await client.from('platform_admin_audit').insert({
    admin_user_id: adminUserId,
    shop_id: shopId || null,
    action,
    details
  });
}

export async function writeCommandAudit(client, adminUserId, action, { shopId = null, targetType = null, targetId = null, result = 'success', ip = 'unknown', ...rest } = {}) {
  await writeAdminAudit(client, adminUserId, shopId, action, {
    target_type: targetType,
    target_id: targetId,
    result,
    ip_placeholder: ip,
    ...rest
  });
}
