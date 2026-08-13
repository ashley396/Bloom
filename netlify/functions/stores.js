import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { admin,currentUser,fail,requireServerKeyFor } from "./_shared/supabase.js";
export async function handler(event){
 const ready=preflight(event);if(ready)return ready;
 try{
  const {client,user,shopId}=await currentUser(event);
  if(event.httpMethod==="GET"){
   const {data,error}=await client.from("shop_members").select("shop_id,role,shops(*)").eq("user_id",user.id);
   if(error)throw error;return json(200,{items:(data||[]).map(x=>({...x.shops,role:x.role,active:x.shop_id===shopId}))});
  }
  if(event.httpMethod==="POST"){
   requireServerKeyFor("add_store");
   const body=bodyOf(event);if(!body.name)throw new Error("Shop name is required");
   const {data:shop,error}=await admin().rpc("create_additional_shop_atomic",{p_owner_id:user.id,p_shop:{name:body.name,phone:body.phone||null,email:body.email||null,address:body.address||null}});if(error)throw error;
   return json(201,{item:shop});
  }
  if(event.httpMethod==="PATCH"){
   const body=bodyOf(event);if(!body.shop_id)throw new Error("Missing shop_id");
   const {data:member}=await client.from("shop_members").select("user_id").eq("shop_id",body.shop_id).eq("user_id",user.id).maybeSingle();
   if(!member)throw new Error("You do not have access to that shop");
   const {error}=await client.from("profiles").update({default_shop_id:body.shop_id}).eq("id",user.id);if(error)throw error;
   return json(200,{ok:true});
  }
  return methodNotAllowed();
 }catch(error){return fail(error)}
}
