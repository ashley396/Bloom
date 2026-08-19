/** Florist-filed support tickets (pure validation). */

const MAX_SUBJECT = 120;
const MAX_BODY = 2000;

export function validateTicketPayload(body = {}) {
  const rawSubject = String(body.subject || "").trim();
  const rawBody = String(body.body || body.description || "").trim();
  if (!rawBody) return { ok: false, error: "Describe what's going on before sending it in." };
  const subject = (rawSubject || rawBody).slice(0, MAX_SUBJECT);
  return {
    ok: true,
    payload: {
      subject,
      body: rawBody.slice(0, MAX_BODY)
    }
  };
}
