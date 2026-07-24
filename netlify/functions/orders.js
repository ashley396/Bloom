import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
function orderNumber(){ return `BLM-${Date.now().toString().slice(-8)}`; }
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  try{
    const {client,shopId,user}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("orders").select("*").eq("shop_id",shopId).order("created_at",{ascending:false});
      if(error) throw error; return json(200,{items:data||[]});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);
      if(!body.customer_name) return json(400,{error:"Customer name is required"});
      const subtotal=Number(body.subtotal||0), tax=Number(body.tax||0), deliveryFee=Number(body.delivery_fee||0);
      const payload={user_id:user.id,shop_id:shopId,order_number:orderNumber(),customer_name:body.customer_name.trim(),occasion:body.occasion||null,
        fulfillment:body.fulfillment==="DELIVERY"?"DELIVERY":"PICKUP",delivery_address:body.delivery_address||null,
        delivery_date:body.delivery_date||null,delivery_miles:Number(body.delivery_miles||0),status:"NEW",subtotal,tax,delivery_fee:deliveryFee,total:subtotal+tax+deliveryFee,notes:body.notes||null};
      const {data,error}=await client.from("orders").insert(payload).select().single();
      if(error) throw error; return json(201,{item:data});
    }
    if(event.httpMethod==="PATCH"){
      const body=bodyOf(event);
      const {data,error}=await client.from("orders").update({status:body.status}).eq("id",body.id).eq("shop_id",shopId).select().single();
      if(error) throw error; return json(200,{item:data});
    }
    return methodNotAllowed();
  }catch(error){ return fail(error); }
}
