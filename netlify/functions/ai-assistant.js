import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  try{
    const {client,shopId}=await currentUser(event);
    const body=bodyOf(event);
    const prompt=String(body.prompt||"").trim();
    const requestedPersona=String(body.persona||"").trim();
    const persona=/^rose\b/i.test(prompt)||requestedPersona.toLowerCase()==="rose"?"Rose":"Lily";
    if(!prompt) return json(400,{error:"Ask Lily or Rose a question first."});
    if(!process.env.OPENAI_API_KEY) return json(503,{error:"OPENAI_API_KEY is not configured in Netlify."});
    const [{data:shop},{data:inventory},{data:orders},{data:deliveries}]=await Promise.all([
      client.from("shops").select("name").eq("id",shopId).maybeSingle(),
      client.from("inventory_items").select("name,color,variety,quantity,unit,low_stock_level,cost,price").eq("shop_id",shopId).limit(100),
      client.from("orders").select("order_number,customer_name,total,payment_status,delivery_date,status").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(40),
      client.from("deliveries").select("status,recipient_name,address,scheduled_date").eq("shop_id",shopId).order("scheduled_date",{ascending:true}).limit(30)
    ]);
    const context={shop:shop?.name,inventory:inventory||[],recent_orders:orders||[],deliveries:deliveries||[]};
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:process.env.OPENAI_MODEL,
        instructions: persona==="Lily"
          ? "You are Lily, Bloom's creative florist assistant. You sound like a sweet, warm, upbeat young woman who genuinely loves flowers, especially hydrangeas. Help with design ideas, floral recipes, pricing, product descriptions, website copy, and social posts. Be encouraging but practical. Use only supplied shop data for shop-specific facts and never invent sales, inventory, customers, or deliveries. Keep answers conversational and easy to say aloud. Do not overuse emojis."
          : "You are Rose, Bloom's seasoned business manager. You sound like an experienced older woman who is smart, direct, protective of the shop's profit, and has a little playful attitude. Be funny and gently sassy, never rude or insulting. Help with sales, expenses, unpaid balances, inventory, deliveries, and business decisions. Use only supplied shop data for shop-specific facts and never invent numbers. Keep answers conversational and easy to say aloud. A short witty line is welcome when appropriate.",
        input:[{role:"user",content:[{type:"input_text",text:`SHOP DATA:\n${JSON.stringify(context)}\n\nQUESTION:\n${prompt}`}]}],
        max_output_tokens:700
      })
    });
    const data=await response.json();
    if(!response.ok) throw new Error(data?.error?.message||"Bloom AI request failed.");
    const answer=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text||"Bloom AI did not return text.";
    return json(200,{answer,persona});
  }catch(error){return fail(error)}
}
