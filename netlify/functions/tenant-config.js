import { authenticatedUser, json, fail } from './_shared/saas.js';

export async function handler(event) {
  try {
    const { client, user } = await authenticatedUser(event);
    const requested = event.queryStringParameters?.shopId;
    let shopId = requested;
    if (!shopId) {
      const { data } = await client.from('profiles').select('default_shop_id').eq('id', user.id).maybeSingle();
      shopId = data?.default_shop_id;
    }
    if (!shopId) return json(200, { config: {} });
    const { data: membership } = await client.from('shop_members').select('status').eq('shop_id', shopId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (!membership) return json(403, { error: 'You do not have access to this shop.' });
    const { data, error } = await client.from('shop_admin_config').select('account_status,support_message,announcement,theme,navigation,features,content,updated_at').eq('shop_id', shopId).maybeSingle();
    if (error) throw error;
    return json(200, { config: data || {} });
  } catch (error) { return fail(error); }
}
