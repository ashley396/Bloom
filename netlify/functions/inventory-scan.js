import { json, preflight, methodNotAllowed } from "./_shared/http.js";
export async function handler(event){const ready=preflight(event);if(ready)return ready;if(event.httpMethod!=="POST")return methodNotAllowed();return json(409,{error:"Photo inventory scanning now requires a local vision model and is not enabled in this foundation release. CSV import remains available."});}
