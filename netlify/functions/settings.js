import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
const fields=["name","phone","email","address","logo_url","primary_color","accent_color","website_font","website_style","hero_title","hero_text","website_published"];
export async function handler(event){
 const ready=preflight(event);if(ready)return ready;
 try{const {client,shopId}=await currentUser(event);
  if(event.httpMethod==="GET"){const {data,error}=await client.from("shops").select(fields.join(",")).eq("id",shopId).single();if(error)throw error;return json(200,{item:data});}
  if(event.httpMethod==="PATCH"){const body=bodyOf(event),payload={};for(const f of fields)if(f in body)payload[f]=body[f];const {data,error}=await client.from("shops").update(payload).eq("id",shopId).select(fields.join(",")).single();if(error)throw error;return json(200,{item:data});}
  return methodNotAllowed();
 }catch(error){return fail(error)}
}
