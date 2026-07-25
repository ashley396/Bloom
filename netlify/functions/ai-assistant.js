import { json, preflight, methodNotAllowed } from "./_shared/http.js";
export async function handler(event){const ready=preflight(event);if(ready)return ready;if(event.httpMethod!=="POST")return methodNotAllowed();return json(409,{error:"Bloom AI now runs locally. Start the Bloom Local AI Bridge on this computer, then try again."});}
