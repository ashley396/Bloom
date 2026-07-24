import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
const fields=["name","phone","email","address","notes","birthday","anniversary","favorite_flowers","favorite_colors","tags","vip"];
export async function handler(event){
 const ready=preflight(event);if(ready)return ready;
 try{const {client,shopId}=await currentUser(event);
  if(event.httpMethod==="GET"){const {data,error}=await client.from("customers").select("*").eq("shop_id",shopId).is("deleted_at",null).order("name");if(error)throw error;return json(200,{items:data||[]});}
  const body=bodyOf(event);
  if(event.httpMethod==="POST"){const payload={shop_id:shopId};for(const f of fields)if(f in body)payload[f]=body[f];const {data,error}=await client.from("customers").insert(payload).select("*").single();if(error)throw error;return json(201,{item:data});}
  if(event.httpMethod==="PATCH"){const payload={};for(const f of fields)if(f in body)payload[f]=body[f];const {data,error}=await client.from("customers").update(payload).eq("id",body.id).eq("shop_id",shopId).select("*").single();if(error)throw error;return json(200,{item:data});}
  if(event.httpMethod==="DELETE"){const {error}=await client.from("customers").update({deleted_at:new Date().toISOString()}).eq("id",body.id).eq("shop_id",shopId);if(error)throw error;return json(200,{ok:true});}
  return methodNotAllowed();
 }catch(error){return fail(error)}
}
