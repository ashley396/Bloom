import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

function extractJson(text){
  const cleaned=String(text||"").replace(/^```json\s*/i,"").replace(/```$/i,"").trim();
  const start=cleaned.indexOf("["); const end=cleaned.lastIndexOf("]");
  if(start<0||end<start) throw new Error("Bloom could not read inventory items from that image.");
  return JSON.parse(cleaned.slice(start,end+1));
}
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  try{
    await currentUser(event);
    const body=bodyOf(event),dataUrl=String(body.data_url||"");
    if(!dataUrl.startsWith("data:image/")) return json(400,{error:"Upload a clear JPG or PNG of the invoice or packing slip. CSV files are imported directly in Bloom."});
    if(!process.env.OPENAI_API_KEY) return json(503,{error:"OPENAI_API_KEY is not configured in Netlify, so image scanning is unavailable. CSV import still works."});
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:process.env.OPENAI_MODEL||"gpt-4.1-mini",
        instructions:"Read a florist wholesale invoice or packing slip. Return ONLY a JSON array. Each object must have name, category, color, variety, quantity, unit, cost, price, low_stock_level. cost is wholesale price per unit. For Flowers, price must equal cost multiplied by 3. Use empty strings when color or variety is unknown. Use category Flowers unless clearly Greenery, Vases, Supplies, or Gifts. Do not invent unreadable values.",
        input:[{role:"user",content:[{type:"input_text",text:"Extract every inventory line item from this florist invoice or packing slip."},{type:"input_image",image_url:dataUrl}]}],
        max_output_tokens:1800
      })
    });
    const data=await response.json();
    if(!response.ok) throw new Error(data?.error?.message||"Inventory scan failed.");
    const text=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text||"";
    const items=extractJson(text).map(x=>{
      const category=String(x.category||"Flowers").trim()||"Flowers",cost=Math.max(0,Number(x.cost||0));
      return {name:String(x.name||"").trim(),category,color:String(x.color||"").trim(),variety:String(x.variety||"").trim(),quantity:Math.max(0,Number(x.quantity||0)),unit:String(x.unit||"stems").trim()||"stems",cost,price:category.toLowerCase()==="flowers"?Number((cost*3).toFixed(2)):Math.max(0,Number(x.price||0)),low_stock_level:Math.max(0,Number(x.low_stock_level||5))}
    }).filter(x=>x.name);
    return json(200,{items});
  }catch(error){return fail(error)}
}
