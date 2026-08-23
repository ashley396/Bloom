/**
 * Generic inbound-webhook event ledger (marketing_webhook_events) —
 * provider-independent so a future ElevenLabs/Cartesia/video-provider
 * webhook can reuse this exact table/helpers rather than each provider
 * growing its own dedup mechanism.
 *
 * Idempotency key is deterministic from the event's own content
 * (`${provider}:${eventType}:${externalJobId}:${payloadHash}`), not a
 * random UUID — so a genuine redelivery of the *same* event (HeyGen
 * retries on a missed ack, or a network-level duplicate) always produces
 * the same key and gets recognized as a duplicate, while two different
 * real state transitions for the same job (e.g. "processing" then
 * "completed") get distinct keys because their payload differs, so
 * neither is ever mistaken for a duplicate of the other.
 *
 * This table is service-role only (no anon/authenticated grants) — an
 * inbound webhook is verified by cryptographic signature, never by a
 * shop-member JWT, so there is nothing for RLS to check it against; see
 * FUNCTION-ACCESS-TIERS.md's platform_admins precedent for the same
 * "no browser-reachable grants" pattern.
 */

import { createHash } from "node:crypto";

export function hashPayload(rawBody) {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  return createHash("sha256").update(buf).digest("hex");
}

export function buildWebhookIdempotencyKey({ provider, eventType, externalJobId, payloadHash }) {
  return `${provider}:${eventType}:${externalJobId}:${payloadHash}`;
}

/**
 * Records an inbound webhook event. Returns { isDuplicate, event }.
 * A row with signatureValid=false is still recorded (so a forged-signature
 * attempt leaves an audit trail) but is never handed to a status-updating
 * caller — see heygen-webhook.js, which checks signatureValid before
 * calling applyWebhookStatusUpdate().
 */
export async function recordWebhookEvent(
  client,
  { provider, eventType, externalJobId, payloadHash, signatureValid, rawPayload } = {}
) {
  const idempotencyKey = buildWebhookIdempotencyKey({ provider, eventType, externalJobId, payloadHash });
  const existing = await client
    .from("marketing_webhook_events")
    .select("id,status,provider,event_type,external_job_id,signature_valid,received_at,processed_at")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { isDuplicate: true, event: existing.data };

  const inserted = await client
    .from("marketing_webhook_events")
    .insert({
      provider,
      event_type: eventType,
      external_job_id: externalJobId,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      signature_valid: Boolean(signatureValid),
      raw_payload: rawPayload ?? null,
      status: signatureValid ? "received" : "rejected"
    })
    .select("id,status,provider,event_type,external_job_id,signature_valid,received_at,processed_at")
    .single();
  if (inserted.error) throw inserted.error;
  return { isDuplicate: false, event: inserted.data };
}

export async function markWebhookEventProcessed(client, eventId, { status, error } = {}) {
  const updated = await client
    .from("marketing_webhook_events")
    .update({
      status,
      error_message: error ? String(error).slice(0, 500) : null,
      processed_at: new Date().toISOString()
    })
    .eq("id", eventId)
    .select("id,status")
    .maybeSingle();
  if (updated.error) throw updated.error;
  return updated.data;
}
