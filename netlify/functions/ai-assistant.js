import { json, preflight, methodNotAllowed } from "./_shared/http.js";

export async function handler(event){
  const ready=preflight(event);
  if(ready)return ready;
  if(!["GET","POST"].includes(event.httpMethod))return methodNotAllowed();
  return json(409,{
    configured:false,
    provider:"Bloom Local AI",
    localOnly:true,
    error:"Lily uses free local Ollama only. Open Ollama and start START-BLOOM-AI-WINDOWS.bat on the computer using Bloom."
  });
}
