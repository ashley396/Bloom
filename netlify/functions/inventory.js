import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

function payloadOf(body,shopId){
  return {shop_id:shopId,name:body.name.trim(),category:body.category||"Flowers",quantity:Number(body.quantity||0),low_stock_level:Number(body.low_stock_level||5),unit:body.unit||"stems",cost:Number(body.cost||0),price:Number(body.price||0)};
}
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("inventory").select("*").eq("shop_id",shopId).is("deleted_at",null).order("name",{ascending:true});
      if(error) throw error; return json(200,{items:data||[]});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);
      if(!body.name?.trim()) return json(400,{error:"Item name is required"});
      const {data,error}=await client.from("inventory").insert(payloadOf(body,shopId)).select().single();
      if(error) throw error; return json(201,{item:data});
    }
    if(event.httpMethod==="PATCH"){
      const body=bodyOf(event);
      if(!body.id || !body.name?.trim()) return json(400,{error:"Item and name are required"});
      const payload=payloadOf(body,shopId); delete payload.shop_id;
      const {data,error}=await client.from("inventory").update(payload).eq("id",body.id).eq("shop_id",shopId).is("deleted_at",null).select().single();
      if(error) throw error; return json(200,{item:data});
    }
    if(event.httpMethod==="DELETE"){
      const body=bodyOf(event);
      if(!body.id) return json(400,{error:"Item is required"});
      const {error}=await client.from("inventory").update({deleted_at:new Date().toISOString()}).eq("id",body.id).eq("shop_id",shopId);
      if(error) throw error; return json(200,{ok:true});
    }
    return methodNotAllowed();
  }catch(error){ return fail(error); }
}
