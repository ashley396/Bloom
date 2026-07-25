import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

function cleanText(value,fallback=""){return String(value??fallback).trim()}
function payloadOf(body,shopId){
  const category=cleanText(body.category,"Flowers")||"Flowers";
  const cost=Math.max(0,Number(body.cost||0));
  const enteredPrice=Math.max(0,Number(body.price||0));
  const price=category.toLowerCase()==="flowers"?Number((cost*3).toFixed(2)):enteredPrice;
  return {
    shop_id:shopId,
    name:cleanText(body.name),
    category,
    color:cleanText(body.color),
    variety:cleanText(body.variety),
    quantity:Math.max(0,Number(body.quantity||0)),
    low_stock_level:Math.max(0,Number(body.low_stock_level||5)),
    unit:cleanText(body.unit,"stems")||"stems",
    cost,
    price
  };
}
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("inventory").select("*").eq("shop_id",shopId).is("deleted_at",null).order("name",{ascending:true}).order("color",{ascending:true});
      if(error) throw error; return json(200,{items:data||[]});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);
      const sourceItems=Array.isArray(body.items)?body.items:[body];
      const payloads=sourceItems.map(item=>payloadOf(item,shopId)).filter(item=>item.name);
      if(!payloads.length) return json(400,{error:"Item name is required"});
      const {data,error}=await client.from("inventory").insert(payloads).select();
      if(error) throw error;
      return json(201,{item:data?.[0]||null,items:data||[]});
    }
    if(event.httpMethod==="PATCH"){
      const body=bodyOf(event);
      if(!body.id || !cleanText(body.name)) return json(400,{error:"Item and name are required"});
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
