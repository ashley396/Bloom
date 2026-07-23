export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}
export function methodNotAllowed() { return json(405, { error: "Method not allowed" }); }
export function parseBody(event) {
  try { return event.body ? JSON.parse(event.body) : {}; }
  catch { throw new Error("Invalid JSON request body"); }
}
