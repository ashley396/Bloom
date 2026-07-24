import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("customers").select("*").eq("shop_id",shopId).order("name",{ascending:false});
      if(error) throw error; return json(200,{items:data||[]});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);
      if(!body.name) return json(400,{error:"Required field missing"});
      const payload={shop_id:shopId,name:body.name.trim(),phone:body.phone||null,email:body.email||null,address:body.address||null,notes:body.notes||null};
      const {data,error}=await client.from("customers").insert(payload).select().single();
      if(error) throw error; return json(201,{item:data});
    }
    return methodNotAllowed();
  }catch(error){ return fail(error); }
}
