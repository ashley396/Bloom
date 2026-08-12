import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser } from "./_shared/supabase.js";

const MODEL_DEFAULT="@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_PROMPT_CHARS=42000;
const MAX_STRING_CHARS=2400;
const MAX_ARRAY_ITEMS=18;
const MAX_OBJECT_KEYS=40;
const BLOCKED_KEY=/^(?:logo|logo_url|image|image_url|hero_image_url|receipt_data_url|photo|photo_url|data_url|file|attachment|canvas|base64)$/i;
const DATA_URL=/^data:[^;]+;base64,/i;

function cleanJson(text){
  const raw=String(text||"").trim().replace(/^```(?:json)?/i,"").replace(/```$/i,"").trim();
  try{return JSON.parse(raw)}catch{}
  const match=raw.match(/\{[\s\S]*\}/);if(match)try{return JSON.parse(match[0])}catch{}
  return null;
}
function safeText(value,max=MAX_STRING_CHARS){
  const text=String(value??"");
  if(DATA_URL.test(text)) return "[embedded image omitted]";
  return text.length>max?`${text.slice(0,max)}…[trimmed]`:text;
}
function compact(value,depth=0,key=""){
  if(value==null||typeof value==="number"||typeof value==="boolean")return value;
  if(BLOCKED_KEY.test(key))return "[media omitted]";
  if(typeof value==="string")return safeText(value);
  if(depth>=4)return "[nested data omitted]";
  if(Array.isArray(value))return value.slice(0,MAX_ARRAY_ITEMS).map(v=>compact(v,depth+1,key));
  if(typeof value==="object"){
    const out={};
    for(const [k,v] of Object.entries(value).slice(0,MAX_OBJECT_KEYS)){
      if(BLOCKED_KEY.test(k))continue;
      out[k]=compact(v,depth+1,k);
    }
    return out;
  }
  return safeText(value);
}
function jsonWithinLimit(value,maxChars=MAX_PROMPT_CHARS){
  let text=JSON.stringify(compact(value));
  if(text.length<=maxChars)return text;
  return JSON.stringify({notice:"Bloom trimmed oversized context for a safe AI request.",summary:safeText(text,maxChars-120)});
}
function systemPrompt(persona){return `${persona||"Lily"} is Bloom's florist business assistant. Be practical, warm, concise, and accurate. Never claim an action was saved, published, paid, or completed unless the app confirms it. Suggestions are editable and require florist approval. Avoid expensive or unnecessary services and favor low-cost workflows.`}
export function deterministicAiFallback(payload={}){
  const persona=String(payload.persona||"Lily").trim()||"Lily";
  const prompt=String(payload.prompt||payload.task||"").toLowerCase();
  let text="Tell me what needs to be finished, when it is due, and any order, inventory, customer, or budget details that matter. I will turn it into a short next-step checklist.";
  if(/inventory|stock|reorder|stem/.test(prompt))text="Review low-stock items and oldest arrivals first, reserve stems for confirmed orders, then make a reorder list from the remaining demand.";
  else if(/order|deliver|customer/.test(prompt))text="Check each open order's due time, payment status, card message, address, and delivery notes, then handle the earliest customer promise first.";
  else if(/price|pricing|margin|profit|cost/.test(prompt))text="Add flower, hard-goods, and labor costs, divide by your target cost percentage, then compare the result with similar recent orders before discounting.";
  if(payload.mode==="generate")return {result:{text},provider:"Florisyn local fallback",model:"deterministic"};
  return {answer:text,persona,provider:"Florisyn local fallback",model:"deterministic"};
}
async function cloudflareAi(payload){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AI_API_TOKEN;
  if(!account||!token)return deterministicAiFallback(payload);
  const model=process.env.CLOUDFLARE_AI_MODEL||MODEL_DEFAULT;
  const user=payload.mode==="generate"
    ?`Task: ${safeText(payload.task,1200)}\nInput: ${jsonWithinLimit(payload.input||{},30000)}\nReturn ONLY valid JSON matching this shape: ${jsonWithinLimit(payload.schema||{text:"result"},5000)}`
    :`Question: ${safeText(payload.prompt,4000)}\nRelevant Bloom context: ${jsonWithinLimit(payload.context||{},32000)}`;
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"system",content:systemPrompt(payload.persona)},{role:"user",content:user}],max_tokens:payload.mode==="generate"?700:550,temperature:.35})});
  const d=await r.json();if(!r.ok||!d.success)throw new Error(d.errors?.[0]?.message||"Cloud AI request failed");
  const text=d.result?.response||d.result?.result||"";
  if(payload.mode==="generate")return {result:cleanJson(text)||{text},provider:"Cloudflare Workers AI",model,promptChars:user.length};
  return {answer:text,persona:payload.persona||"Lily",provider:"Cloudflare Workers AI",model,promptChars:user.length};
}
export async function handler(event){
  const ready=preflight(event);if(ready)return ready;if(event.httpMethod!=="POST")return methodNotAllowed();
  try{await currentUser(event);const payload=bodyOf(event);if(!payload.prompt&&!payload.task)return json(400,{error:"Add a prompt or task."});return json(200,await cloudflareAi(payload))}
  catch(error){return json(error.statusCode||500,{error:error.message||"AI unavailable"})}
}
