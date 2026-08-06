export function corsOrigin(env = process.env) {
  const site = String(env.SITE_URL || env.URL || "").trim().replace(/\/$/, "");
  return site || "https://florisyn-staging.netlify.app";
}

export function json(statusCode, body, env = process.env) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": corsOrigin(env),
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
    },
    body: JSON.stringify(body)
  };
}
export function preflight(event, env = process.env){ return event.httpMethod === "OPTIONS" ? json(204,{},env) : null; }
export function bodyOf(event){
  try { return event.body ? JSON.parse(event.body) : {}; }
  catch { const e = new Error("Invalid request body"); e.statusCode = 400; throw e; }
}
export function methodNotAllowed(){ return json(405,{error:"Method not allowed"}); }
