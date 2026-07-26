import { admin, fail } from './_shared/saas.js';
import { json } from './_shared/saas.js';

export async function handler(event){
  try{
    const client=admin();
    const {count,error:countError}=await client.from('platform_admins').select('*',{count:'exact',head:true});
    if(countError)throw countError;
    if(event.httpMethod==='GET')return json(200,{ownerExists:Number(count||0)>0});
    if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
    if(Number(count||0)>0)return json(409,{error:'Bloom Owner setup has already been completed.'});
    const body=JSON.parse(event.body||'{}');
    const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
    if(!name||!email||password.length<10)return json(400,{error:'Enter your name, a valid email, and a password with at least 10 characters.'});
    const {data:createData,error:createError}=await client.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name,account_type:'bloom_platform_owner'}});
    if(createError)throw createError;
    const user=createData.user;
    const {error:insertError}=await client.from('platform_admins').insert({user_id:user.id,role:'super_admin',display_name:name,active:true});
    if(insertError){await client.auth.admin.deleteUser(user.id);throw insertError}
    await client.from('platform_admin_audit').insert({admin_user_id:user.id,shop_id:null,action:'platform_owner_created',details:{display_name:name}});
    return json(201,{ok:true,email});
  }catch(error){return fail(error)}
}