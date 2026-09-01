#!/usr/bin/env node
/**
 * Batch 6 ("Preview path + CI + provider cleanup + live-readiness"), Part
 * K — the controlled live-provider acceptance harness.
 *
 * PREPARED, NOT RUN. Per Part K/Q: this session does not have a deployed
 * preview environment or staging credentials, and Batch 6 explicitly
 * forbids performing that deployment or making a live provider call
 * without separate authorization. This script has been reviewed for
 * correctness but has never been executed against a real preview or a
 * real provider.
 *
 * Usage (only once a florisyn-marketing-staging preview is deployed and
 * authorized — see docs/MARKETING_PREVIEW_PATH.md and
 * docs/MARKETING_LIVE_ACCEPTANCE.md):
 *
 *   MARKETING_ACCEPTANCE_BASE_URL="https://deploy-preview-N--florisyn-marketing-staging.netlify.app" \
 *   MARKETING_ACCEPTANCE_AUTH_TOKEN="<a real staging session token>" \
 *   FLORISYN_ENV=preview \
 *   node scripts/marketing-live-acceptance.mjs "<one of the four Part L prompts>"
 *
 * Design constraints this script honors, taken directly from Part K:
 *   - Exactly one bounded run per test prompt. A prompt that already has
 *     a recorded result (for the SAME commit SHA) is never silently
 *     re-run — the first result is the test result. Rerunning against a
 *     different commit is a new, distinct run (a new SHA is a genuinely
 *     different build under test).
 *   - Fails closed via the exact same preview-environment guard the rest
 *     of Batch 6 uses (Part B), checked BOTH locally (this script's own
 *     process.env — a defense-in-depth check, in case it's ever run
 *     accidentally against a misconfigured local env pointed at
 *     production) and against the real deployed target's own
 *     /.netlify/functions/marketing-preview-status endpoint (the only
 *     place the TARGET's actual environment can be verified from
 *     outside it).
 *   - Records exactly what Part M's report format asks for — never more
 *     than what the real API surface actually returned. A field the API
 *     doesn't expose is recorded as null with a note, never guessed or
 *     fabricated.
 *   - No auto-regeneration loop of any kind. One create_content_item,
 *     one generate_content, and the exact untouched first result is what
 *     gets reported — never a "try again until it looks better" loop.
 */
import fs from "node:fs";
import path from "node:path";
import { assertSafeMarketingPreviewEnvironment } from "../netlify/functions/_shared/marketing-preview-environment-guard.js";

const OUTPUT_DIR = process.env.MARKETING_ACCEPTANCE_OUTPUT_DIR || path.join(process.cwd(), "acceptance-results", "marketing-live");

function resultPath(promptId, commitShaShort) {
  return path.join(OUTPUT_DIR, `${promptId}--${commitShaShort || "unknown-commit"}.json`);
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

async function verifyTargetIsSafe(baseUrl) {
  const { ok, status, body } = await fetchJson(`${baseUrl.replace(/\/$/, "")}/.netlify/functions/marketing-preview-status`);
  if (!ok || !body || body.safeForMarketingPreview !== true) {
    const violations = body?.violations || [`status endpoint returned HTTP ${status}`];
    throw Object.assign(new Error(`Refusing to run: target does not report itself as a safe Marketing preview environment.\n${violations.join("\n")}`), {
      code: "unsafe_marketing_acceptance_target",
      violations
    });
  }
  return body.build || null;
}

/**
 * One bounded run for one prompt. Never called in a loop that retries on
 * a bad-looking result — see the module docstring.
 */
async function runOnePrompt({ baseUrl, authToken, promptId, promptText, shopId }) {
  const build = await verifyTargetIsSafe(baseUrl);
  if (!build || !build.commitSha) {
    throw new Error("Refusing to run: target's build stamp did not expose a real commit SHA. Cannot record which commit was actually tested.");
  }

  const existing = resultPath(promptId, build.commitShaShort);
  if (fs.existsSync(existing)) {
    console.log(`Result already exists for prompt "${promptId}" at commit ${build.commitShaShort} — the first result is the test result. Not re-running.`);
    console.log(`See: ${existing}`);
    return JSON.parse(fs.readFileSync(existing, "utf8"));
  }

  const headers = { "content-type": "application/json", authorization: `Bearer ${authToken}` };
  const usageBefore = await fetchJson(`${baseUrl}/.netlify/functions/marketing-studio-shop?action=usage_summary`, { headers });

  const created = await fetchJson(`${baseUrl}/.netlify/functions/marketing-studio-shop?action=create_content_item`, {
    method: "POST",
    headers,
    body: JSON.stringify({ brief: promptText, platforms: ["facebook"] })
  });
  if (!created.ok || !created.body?.item?.id) {
    return recordAndReturn(buildReport({ promptId, promptText, shopId, build, verdict: "fail", failureReason: `create_content_item failed: HTTP ${created.status} — ${JSON.stringify(created.body)}` }));
  }
  const contentItemId = created.body.item.id;

  // Exactly one generate_content call — the real text provider call, the
  // real image provider call, and (per the real generate_content
  // pipeline) runMarketingImageQuality's real vision inspection all
  // happen inside this single request. No second call, no regeneration.
  const generated = await fetchJson(`${baseUrl}/.netlify/functions/marketing-studio-shop?action=generate_content`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content_item_id: contentItemId })
  });

  const usageAfter = await fetchJson(`${baseUrl}/.netlify/functions/marketing-studio-shop?action=usage_summary`, { headers });
  const beforeIds = new Set((usageBefore.body?.items || []).map(rowIdentity));
  const newUsageRows = (usageAfter.body?.items || []).filter((r) => !beforeIds.has(rowIdentity(r)));

  const report = buildReport({
    promptId,
    promptText,
    shopId,
    build,
    verdict: generated.ok ? "recorded" : "fail",
    failureReason: generated.ok ? null : `generate_content failed: HTTP ${generated.status} — ${JSON.stringify(generated.body)}`,
    contentItemId,
    generateResponseRaw: generated.body,
    newUsageRows
  });
  return recordAndReturn(report);
}

