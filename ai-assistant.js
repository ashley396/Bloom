import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser } from "./_shared/supabase.js";

const MODEL_DEFAULT="@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_PROMPT_CHARS=42000;
const MAX_STRING_CHARS=1800;
const MAX_ARRAY_ITEMS=18;

function cleanJson(text){
  const raw=String(text||"").trim().replace(/^```(?:json)?/i,"").replace(/```$/,"｣").replace(/｣$/,'').trim();
  try{return JSON.parse(raw)}catch{}
  const match=raw.match(/\{[\s\S]*\}/);if(match)try{return JSON.parse(match[0])}catch{}
  return null;
}

function text(value,max=MAX_STRING_CHARS){
  const valueText=String(value??"");
  return valueText.length>max?`${valueText.slice(0,max)}…`:valueText;
}

function compact(value,depth=0){
  if(value==null||typeof value==="number"||typeof value==="boolean")return value;
  if(typeof value==="string")return text(value);
  if(depth>=3)return "[trimmed]";
  if(Array.isArray(value))return value.slice(0,MAX_ARRAY_ITEMS).map(item=>compact(item,depth+1));
  if(typeof value==="object"){
    const out={};
    for(const [key,item] of Object.entries(value).slice(0,35))out[key]=compact(item,depth+1);
    return out;
  }
  return text(value);
}

function assistantArea(payload={}){
  const source=`${payload.task||""} ${payload.prompt||""}`.toLowerCase();
  if(/inventory|stock|stem|flower|vase|supply|recipe/.test(source))return "inventory";
  if(/price|pricing|profit|cost|margin|markup|payroll|expense|sales|business/.test(source))return "business";
  if(/website|seo|product description|homepage|web page|online store/.test(source))return "website";
  if(/facebook|instagram|marketing|caption|email campaign|sms|promotion|advertis/.test(source))return "marketing";
  if(/customer|recipient|crm|follow.?up|thank.?you/.test(source))return "customer";
  if(/delivery|route|mileage|driver|address/.test(source))return "delivery";
  if(/report|dashboard|trend|forecast|performance/.test(source))return "reports";
  return payload.persona==="Rose"?"business":"florist";
}

function areaInstructions(area){
  const prompts={
    florist:"Focus on floral design, flower care, recipes, sympathy wording, weddings, and practical shop-floor help.",
    business:"Focus on pricing, profit, sales, expenses, staffing, and low-cost operational decisions. Explain calculations clearly.",
    inventory:"Focus on relevant flower and supply quantities, colors, costs, reorder needs, recipes, and waste reduction.",
    website:"Focus on editable website copy, product descriptions, SEO, merchandising, and conversion-friendly florist content.",
    marketing:"Focus on ready-to-edit social posts, promotions, email/SMS wording, calls to action, and local florist marketing.",
    customer:"Focus on customer service, recipient details, follow-up wording, relationship notes, and privacy-conscious CRM help.",
    delivery:"Focus on delivery planning, addresses, timing, routing, mileage, and clear driver instructions.",
    reports:"Focus on concise business insights, trends, risks, and next actions supported by the supplied data."
  };
  return prompts[area]||prompts.florist;
}

function systemPrompt(persona,area){
  const name=persona||"Lily";
  const voice=name==="Rose"
    ?"Rose is an experienced, warm, candid florist-business mentor with gentle humor."
    :"Lily is a warm, upbeat, practical florist assistant.";
  return `${voice} ${areaInstructions(area)} Be concise, accurate, and useful. Never claim an action was saved, published, paid, or completed unless the app confirms it. Suggestions are editable and require florist approval. Protect private employee and customer information. Favor simple, low-cost workflows.`;
}

function relevantContext(context={},area="florist"){
  const common={shop:context.shop||{},screen:context.screen||context.current_screen||""};
  const pick={
    florist:{inventory:context.inventory,active_product:context.activeProduct||context.active_product,active_order:context.activeOrder||context.active_order},
    inventory:{inventory:context.inventory,active_product:context.activeProduct||context.active_product,recipes:context.recipes},
    business:{recent_orders:context.recent_orders||context.orders,expenses:context.expenses,summary:context.summary||context.dashboard},
    website:{website:context.website||context.shop,products:context.products,active_product:context.activeProduct||context.active_product},
    marketing:{shop:context.shop,products:context.products,active_product:context.activeProduct||context.active_product,campaign:context.campaign},
    customer:{active_customer:context.activeCustomer||context.active_customer,recent_orders:context.recent_orders||context.orders},
    delivery:{deliveries:context.deliveries,active_order:context.activeOrder||context.active_order,route:context.route},
    reports:{summary:context.summary||context.dashboard,recent_orders:context.recent_orders||context.orders,inventory:context.inventory,deliveries:context.deliveries}
  };
  const selected={...common,...(pick[area]||pick.florist)};
  if(Array.isArray(context.recentMessages))selected.recent_messages=context.recentMessages.slice(-8);
  return compact(selected);
}

function boundedJson(value,maxChars=MAX_PROMPT_CHARS){
  const raw=JSON.stringify(compact(value));
  if(raw.length<=maxChars)return raw;
  return `${raw.slice(0,maxChars)}\n[Context trimmed automatically by Bloom]`;
}

async function cloudflareAi(payload){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AI_API_TOKEN;
  if(!account||!token){const e=new Error("Cloud AI is not configured; Bloom will try the free local AI fallback.");e.statusCode=503;throw e}
  const model=process.env.CLOUDFLARE_AI_MODEL||MODEL_DEFAULT;
  const area=assistantArea(payload);
  let user;
  if(payload.mode==="generate"){
    user=`Task: ${text(payload.task,1200)}\nAssistant area: ${area}\nInput: ${boundedJson(payload.input||{},26000)}\nReturn ONLY valid JSON matching this shape: ${boundedJson(payload.schema||{text:"result"},5000)}`;
  }else{
    const context=relevantContext(payload.context||{},area);
    user=`Question: ${text(payload.prompt,5000)}\nAssistant area: ${area}\nRelevant Bloom context only: ${boundedJson(context)}`;
  }
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      messages:[{role:"system",content:systemPrompt(payload.persona,area)},{role:"user",content:user}],
      max_tokens:payload.mode==="generate"?700:550,
      temperature:.35
    })
  });
  const d=await r.json();
  if(!r.ok||!d.success){
    const message=d.errors?.[0]?.message||"Cloud AI request failed";
    const e=new Error(/context window|tokens/i.test(message)?"That request included too much information. Bloom trimmed the context, but the model still could not process it. Try a more specific question.":message);
    e.statusCode=r.status||500;
    throw e;
  }
  const responseText=d.result?.response||d.result?.result||"";
  if(payload.mode==="generate")return {result:cleanJson(responseText)||{text:responseText},provider:"Cloudflare Workers AI",model,area};
  return {answer:responseText,persona:payload.persona||"Lily",provider:"Cloudflare Workers AI",model,area};
}

export async function handler(event){
  const ready=preflight(event);if(ready)return ready;if(event.httpMethod!=="POST")return methodNotAllowed();
  try{
    await currentUser(event);
    const payload=bodyOf(event);
    if(!payload.prompt&&!payload.task)return json(400,{error:"Add a prompt or task."});
    return json(200,await cloudflareAi(payload));
  }catch(error){return json(error.statusCode||500,{error:error.message||"AI unavailable"})}
}
