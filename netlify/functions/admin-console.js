import { json } from './_shared/saas.js';
import { platformAdmin, writeAdminAudit, requireSuperAdmin, platformAdminErrorResponse, platformAdminError } from './_shared/platform-admin.js';

const safeObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export async function handler(event) {
  try {
    const { client, user, admin } = await platformAdmin(event, ["super_admin"]);
    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || event.queryStringParameters?.action || 'overview';

    if (event.httpMethod === 'GET' && action === 'overview') {
      const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
      const [shopsRes, membersRes, ordersRes, subsRes, alertsRes, platformRes] = await Promise.all([
        client.from('shops').select('*', { count: 'exact', head: true }),
        client.from('shop_members').select('*', { count: 'exact', head: true }),
        client.from('orders').select('*', { count: 'exact', head: true }),
        client.from('shop_subscriptions').select('shop_id,plan_code,status,cancel_at_period_end,created_at,updated_at'),
        client.from('platform_admin_notifications').select('id,shop_id,event_type,title,message,read_at,created_at').order('created_at',{ascending:false}).limit(30),
        client.from('platform_settings').select('value').eq('key','rose_foundation').maybeSingle()
      ]);
      if (subsRes.error) throw subsRes.error;
      const subs=subsRes.data||[], active=subs.filter(x=>['trialing','active'].includes(x.status));
      const price={starter:39,professional:79,premium:129};
      const countPlan=plan=>active.filter(x=>x.plan_code===plan).length;
      const metrics={
        shops:shopsRes.count||0,members:membersRes.count||0,orders:ordersRes.count||0,
        activeSubscriptions:active.length,
        trials:active.filter(x=>x.status==='trialing'||x.plan_code==='trial').length,
        starter:countPlan('starter'),professional:countPlan('professional'),premium:countPlan('premium'),
        canceling:active.filter(x=>x.cancel_at_period_end).length,
        newThisMonth:subs.filter(x=>new Date(x.created_at)>=monthStart).length,
        canceledThisMonth:subs.filter(x=>x.status==='canceled'&&new Date(x.updated_at)>=monthStart).length,
        estimatedMrr:active.filter(x=>x.status==='active').reduce((sum,x)=>sum+(price[x.plan_code]||0),0)
      };
      return json(200,{admin,metrics,alerts:alertsRes.data||[],platform:{foundationTotal:Number(platformRes.data?.value?.total||0)}});
    }

    if (event.httpMethod === 'GET' && action === 'shops') {
      const search = String(event.queryStringParameters?.search || '').trim();
      let query = client.from('shops').select('id,name,slug,email,phone,city,state,onboarding_complete,created_at,shop_subscriptions(plan_code,status,trial_ends_at,current_period_ends_at),shop_admin_config(account_status,updated_at)').order('created_at', { ascending: false }).limit(250);
      if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,slug.ilike.%${search}%`);
      const { data, error } = await query;
      if (error) throw error;
      return json(200, { shops: data || [] });
    }

    if (event.httpMethod === 'GET' && action === 'shop') {
      const shopId = event.queryStringParameters?.shopId;
      if (!shopId) throw platformAdminError('missing_shop_id');
      const [shopRes, configRes, membersRes, auditRes] = await Promise.all([
        client.from('shops').select('*').eq('id', shopId).single(),
        client.from('shop_admin_config').select('*').eq('shop_id', shopId).maybeSingle(),
        client.from('shop_members').select('user_id,role,status,created_at').eq('shop_id', shopId),
        client.from('platform_admin_audit').select('id,action,details,created_at').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(30)
      ]);
      if (shopRes.error) throw shopRes.error;
      const { data: subscription } = await client.from('shop_subscriptions').select('*').eq('shop_id', shopId).maybeSingle();
      return json(200, { shop: shopRes.data, config: configRes.data || {}, members: membersRes.data || [], subscription: subscription || {}, audit: auditRes.data || [] });
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    if (action === 'save-platform-settings') {
      requireSuperAdmin(admin);
      const foundationTotal=Math.max(0,Number(body.foundationTotal||0));
      const {error}=await client.from('platform_settings').upsert({key:'rose_foundation',value:{total:foundationTotal},updated_by:user.id,updated_at:new Date().toISOString()});
      if(error)throw error;
      await writeAdminAudit(client,user.id,null,'update_rose_foundation',{total:foundationTotal});
      return json(200,{ok:true,foundationTotal});
    }
    if (action === 'mark-alerts-read') {
      requireSuperAdmin(admin);
      const { error } = await client.from('platform_admin_notifications').update({read_at:new Date().toISOString()}).is('read_at',null);
      if (error) throw error;
      return json(200,{ok:true});
    }
    const shopId = body.shopId;
    if (!shopId) throw platformAdminError('missing_shop_id');

    if (action === 'save-config') {
      requireSuperAdmin(admin);
      const record = {
        shop_id: shopId,
        account_status: body.accountStatus || 'active',
        support_message: body.supportMessage || null,
        announcement: body.announcement || null,
        theme: safeObject(body.theme),
        navigation: safeObject(body.navigation),
        features: safeObject(body.features),
        content: safeObject(body.content),
        updated_by: user.id,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await client.from('shop_admin_config').upsert(record).select().single();
      if (error) throw error;
      await writeAdminAudit(client, user.id, shopId, 'save_config', { sections: ['status','theme','navigation','features','content'] });
      return json(200, { config: data });
    }

    if (action === 'update-shop') {
      requireSuperAdmin(admin);
      const allowed = ['name','email','phone','website','address_line_1','address_line_2','city','state','postal_code','timezone','tax_rate','default_delivery_fee','receipt_header','invoice_prefix'];
      const patch = {};
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(body.shop || {}, key)) patch[key] = body.shop[key];
      patch.updated_at = new Date().toISOString();
      const { data, error } = await client.from('shops').update(patch).eq('id', shopId).select().single();
      if (error) throw error;
      await writeAdminAudit(client, user.id, shopId, 'update_shop', { fields: Object.keys(patch) });
      return json(200, { shop: data });
    }

    if (action === 'update-subscription') {
      requireSuperAdmin(admin);
      const subscription = body.subscription || {};
      const patch = {
        plan_code: subscription.plan_code,
        status: subscription.status,
        trial_ends_at: subscription.trial_ends_at || null,
        current_period_ends_at: subscription.current_period_ends_at || null,
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        updated_at: new Date().toISOString()
      };
      const { data, error } = await client.from('shop_subscriptions').upsert({ shop_id: shopId, ...patch }).select().single();
      if (error) throw error;
      await writeAdminAudit(client, user.id, shopId, 'update_subscription', patch);
      return json(200, { subscription: data });
    }

    return json(400, { error: 'Unknown admin action' });
  } catch (error) { return platformAdminErrorResponse(event, error); }
}
