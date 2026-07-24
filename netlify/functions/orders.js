import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
export async function handler(event){
 const ready=preflight(event);if(ready)return ready;
 try const {client,shopId,user}=await currentUser(event);
  if(event.httpMethod==="GET"){const {data,error}=await client.from("orders").select("*").eq("shop_id",shopId).order("created_at",{ascending:false});if(error)throw error;return json(200,{items:data||[]});}
  const body=bodyOf(event);
  if(event.httpMethod==="POST"){
   const subtotal=Number(body.subtotal||0),tax=Number(body.tax||0),delivery=Number(body.delivery_fee||0),labor=Number(body.labor_charge||0),addonsTotal=Number(body.addon_total||0),discount=Number(body.discount||0);
   let costTotal=0;
   if(body.product_id){
    const {data:p}=await client.from("products").select("labor_cost").eq("id",body.product_id).eq("shop_id",shopId).maybeSingle();
    const {data:r}=await client.from("product_recipes").select("quantity,unit_cost").eq("product_id",body.product_id).eq("shop_id",shopId);
    costTotal=Number(p?.labor_cost||0)+(r||[]).reduce((s,x)=>s+Number(x.quantity||0)*Number(x.unit_cost||0),0);
   }
   const estimatedCost=Number(body.estimated_cost||costTotal||0);
   const total=Math.max(0,subtotal+labor+addonsTotal+tax+delivery-discount);
  const payload={
  user_id:user.id,
  shop_id:shopId,
  order_number: ...`BL-${Date.now().toString().slice(-8)}`,customer_name:body.customer_name,customer_phone:body.customer_phone||null,recipient_name:body.recipient_name||null,recipient_phone:body.recipient_phone||null,occasion:body.occasion||null,order_source:body.order_source||"Phone",design_style:body.design_style||null,color_palette:body.color_palette||null,preferred_flowers:body.preferred_flowers||null,flower_restrictions:body.flower_restrictions||null,arrangement_description:body.arrangement_description||null,addons:body.addons||null,addon_total:addonsTotal,fulfillment:body.fulfillment||"PICKUP",delivery_address:body.delivery_address||null,delivery_date:body.delivery_date||null,delivery_window:body.delivery_window||null,location_type:body.location_type||null,driver:body.driver||null,delivery_instructions:body.delivery_instructions||null,designer:body.designer||null,priority:body.priority||"NORMAL",card_message:body.card_message||null,product_id:body.product_id||null,subtotal,labor_charge:labor,tax,delivery_fee:delivery,discount,total,cost_total:estimatedCost,payment_status:body.payment_status||"UNPAID",payment_method:body.payment_method||null,amount_paid:Number(body.amount_paid||0),paid_at:body.payment_status==="PAID"?new Date().toISOString():null,notes:body.notes||null};
   const {data,error}=await client.from("orders").insert(payload).select("*").single();if(error)throw error;return json(201,{item:data});
  }
  if(event.httpMethod==="PATCH"){
   if(body.action==="MARK_PAID"){const {data,error}=await client.from("orders").update({payment_status:"PAID",payment_method:body.payment_method||"Other",paid_at:new Date().toISOString()}).eq("id",body.id).eq("shop_id",shopId).select("*").single();if(error)throw error;return json(200,{item:data});}
   if(body.action==="MARK_UNPAID"){const {data,error}=await client.from("orders").update({payment_status:"UNPAID",paid_at:null}).eq("id",body.id).eq("shop_id",shopId).select("*").single();if(error)throw error;return json(200,{item:data});}
  }
  return methodNotAllowed();
 }catch(error){return fail(error)}
}
