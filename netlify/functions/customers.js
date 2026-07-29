import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
import { writeShopAudit } from "./_shared/production.js";
import { validateCustomerBody } from "./_shared/validation.js";
const fields=["name","phone","email","address","notes","birthday","anniversary","favorite_flowers","favorite_colors","tags","vip","is_business"];
export async function handler(event){
 const ready=preflight(event);if(ready)return ready;
 try{const {client,shopId,user}=await currentUser(event);
  if(event.httpMethod==="GET"){const {data,error}=await client.from("customers").select("*").eq("shop_id",shopId).is("deleted_at",null).order("name");if(error)throw error;return json(200,{items:data||[]});}
  const body=bodyOf(event);
  if(event.httpMethod==="POST"){const v=validateCustomerBody(body);if(!v.valid)return json(400,{error:v.errors[0]});const payload={shop_id:shopId};for(const f of fields)if(f in body)payload[f]=body[f];const {data,error}=await client.from("customers").insert(payload).select("*").single();if(error)throw error;await writeShopAudit(client,{shopId,userId:user?.id,eventType:"customer_created",entityType:"customer",entityId:data.id});return json(201,{item:data});}
  if(event.httpMethod==="PATCH"){const v=validateCustomerBody(body);if(!v.valid)return json(400,{error:v.errors[0]});const payload={};for(const f of fields)if(f in body)payload[f]=body[f];const {data,error}=await client.from("customers").update(payload).eq("id",body.id).eq("shop_id",shopId).select("*").single();if(error)throw error;await writeShopAudit(client,{shopId,userId:user?.id,eventType:"customer_updated",entityType:"customer",entityId:data.id});return json(200,{item:data});}
  if(event.httpMethod==="DELETE"){const {error}=await client.from("customers").update({deleted_at:new Date().toISOString()}).eq("id",body.id).eq("shop_id",shopId);if(error)throw error;await writeShopAudit(client,{shopId,userId:user?.id,eventType:"customer_deleted",entityType:"customer",entityId:body.id});return json(200,{ok:true});}
  return methodNotAllowed();
 }catch(error){return fail(error)}
}
