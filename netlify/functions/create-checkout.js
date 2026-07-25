import Stripe from "stripe";
import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  try{
    const {user,shopId}=await currentUser(event);
    const body=bodyOf(event);
    const cents=Math.round(Number(body.amount||0)*100);
    if(cents<50) return json(400,{error:"Payment must be at least $0.50"});
    if(!process.env.STRIPE_SECRET_KEY) return json(503,{error:"Stripe is not configured in Netlify."});
    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const site=(process.env.SITE_URL||event.headers.origin||"").replace(/\/$/,"");
    if(!site) return json(503,{error:"SITE_URL is not configured in Netlify."});
    const orderId=String(body.order_id||"");
    const orderNumber=String(body.order_number||"");
    const session=await stripe.checkout.sessions.create({
      mode:"payment",
      customer_email:user.email,
      payment_method_types:["card"],
      line_items:[{quantity:1,price_data:{currency:"usd",unit_amount:cents,product_data:{name:body.description||"Bloom floral order"}}}],
      metadata:{bloom_order_id:orderId,bloom_order_number:orderNumber,bloom_shop_id:String(shopId)},
      payment_intent_data:{metadata:{bloom_order_id:orderId,bloom_order_number:orderNumber,bloom_shop_id:String(shopId)}},
      success_url:`${site}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${site}/?payment=cancelled`
    });
    return json(200,{url:session.url,session_id:session.id});
  }catch(error){ return fail(error); }
}
