import express from "express";
import { spawn } from "node:child_process";

const app = express();
const HOST = process.env.BLOOM_AI_HOST || "127.0.0.1";
const PORT = Number(process.env.BLOOM_AI_PORT || 11435);
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.BLOOM_AI_MODEL || "llama3.1:8b";
const ALLOWED_ORIGINS = new Set((process.env.BLOOM_ALLOWED_ORIGINS || "https://bloom-technologies.netlify.app,http://localhost:8888,http://localhost:5173").split(",").map(x=>x.trim()).filter(Boolean));

app.disable("x-powered-by");
app.use(express.json({limit:"12mb"}));
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(origin && (ALLOWED_ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))){
    res.setHeader("Access-Control-Allow-Origin",origin);
    res.setHeader("Vary","Origin");
    res.setHeader("Access-Control-Allow-Headers","Content-Type");
    res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  }
  if(req.method==="OPTIONS") return res.status(204).end();
  if(origin && !res.getHeader("Access-Control-Allow-Origin")) return res.status(403).json({error:"This website is not allowed to use Bloom Local AI."});
  next();
});

async function ollama(path, options={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(), Number(options.timeout||90000));
  try{
    const response=await fetch(`${OLLAMA_URL}${path}`,{...options,signal:controller.signal,headers:{"Content-Type":"application/json",...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error||`Ollama returned ${response.status}`);
    return data;
  }catch(error){
    if(error.name==="AbortError") throw new Error("The local AI request timed out.");
    if(/fetch failed|ECONNREFUSED/i.test(String(error.message))) throw new Error("Ollama is not running. Open Ollama, then try again.");
    throw error;
  }finally{clearTimeout(timeout)}
}

async function status(){
  try{
    const data=await ollama("/api/tags",{method:"GET",timeout:5000});
    const models=(data.models||[]).map(m=>({name:m.name,size:m.size,modified_at:m.modified_at}));
    return {bridge:true,ollama:true,healthy:true,defaultModel:DEFAULT_MODEL,models,defaultAvailable:models.some(m=>m.name===DEFAULT_MODEL || m.name.startsWith(DEFAULT_MODEL.split(":")[0]+":"))};
  }catch(error){return {bridge:true,ollama:false,healthy:false,defaultModel:DEFAULT_MODEL,models:[],defaultAvailable:false,error:error.message}}
}

app.get("/health",async(_req,res)=>res.json(await status()));
app.get("/models",async(_req,res)=>res.json(await status()));

app.post("/models/install",async(req,res)=>{
  const model=String(req.body?.model||DEFAULT_MODEL).trim();
  if(!/^[a-zA-Z0-9._:/-]+$/.test(model)) return res.status(400).json({error:"Invalid model name."});
  const child=spawn("ollama",["pull",model],{shell:process.platform==="win32"});
  let output="";
  child.stdout.on("data",d=>output+=d.toString()); child.stderr.on("data",d=>output+=d.toString());
  child.on("error",()=>res.status(503).json({error:"Ollama is not installed or could not be started."}));
  child.on("close",code=>code===0?res.json({ok:true,model,message:`${model} is installed.`}):res.status(500).json({error:`Model installation failed (code ${code}).`,details:output.slice(-2000)}));
});

const personaInstructions={
  Lily:"You are Lily, Bloom's creative florist assistant. Be warm, upbeat, practical, florist-focused, and concise. Help with floral recipes, pricing, product descriptions, marketing, substitutions, and waste reduction. Never invent shop facts or inventory.",
  Rose:"You are Rose, Bloom's seasoned business manager. Be direct, protective of profit, gently witty, and never rude. Help with sales, margins, expenses, unpaid balances, inventory, deliveries, and business decisions. Never invent numbers."
};

app.post("/chat",async(req,res)=>{
  try{
    const model=String(req.body?.model||DEFAULT_MODEL);
    const prompt=String(req.body?.prompt||"").trim();
    const persona=req.body?.persona==="Rose"?"Rose":"Lily";
    const context=req.body?.context||{};
    if(!prompt) return res.status(400).json({error:"Enter a question first."});
    const data=await ollama("/api/chat",{method:"POST",body:JSON.stringify({model,stream:false,format:req.body?.format==="json"?"json":undefined,options:{temperature:persona==="Rose"?.2:.45,num_predict:700},messages:[{role:"system",content:personaInstructions[persona]},{role:"user",content:`SHOP DATA (use only when relevant):\n${JSON.stringify(context)}\n\nQUESTION:\n${prompt}`}]}),timeout:120000});
    const answer=String(data.message?.content||"").trim();
    if(!answer) throw new Error("The model returned an empty response.");
    res.json({answer,persona,model,local:true});
  }catch(error){res.status(503).json({error:error.message||"Bloom Local AI is unavailable."})}
});

app.post("/generate",async(req,res)=>{
  try{
    const model=String(req.body?.model||DEFAULT_MODEL), task=String(req.body?.task||"content"), input=req.body?.input||{};
    const schema=req.body?.schema||{result:"string"};
    const prompt=`You are Bloom's florist operations engine. Complete the ${task} task. Return VALID JSON ONLY matching this example shape: ${JSON.stringify(schema)}. Do not use markdown. INPUT: ${JSON.stringify(input)}`;
    const data=await ollama("/api/chat",{method:"POST",body:JSON.stringify({model,stream:false,format:"json",options:{temperature:.25,num_predict:900},messages:[{role:"system",content:"You produce accurate florist-focused structured data. Never invent shop-specific facts. Return JSON only."},{role:"user",content:prompt}]}),timeout:120000});
    const raw=String(data.message?.content||"");
    let result; try{result=JSON.parse(raw)}catch{throw new Error("The model returned invalid structured data. Try again.")}
    res.json({result,model,local:true});
  }catch(error){res.status(503).json({error:error.message||"Structured generation failed."})}
});

const server=app.listen(PORT,HOST,()=>console.log(`Bloom Local AI Bridge running at http://${HOST}:${PORT}\nOllama: ${OLLAMA_URL}\nDefault model: ${DEFAULT_MODEL}`));
if(process.argv.includes("--check")){setTimeout(async()=>{console.log(await status());server.close()},300)}
