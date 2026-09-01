/**
 * Marketing Studio preview/status route (Batch 6, Part B/D).
 *
 * The one real place the preview environment guard (marketing-preview-
 * environment-guard.js) and the build stamp (public/florisyn-build-
 * info.json, written by scripts/stamp-build.mjs) are both surfaced
 * together — so the exact commit/branch/environment a preview deploy is
 * actually running, and whether that environment is genuinely safe for
 * Marketing generation, can be verified from one URL rather than
 * inferred. Read-only, no auth required (nothing here is a secret — a
 * hostname, a commit SHA, and a list of violation MESSAGES, never a
 * credential value), and it never itself performs any generation or
 * mutation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { json } from "./_shared/http.js";
import { checkSafeMarketingPreviewEnvironment } from "./_shared/marketing-preview-environment-guard.js";

function readBuildInfo() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // netlify/functions/ -> ../../public/florisyn-build-info.json
    const buildInfoPath = path.join(here, "../../public/florisyn-build-info.json");
    return JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
  } catch {
    // Never written yet (e.g. a local run that skipped the build step) —
    // an honest null, never a fabricated commit/environment.
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "GET only." });
  }
  const { ok, errors } = checkSafeMarketingPreviewEnvironment(process.env);
  const build = readBuildInfo();
  return json(ok ? 200 : 412, {
    safeForMarketingPreview: ok,
    violations: errors,
    build
  });
}
