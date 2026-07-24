import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  try{
    const {client,shopId}=await currentUser(event);
    if(!process.env.OPENAI_API_KEY) return json(503,{error:"OPENAI_API_KEY is not configured in Netlify."});
    const body=bodyOf(event),kind=String(body.kind||"description"),current=String(body.current||""),fields=body.fields||{};
    const {data:shop}=await client.from("shops").select("name,address,phone,tagline,website_style").eq("id",shopId).maybeSingle();
    const prompt=`Write one polished ${kind} for a real local flower shop.\nSHOP: ${JSON.stringify(shop||{})}\nFORM DETAILS: ${JSON.stringify(fields)}\nCURRENT WORDING: ${current}\nReturn only the finished wording. Do not add labels, quotation marks, markdown, prices, delivery promises, awards, years in business, or facts not supplied. Make it warm, specific, natural, and professional—not generic AI copy. For SEO descriptions stay under 155 characters. For SEO titles stay under 60 characters. For taglines use 3 to 9 words.`;
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4.1-mini",instructions:"You are Lily, Bloom's sweet and highly skilled florist copywriter. Write concise, believable marketing copy for florists. Never invent shop facts.",input:prompt,max_output_tokens:250})});
    const data=await response.json(); if(!response.ok) throw new Error(data?.error?.message||"Lily could not write that right now.");
    const text=(data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text||"").trim();
    return json(200,{text});
  }catch(error){return fail(error)}
}
