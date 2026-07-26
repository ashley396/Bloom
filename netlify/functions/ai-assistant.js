import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser } from "./_shared/supabase.js";

const MODEL_DEFAULT="@cf/meta/llama-3.1-8b-instruct-fast";
function cleanJson(text){
  const raw=String(text||"").trim().replace(/^```(?:json)?/i,"").replace(/```$/,"｣").replace(/｣$/,'').trim();
  try{return JSON.parse(raw)}catch{}
  const match=raw.match(/\{[\s\S]*\}/);if(match)try{return JSON.parse(match[0])}catch{}
  return null;
}
function systemPrompt(persona){return `${persona||"Lily"} is Bloom's florist business assistant. Be practical, warm, concise, and accurate. Never claim an action was saved, published, paid, or completed unless the app confirms it. Suggestions are always editable and require florist approval. Avoid expensive or unnecessary services and favor low-cost workflows.`}
async function cloudflareAi(payload){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AI_API_TOKEN;
  if(!account||!token){const e=new Error("Cloud AI is not configured; Bloom will try the free local AI fallback.");e.statusCode=503;throw e}
  const model=process.env.CLOUDFLARE_AI_MODEL||MODEL_DEFAULT;
  let user;
  if(payload.mode==="generate")user=`Task: ${payload.task}\nInput: ${JSON.stringify(payload.input||{})}\nReturn ONLY valid JSON matching this shape: ${JSON.stringify(payload.schema||{text:"result"})}`;
  else user=`Question: ${payload.prompt}\nBloom shop context: ${JSON.stringify(payload.context||{})}`;
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"system",content:systemPrompt(payload.persona)},{role:"user",content:user}],max_tokens:payload.mode==="generate"?700:550,temperature:.35})});
  const d=await r.json();if(!r.ok||!d.success)throw new Error(d.errors?.[0]?.message||"Cloud AI request failed");
  const text=d.result?.response||d.result?.result||"";
  if(payload.mode==="generate")return {result:cleanJson(text)||{text},provider:"Cloudflare Workers AI",model};
  return {answer:text,persona:payload.persona||"Lily",provider:"Cloudflare Workers AI",model};
}
export async function handler(event){
  const ready=preflight(event);if(ready)return ready;if(event.httpMethod!=="POST")return methodNotAllowed();
  try{await currentUser(event);const payload=bodyOf(event);if(!payload.prompt&&!payload.task) return json(400,{error:"Add a prompt or task."});return json(200,await cloudflareAi(payload))}
  catch(error){return json(error.statusCode||500,{error:error.message||"AI unavailable"})}
}
