import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
function orderNumber(){ return `BLM-${Date.now().toString().slice(-8)}`; }
const validStatuses=new Set(["NEW","DESIGNING","READY","OUT_FOR_DELIVERY","COMPLETED","CANCELLED"]);
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("orders").select("*").eq("shop_id",shopId).order("created_at",{ascending:false});
      if(error) throw error; return json(200,{items:data||[]});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);
      if(!body.customer_name?.trim()) return json(400,{error:"Customer name is required"});
      const subtotal=Number(body.subtotal||0),tax=Number(body.tax||0),deliveryFee=Number(body.delivery_fee||0);
      const paid=body.payment_status==="PAID";
      const payload={shop_id:shopId,order_number:orderNumber(),customer_name:body.customer_name.trim(),occasion:body.occasion||null,fulfillment:body.fulfillment==="DELIVERY"?"DELIVERY":"PICKUP",delivery_address:body.delivery_address||null,delivery_date:body.delivery_date||null,status:"NEW",subtotal,tax,delivery_fee:deliveryFee,total:subtotal+tax+deliveryFee,notes:body.notes||null,payment_status:paid?"PAID":"UNPAID",payment_method:paid?(body.payment_method||"Other"):null,paid_at:paid?new Date().toISOString():null};
      const {data,error}=await client.from("orders").insert(payload).select().single();
      if(error) throw error; return json(201,{item:data});
    }
    if(event.httpMethod==="PATCH"){
      const body=bodyOf(event); if(!body.id) return json(400,{error:"Order is required"});
      const update={};
      if(body.status&&validStatuses.has(body.status)) update.status=body.status;
      if(body.action==="MARK_PAID"){update.payment_status="PAID";update.payment_method=body.payment_method||"Other";update.paid_at=new Date().toISOString();}
      if(body.action==="MARK_UNPAID"){update.payment_status="UNPAID";update.payment_method=null;update.paid_at=null;}
      const {data,error}=await client.from("orders").update(update).eq("id",body.id).eq("shop_id",shopId).select().single();
      if(error) throw error; return json(200,{item:data});
    }
    return methodNotAllowed();
  }catch(error){ return fail(error); }
}
