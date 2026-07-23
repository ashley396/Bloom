import Stripe from "stripe";
import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  try{
    const {user}=await currentUser(event); const body=bodyOf(event);
    const cents=Math.round(Number(body.amount||0)*100);
    if(cents<50) return json(400,{error:"Payment must be at least $0.50"});
    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const site=(process.env.SITE_URL||event.headers.origin||"").replace(/\/$/,"");
    const session=await stripe.checkout.sessions.create({
      mode:"payment",customer_email:user.email,
      line_items:[{quantity:1,price_data:{currency:"usd",unit_amount:cents,product_data:{name:body.description||"Bloom floral order"}}}],
      success_url:`${site}/?payment=success`,cancel_url:`${site}/?payment=cancelled`
    });
    return json(200,{url:session.url});
  }catch(error){ return fail(error); }
}
