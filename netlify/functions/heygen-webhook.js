/**
 * HeyGen inbound webhook receiver — Creative AI engineering pass.
 *
 * Replaces poll-only dependence for avatar-video completion with a real
 * push path, while marketing-heygen-client.js's getHeygenVideoStatus()
 * remains fully intact as a fallback (nothing about polling was removed
 * — see clone_job_status in marketing-studio.js, unchanged).
 *
 * NOT LIVE — PROVIDER CONFIGURATION REQUIRED until:
 *   1. HEYGEN_WEBHOOK_SECRET is set (the per-endpoint secret HeyGen
 *      returns from its own "Create Endpoint" API — NOT the general
 *      HEYGEN_API_KEY), and
 *   2. A HeyGen webhook endpoint is actually registered (via HeyGen's own
 *      dashboard/API) pointing at this function's real deployed URL.
 * Until both exist, this function always returns 503 and never processes
 * anything — it does not fake a working webhook.
 *
 * Payload shape below (event_type/event_data.video_id/event_data.url) is
 * HeyGen's own documented `avatar_video.success`/`avatar_video.fail`
 * shape (developers.heygen.com/docs/webhook-events, confirmed this
 * research pass). Signature format itself carries the same LOWER
 * CONFIDENCE flag as the rest of the HeyGen integration — see
 * _shared/creative-ai/heygen-webhook-verify.js's header.
 *
 * Security posture: this is a public, unauthenticated endpoint by
 * necessity (HeyGen calls it directly, not a Florisyn user) — trust comes
 * entirely from the HMAC signature, never from a bearer token. Every
 * inbound request is logged via structured, secret-free JSON
 * (console.warn with a fixed shape) — no signature, secret, or raw
 * payload body ever appears in a log line, only correlation IDs and
 * classified reasons.
 */

import { admin } from "./_shared/supabase.js";
import { verifyHeygenWebhookSignature } from "./_shared/creative-ai/heygen-webhook-verify.js";
import { hashPayload, recordWebhookEvent, markWebhookEventProcessed } from "./_shared/creative-ai/webhook-events-store.js";
import { applyWebhookStatusUpdate } from "./_shared/creative-ai/clone-video-jobs.js";

const EVENT_STATUS_MAP = Object.freeze({
  "avatar_video.success": "completed",
  "avatar_video.fail": "failed"
});

function log(message, extra = {}) {
  console.warn(JSON.stringify({ level: "warn", fn: "heygen-webhook", message, ...extra }));
}

/**
 * Core logic, dependency-injectable for handler-level tests (same pattern
 * as handleStripeOrderWebhook in stripe-order-webhook.js) — no real
 * network/database connection needed to test every branch.
 */
export async function handleHeygenWebhook(event, dependencies = {}) {
  const getClient = dependencies.admin || admin;
  const verifySignature = dependencies.verifyHeygenWebhookSignature || verifyHeygenWebhookSignature;

  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const secret = process.env.HEYGEN_WEBHOOK_SECRET;
  if (!secret) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: "NOT LIVE — PROVIDER CONFIGURATION REQUIRED. HEYGEN_WEBHOOK_SECRET is not set; register a webhook endpoint with HeyGen and configure its returned secret before this can receive real events."
      })
    };
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : Buffer.from(event.body || "", "utf8");
  const signatureHeader = event.headers?.["heygen-signature"] || event.headers?.["Heygen-Signature"];
  const timestampHeader = event.headers?.["heygen-timestamp"] || event.headers?.["Heygen-Timestamp"];

  const verification = verifySignature({ rawBody, signatureHeader, timestampHeader, secret });

  let payload = null;
  let parseError = null;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    parseError = error;
  }

  const eventType = payload?.event_type ? String(payload.event_type) : "unknown";
  const videoId = payload?.event_data?.video_id ? String(payload.event_data.video_id) : "unknown";
  const resultUrl = payload?.event_data?.url || null;

  const client = getClient();
  const payloadHash = hashPayload(rawBody);

  let recorded;
  try {
    recorded = await recordWebhookEvent(client, {
      provider: "heygen",
      eventType,
      externalJobId: videoId,
      payloadHash,
      signatureValid: verification.valid,
      rawPayload: payload
    });
  } catch (error) {
    log("event_store_failed", { reason: String(error?.message || error) });
    return { statusCode: 500, body: "Could not record webhook event." };
  }

  // Never trust an arbitrary inbound payload — a bad signature stops
  // everything right here, after being logged for audit purposes, before
  // any job-state change is even considered.
  if (!verification.valid) {
    log("signature_rejected", { reason: verification.reason, videoId });
    return { statusCode: 401, body: "Signature verification failed." };
  }

  if (recorded.isDuplicate) {
    // Idempotent replay/retry-safe: HeyGen (or a network layer) redelivering
    // the exact same event is acknowledged without doing any work twice.
    return { statusCode: 200, body: JSON.stringify({ ok: true, duplicate: true }) };
  }

  if (parseError) {
    await markWebhookEventProcessed(client, recorded.event.id, { status: "failed", error: "malformed_json_body" });
    log("malformed_json_body");
    return { statusCode: 400, body: "Malformed JSON body." };
  }

  const newStatus = EVENT_STATUS_MAP[eventType];
  if (!newStatus) {
    // Unrecognized/uninteresting event type — acknowledge so HeyGen
    // doesn't retry-loop on something Florisyn deliberately doesn't act on.
    await markWebhookEventProcessed(client, recorded.event.id, { status: "processed" });
    return { statusCode: 200, body: JSON.stringify({ ok: true, note: `Event type "${eventType}" is not handled; acknowledged only.` }) };
  }

  try {
    const applied = await applyWebhookStatusUpdate(client, {
      provider: "heygen",
      providerJobId: videoId,
      status: newStatus,
      resultUrl,
      error: newStatus === "failed" ? String(payload?.event_data?.error || "HeyGen reported a failed render.").slice(0, 500) : null
    });
    await markWebhookEventProcessed(client, recorded.event.id, { status: "processed" });
    if (!applied.found) {
      // Real, expected case: a webhook for a video_id Florisyn never
      // recorded a job for (e.g. delivered against a stale/rotated
      // endpoint, or a render started outside Florisyn's own flow).
      // Acknowledge — retrying won't make it correlate.
      log("job_not_found", { videoId });
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, correlated: applied.found, alreadyTerminal: applied.alreadyTerminal }) };
  } catch (error) {
    await markWebhookEventProcessed(client, recorded.event.id, { status: "failed", error: String(error?.message || error) });
    log("status_update_failed", { reason: String(error?.message || error) });
    return { statusCode: 500, body: "Could not apply job status update." };
  }
}

export async function handler(event) {
  return handleHeygenWebhook(event);
}
