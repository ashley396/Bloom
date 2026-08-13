import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser } from "./_shared/supabase.js";
import { systemPromptFor, temperatureForPersona, normalizePersona } from "./_shared/florist-ai-personas.js";

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
  return JSON.stringify({notice:"Florisyn trimmed oversized context for a safe AI request.",summary:safeText(text,maxChars-120)});
}
function systemPrompt(persona, mode = "chat") {
  return systemPromptFor(persona, mode);
}

export function cloudflareAiToken(env = process.env) {
  return String(env.CLOUDFLARE_AI_API_TOKEN || env.CLOUDFLARE_AI_TOKEN || "").trim();
}

/** Normalize Workers AI run payloads across model variants. */
export function extractCloudflareText(result) {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (typeof result.result === "string") return result.result;
  if (typeof result.output === "string") return result.output;
  if (Array.isArray(result.choices) && result.choices[0]?.message?.content) {
    return String(result.choices[0].message.content);
  }
  return "";
}

async function cloudflareAi(payload){
  const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||"").trim();
  const token=cloudflareAiToken();
  if(!account||!token){const e=new Error("Cloud AI is not configured; Florisyn will try the free local AI fallback.");e.statusCode=503;throw e}
  const model=process.env.CLOUDFLARE_AI_MODEL||MODEL_DEFAULT;
  const persona = normalizePersona(payload.persona);
  const mode = payload.mode === "generate" ? "generate" : "chat";
  const user=payload.mode==="generate"
    ?`Task: ${safeText(payload.task,1200)}\nInput: ${jsonWithinLimit(payload.input||{},30000)}\nReturn ONLY valid JSON matching this shape: ${jsonWithinLimit(payload.schema||{text:"result"},5000)}`
    :`Question: ${safeText(payload.prompt,4000)}\nRelevant Florisyn context: ${jsonWithinLimit(payload.context||{},32000)}`;
  // Model slug (e.g. "@cf/meta/llama-3.1-8b-instruct-fast") must stay literal in the path —
  // encodeURIComponent turns its "/" into "%2F", which Cloudflare rejects as "No route for that URI".
  const url=`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
  const maxTokens=Math.min(1200,Math.max(400,Number(payload.max_tokens)||(mode==="generate"?800:550)));
  const temperature=temperatureForPersona(persona, mode);
  const r=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"system",content:systemPrompt(persona, mode)},{role:"user",content:user}],max_tokens:maxTokens,temperature})});
  let d={};
  try{d=await r.json()}catch{
    const e=new Error(`Cloud AI returned a non-JSON response (${r.status}).`);
    e.statusCode=r.status||502;
    throw e;
  }
  if(!r.ok||d.success===false){
    const detail=d.errors?.[0]?.message||d.errors?.[0]?.code||`Cloud AI request failed (${r.status})`;
    console.error(JSON.stringify({level:"error",message:"cloudflare_ai_failed",status:r.status,detail}));
    throw new Error(detail);
  }
  const text=extractCloudflareText(d.result);
  if(!text.trim()) throw new Error("Cloud AI returned an empty response. Check CLOUDFLARE_AI_API_TOKEN Workers AI permissions.");
  if(payload.mode==="generate")return {result:cleanJson(text)||{text},provider:"Cloudflare Workers AI",model,promptChars:user.length};
  return {answer:text,persona,provider:"Cloudflare Workers AI",model,promptChars:user.length};
}

/** Shared Cloudflare generate/chat entry for other Netlify handlers. */
export async function runCloudflareGenerate(payload) {
  return cloudflareAi(payload);
}

export async function handler(event){
  const ready=preflight(event);if(ready)return ready;if(event.httpMethod!=="POST")return methodNotAllowed();
  try{await currentUser(event);const payload=bodyOf(event);if(!payload.prompt&&!payload.task)return json(400,{error:"Add a prompt or task."});return json(200,await cloudflareAi(payload))}
  catch(error){return json(error.statusCode||500,{error:error.message||"AI unavailable"})}
}
