import { authenticatedUser } from './saas.js';

export async function platformAdmin(event, allowedRoles = []) {
  const { client, user } = await authenticatedUser(event);
  const { data, error } = await client
    .from('platform_admins')
    .select('user_id,role,display_name,active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data || !data.active) {
    const err = new Error('This account is not authorized for Bloom Administration.');
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

export async function writeAdminAudit(client, adminUserId, shopId, action, details = {}) {
  await client.from('platform_admin_audit').insert({
    admin_user_id: adminUserId,
    shop_id: shopId || null,
    action,
    details
  });
}
