import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("customers").select("*").eq("shop_id",shopId).is("deleted_at",null).order("name",{ascending:true});
      if(error) throw error; return json(200,{items:data||[]});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);
      if(!body.name?.trim()) return json(400,{error:"Customer name is required"});
      const payload={shop_id:shopId,name:body.name.trim(),phone:body.phone||null,email:body.email||null,address:body.address||null,notes:body.notes||null};
      const {data,error}=await client.from("customers").insert(payload).select().single();
      if(error) throw error; return json(201,{item:data});
    }
    if(event.httpMethod==="PATCH"){
      const body=bodyOf(event);
      if(!body.id || !body.name?.trim()) return json(400,{error:"Customer and name are required"});
      const payload={name:body.name.trim(),phone:body.phone||null,email:body.email||null,address:body.address||null,notes:body.notes||null};
      const {data,error}=await client.from("customers").update(payload).eq("id",body.id).eq("shop_id",shopId).is("deleted_at",null).select().single();
      if(error) throw error; return json(200,{item:data});
    }
    if(event.httpMethod==="DELETE"){
      const body=bodyOf(event);
      if(!body.id) return json(400,{error:"Customer is required"});
      const {error}=await client.from("customers").update({deleted_at:new Date().toISOString()}).eq("id",body.id).eq("shop_id",shopId);
      if(error) throw error; return json(200,{ok:true});
    }
    return methodNotAllowed();
  }catch(error){ return fail(error); }
}
