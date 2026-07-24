import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("inventory").select("*").eq("shop_id",shopId).order("name",{ascending:false});
      if(error) throw error; return json(200,{items:data||[]});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);
      if(!body.name) return json(400,{error:"Required field missing"});
      const payload={shop_id:shopId,name:body.name.trim(),category:body.category||"Flowers",quantity:Number(body.quantity||0),low_stock_level:Number(body.low_stock_level||5),unit:body.unit||"stems",cost:Number(body.cost||0),price:Number(body.price||0)};
      const {data,error}=await client.from("inventory").insert(payload).select().single();
      if(error) throw error; return json(201,{item:data});
    }
    return methodNotAllowed();
  }catch(error){ return fail(error); }
}
