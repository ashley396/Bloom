import Stripe from "stripe";
import { json,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="GET") return methodNotAllowed();
  try{
    const {client,shopId}=await currentUser(event);
    const sessionId=event.queryStringParameters?.session_id;
    if(!sessionId) return json(400,{error:"Missing Stripe session ID."});
    if(!process.env.STRIPE_SECRET_KEY) return json(503,{error:"Stripe is not configured in Netlify."});
    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const session=await stripe.checkout.sessions.retrieve(sessionId);
    const orderId=session.metadata?.bloom_order_id;
    const sessionShopId=session.metadata?.bloom_shop_id;
    if(sessionShopId && String(sessionShopId)!==String(shopId)) return json(403,{error:"This payment does not belong to the active shop."});
    const paid=session.payment_status==="paid";
    let order=null;
    if(paid && orderId){
      const amountPaid=Number(session.amount_total||0)/100;
      const {data,error}=await client.from("orders").update({
        payment_status:"PAID",payment_method:"Stripe",amount_paid:amountPaid,balance_due:0
      }).eq("id",orderId).eq("shop_id",shopId).select().maybeSingle();
      if(error) throw error;
      order=data;
    }
    return json(200,{paid,payment_status:session.payment_status,amount:Number(session.amount_total||0)/100,order});
  }catch(error){ return fail(error); }
}
