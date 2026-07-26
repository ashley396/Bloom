import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

export async function handler(event){
  const ready=preflight(event);if(ready)return ready;
  try{
    if(event.httpMethod==="GET")return json(200,{configured:Boolean(process.env.OPENAI_API_KEY),provider:"Bloom Cloud AI"});
    if(event.httpMethod!=="POST")return methodNotAllowed();
    await currentUser(event);
    if(!process.env.OPENAI_API_KEY)return json(503,{error:"OPENAI_API_KEY is not configured in Netlify."});
    const body=bodyOf(event),persona=body.persona==="Rose"?"Rose":"Lily",prompt=String(body.prompt||"").trim();
    if(!prompt)return json(400,{error:"Enter a question for Lily or Rose."});
    const system=persona==="Rose"
      ? "You are Rose, an experienced, warm, witty florist business assistant. Give practical, concise help for an independent flower shop. Never invent shop data; use only supplied context."
      : "You are Lily, a friendly, capable florist business assistant. Help with floral design, pricing, customer service, inventory, marketing, and daily shop operations. Be practical and concise. Never invent shop data; use only supplied context.";
    const context=JSON.stringify(body.context||{}).slice(0,18000);
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4.1-mini",input:[{role:"system",content:[{type:"input_text",text:system}]},{role:"user",content:[{type:"input_text",text:`Shop context:\n${context}\n\nRequest:\n${prompt}`}]}],max_output_tokens:500})});
    const data=await response.json();
    if(!response.ok)throw new Error(data?.error?.message||`Cloud AI request failed (${response.status})`);
    const answer=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;
    if(!answer)throw new Error("Lily did not return an answer.");
    return json(200,{answer,persona,provider:"cloud"});
  }catch(error){return fail(error)}
}
