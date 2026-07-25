import { json, preflight, methodNotAllowed } from "./_shared/http.js";
export async function handler(event){const ready=preflight(event);if(ready)return ready;if(event.httpMethod!=="POST")return methodNotAllowed();return json(409,{error:"Lily's writing helper now uses Bloom Local AI. Start the local bridge and try again."});}
