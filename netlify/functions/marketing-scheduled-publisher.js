/**
 * The real durable scheduler trigger (launch-blocker pass, Blocker 3).
 *
 * Before this pass, Florisyn could STORE a scheduled_at time
 * (marketing_platform_variants / marketing_publishing_jobs.next_attempt_at)
 * but nothing ever woke up to act on it — only a manually-invoked admin
 * action (`run_publishing_queue`) processed due jobs, and only when
 * someone happened to click it. This is the unattended trigger: a Netlify
 * Scheduled Function, configured via netlify.toml
 * (`[functions."marketing-scheduled-publisher"] schedule = "..."`),
 * invoked automatically by Netlify's own scheduler on that cadence —
 * no external cron service, no paid scheduler vendor, using
 * infrastructure this project is already on.
 *
 * NOT DEPLOYED as part of this pass — the netlify.toml schedule entry
 * exists in the repository, but nothing about committing/pushing code to
 * this PR branch triggers a production Netlify build or activates a
 * scheduled invocation (per the standing "no production deploy" rule
 * every prior pass in this repo has followed). This file becomes live
 * only once merged and deployed to a site where Netlify's scheduler is
 * actually enabled for it.
 *
 * Runs the SAME claim+process engine
 * (_shared/marketing-publishing-worker.js) that the admin-triggered
 * `run_publishing_queue` action uses, across EVERY shop at once (no
 * shop_id — nobody is making a per-shop request on a timer). The claim
 * step is what makes this safe to run alongside a concurrent manual
 * admin trigger, or alongside itself if a previous tick is still
 * finishing when the next one fires: both call sites atomically claim
 * (queued->running, re-checked) before processing, so the same job can
 * never be picked up twice.
 *
 * Authorization: Netlify's own platform is what prevents this function
 * from being invoked as an ordinary public HTTP endpoint once
 * `schedule` is configured — direct requests are rejected before
 * reaching this handler, the same trust boundary every Netlify Scheduled
 * Function relies on (there is no browser-reachable identity to check a
 * JWT against here, matching heygen-webhook.js's equivalent reasoning
 * for its own unauthenticated-by-necessity trigger). The header check
 * below is a defense-in-depth best-effort signal on top of that
 * platform-level gate, not the primary control.
 */

import { admin } from "./_shared/supabase.js";
import { runPublishingWorker } from "./_shared/marketing-publishing-worker.js";

const BATCH_LIMIT = 50;

function log(message, extra = {}) {
  console.warn(JSON.stringify({ level: "warn", fn: "marketing-scheduled-publisher", message, ...extra }));
}

export function createScheduledPublisherHandler(deps = {}) {
  const getClient = deps.getClient || admin;

  return async function handler(event) {
    // Best-effort defense-in-depth signal (see module doc) — Netlify's own
    // scheduler is the real trust boundary. Never throws on a missing/odd
    // header shape; this never blocks a genuine scheduled invocation.
    const invokedBySchedule = event?.headers?.["x-netlify-event"] === "schedule";
    if (event?.httpMethod && event.httpMethod !== "POST" && !invokedBySchedule) {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const client = getClient();
    const startedAt = new Date();
    try {
      // No shopId — claim due jobs across every shop. Each processed job
      // still runs shop-scoped (marketing-publishing-worker.js re-checks
      // shop_id when it reads the variant), so nothing here needs its own
      // tenant filter beyond what the worker already enforces per job.
      const results = await runPublishingWorker(client, { shopId: null, limit: BATCH_LIMIT, now: startedAt });
      const summary = results.reduce((acc, r) => {
        acc[r.outcome] = (acc[r.outcome] || 0) + 1;
        return acc;
      }, {});
      log("scheduled_run_complete", { processed: results.length, summary });
      return { statusCode: 200, body: JSON.stringify({ processed: results.length, summary }) };
    } catch (error) {
      // A scheduled function that throws is retried by Netlify per its own
      // policy — logging here is for visibility, not a substitute for the
      // job-level retry/backoff/dead-letter machinery, which already
      // handles per-job failures independently of this outer try/catch.
      log("scheduled_run_failed", { reason: String(error?.message || error) });
      return { statusCode: 500, body: JSON.stringify({ error: "scheduled publishing run failed" }) };
    }
  };
}

export const handler = createScheduledPublisherHandler();