function rowIdentity(row) {
  // usage_summary rows have no stable id in the API response — created_at
  // + provider + purpose + cost is the closest honest identity available
  // for a before/after diff without widening that response further.
  return `${row.created_at}|${row.provider}|${row.purpose}|${row.estimated_cost_cents}|${row.actual_cost_cents}|${row.status}`;
}

function buildReport({ promptId, promptText, shopId, build, verdict, failureReason, contentItemId = null, generateResponseRaw = null, newUsageRows = [] }) {
  // Exactly Part M's field list. A field the real API surface does not
  // expose is null with an explanatory note — never guessed.
  const asset = generateResponseRaw?.asset || null;
  return {
    prompt_id: promptId,
    prompt_text: promptText,
    commit_sha: build.commitSha,
    commit_sha_short: build.commitShaShort,
    preview_url: null, // filled in by the caller from baseUrl at record time
    environment: build.environment,
    shop_id: shopId,
    provider: newUsageRows[0]?.provider ?? null,
    model: newUsageRows[0]?.model ?? null,
    provider_call_count: newUsageRows.filter((r) => r.purpose === "copy" || r.purpose === "text").length,
    image_attempt_count: newUsageRows.filter((r) => r.purpose === "image").length,
    // The real API surface does not expose a separate vision-call count
    // today — runMarketingImageQuality's vision inspection is internal to
    // generate_content and only observable via server logs/trace_id, not
    // the client response. Recorded honestly as unknown rather than
    // guessed from the image_attempt_count.
    vision_call_count: null,
    estimated_cost_cents: newUsageRows.reduce((s, r) => s + (r.estimated_cost_cents || 0), 0),
    actual_cost_cents: newUsageRows.reduce((s, r) => s + (r.actual_cost_cents || 0), 0),
    // Same honesty note: the client-facing generate_content response does
    // not include a raw quality-gate verdict field or an explicit
    // fallback-used flag. What IS observable from the outside is recorded
    // (usage rows, provider, cost_source) — a real PASS/FALLBACK/FAIL
    // read requires either widening generate_content's own response
    // (a separate, explicitly-authorized change) or reading server logs
    // for the same trace_id.
    quality_gate_verdict: "not exposed by generate_content's API response — see note",
    safety_verdict: null,
    canonical_concept: generateResponseRaw?.copy ?? null,
    fallback_used: newUsageRows.some((r) => r.cost_source === "fallback") ? true : newUsageRows.length ? false : null,
    first_untouched_caption: generateResponseRaw?.copy?.caption ?? null,
    first_untouched_image_reference: asset?.url ?? asset?.id ?? null,
    approval_readiness: asset?.type === "flyer" ? "requires finalize_flyer_render before Approve is enabled — not observed by this harness call alone" : "unknown — not observed by this harness call alone",
    pass_fail: verdict === "fail" ? "fail" : "recorded — pass/fail against Part L's criteria requires human/Ashley review of the actual content",
    failure_reason: failureReason,
    content_item_id: contentItemId,
    generate_response_raw: generateResponseRaw,
    new_usage_rows: newUsageRows,
    recorded_at: new Date().toISOString()
  };
}

function recordAndReturn(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = resultPath(report.prompt_id, report.commit_sha_short);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  console.log(`Recorded: ${file}`);
  return report;
}

async function main() {
  const promptText = process.argv[2];
  if (!promptText) {
    console.error("Usage: node scripts/marketing-live-acceptance.mjs \"<prompt text>\"");
    process.exitCode = 1;
    return;
  }
  // Local defense-in-depth check (Part B: "callable by ... acceptance-test
  // bootstrap") — this is IN ADDITION TO, never a substitute for,
  // verifyTargetIsSafe()'s check of the actual deployed target below.
  assertSafeMarketingPreviewEnvironment(process.env);

  const baseUrl = process.env.MARKETING_ACCEPTANCE_BASE_URL;
  const authToken = process.env.MARKETING_ACCEPTANCE_AUTH_TOKEN;
  const shopId = process.env.MARKETING_ACCEPTANCE_SHOP_ID || null;
  if (!baseUrl || !authToken) {
    throw new Error("MARKETING_ACCEPTANCE_BASE_URL and MARKETING_ACCEPTANCE_AUTH_TOKEN are both required.");
  }

  const promptId = process.env.MARKETING_ACCEPTANCE_PROMPT_ID || promptText.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const report = await runOnePrompt({ baseUrl, authToken, promptId, promptText, shopId });
  report.preview_url = baseUrl;
  console.log(JSON.stringify(report, null, 2));
}

// Only runs when invoked directly (`node scripts/marketing-live-acceptance.mjs ...`),
// never as a side effect of another module importing it for its exported
// functions (buildReport/rowIdentity are unit-tested this way).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
  });
}

export { buildReport, rowIdentity, resultPath, verifyTargetIsSafe, runOnePrompt };
