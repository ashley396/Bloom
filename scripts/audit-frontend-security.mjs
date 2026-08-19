#!/usr/bin/env node
/**
 * P0-03 R1 / R2 — Strict temporary frontend dependency security policy.
 *
 * Allows only GHSA-qwww-vcr4-c8h2 for react-router / react-router-dom @ 7.18.2
 * under non-RSC, unpublished-preview conditions. Expires 2026-08-15.
 *
 * Exception gates (version / expiry / publish / RSC) run only when that
 * approved advisory is present. Clean audits pass without those restrictions.
 *
 * Not a general allowlist. Review owner: Technical Director.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APPROVED_ADVISORY_ID = "GHSA-qwww-vcr4-c8h2";
export const APPROVED_ROUTER_PACKAGES = Object.freeze(["react-router", "react-router-dom"]);
export const APPROVED_ROUTER_VERSION = "7.18.2";
export const EXCEPTION_EXPIRES_ON = "2026-08-15"; // exclusive after this calendar date (UTC)

const RSC_DEP_NAMES = Object.freeze([
  "react-server-dom-webpack",
  "react-server-dom-parcel",
  "react-server-dom-turbopack",
  "@react-router/node",
  "@react-router/serve",
  "@react-router/dev"
]);

const RSC_SOURCE_PATTERNS = Object.freeze([
  /\bcreateRequestHandler\b/,
  /\bServerRouter\b/,
  /\bRSCRouter\b/,
  /["']use server["']/,
  /\breact-server-dom\b/
]);

function fail(message, details = []) {
  const err = new Error(message);
  err.details = details;
  err.code = "FRONTEND_SECURITY_POLICY";
  return err;
}

function normalizeAdvisoryId(id) {
  return id ? String(id).toUpperCase() : null;
}

function advisoryIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const match = url.match(/GHSA-[a-z0-9-]+/i);
  return match ? normalizeAdvisoryId(match[0]) : null;
}

function collectAdvisoriesForPackage(vulns, packageName, seen = new Set()) {
  if (!packageName || seen.has(packageName)) return [];
  seen.add(packageName);
  const entry = vulns[packageName];
  if (!entry) return [];

  const advisories = [];
  for (const via of entry.via || []) {
    if (typeof via === "string") {
      advisories.push(...collectAdvisoriesForPackage(vulns, via, seen));
      continue;
    }
    if (via && typeof via === "object") {
      const id = advisoryIdFromUrl(via.url) || (typeof via.id === "string" ? via.id : null);
      advisories.push({
        id: id ? String(id).toUpperCase() : null,
        name: via.name || packageName,
        severity: String(via.severity || entry.severity || "").toLowerCase(),
        title: via.title || "",
        url: via.url || "",
        packageName
      });
    }
  }
  return advisories;
}

function readResolvedRouterVersions(lockfile) {
  const packages = lockfile?.packages || {};
  const rr = packages["node_modules/react-router"]?.version;
  const rrd = packages["node_modules/react-router-dom"]?.version;
  return { reactRouter: rr || null, reactRouterDom: rrd || null };
}

function netlifyPublishesFrontendDist(netlifyTomlText) {
  const text = String(netlifyTomlText || "");
  // Match publish = "frontend/dist" or publish = 'frontend/dist' (with optional spaces).
  return /^\s*publish\s*=\s*["']frontend\/dist["']\s*$/m.test(text);
}

function dependencyNamesFromPackageJson(pkg) {
  const names = new Set();
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(pkg?.[section] || {})) names.add(name);
  }
  return names;
}

function scanFrontendSourceForRsc(files) {
  const hits = [];
  for (const file of files || []) {
    const content = String(file.content || "");
    for (const pattern of RSC_SOURCE_PATTERNS) {
      if (pattern.test(content)) {
        hits.push(`${file.path}: matches ${pattern}`);
      }
    }
  }
  return hits;
}

function utcDateString(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw fail("Invalid evaluation date for frontend security policy.");
  return d.toISOString().slice(0, 10);
}

function collectHighOrCriticalFindings(vulns) {
  const highOrCritical = [];

  for (const [packageName, entry] of Object.entries(vulns)) {
    const severity = String(entry?.severity || "").toLowerCase();
    if (severity !== "high" && severity !== "critical") continue;

    const advisories = collectAdvisoriesForPackage(vulns, packageName);
    if (!advisories.length) {
      // Package marked high/critical but no resolvable advisory objects after via walk.
      highOrCritical.push({
        packageName,
        severity,
        id: null,
        title: "unresolved high/critical vulnerability entry"
      });
      continue;
    }
    for (const adv of advisories) {
      highOrCritical.push({
        packageName,
        severity: adv.severity || severity,
        id: adv.id,
        title: adv.title,
        url: adv.url
      });
    }
  }

  const unique = [];
  const seenKeys = new Set();
  for (const item of highOrCritical) {
    const key = `${item.packageName}|${item.id || item.title}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    unique.push(item);
  }
  return unique;
}

function assertApprovedExceptionGates({
  now,
  netlifyToml,
  frontendPackageJson,
  frontendLockfile,
  frontendSourceFiles
}) {
  const today = utcDateString(now);
  if (today > EXCEPTION_EXPIRES_ON) {
    throw fail(
      `Temporary frontend security exception expired after ${EXCEPTION_EXPIRES_ON} (UTC date now ${today}).`
    );
  }

  if (netlifyPublishesFrontendDist(netlifyToml)) {
    throw fail("Temporary frontend security exception invalid: netlify.toml publishes frontend/dist.");
  }

  const depNames = dependencyNamesFromPackageJson(frontendPackageJson);
  const rscDeps = RSC_DEP_NAMES.filter((name) => depNames.has(name));
  if (rscDeps.length) {
    throw fail("Temporary frontend security exception invalid: RSC/server-router dependency present.", rscDeps);
  }

  const sourceHits = scanFrontendSourceForRsc(frontendSourceFiles);
  if (sourceHits.length) {
    throw fail(
      "Temporary frontend security exception invalid: RSC/server-routing source markers found.",
      sourceHits
    );
  }

  const { reactRouter, reactRouterDom } = readResolvedRouterVersions(frontendLockfile);
  if (reactRouter !== APPROVED_ROUTER_VERSION || reactRouterDom !== APPROVED_ROUTER_VERSION) {
    throw fail(
      `react-router and react-router-dom must both resolve to exact ${APPROVED_ROUTER_VERSION}.`,
      [`react-router=${reactRouter}`, `react-router-dom=${reactRouterDom}`]
    );
  }

  const declared = frontendPackageJson?.dependencies?.["react-router-dom"];
  if (declared !== APPROVED_ROUTER_VERSION) {
    throw fail(
      `frontend/package.json must pin react-router-dom exactly to "${APPROVED_ROUTER_VERSION}" (no ^ or ~).`,
      [`declared=${declared}`]
    );
  }
}

/**
 * Pure policy evaluator — injectable for tests.
 * @returns {{ ok: true, exceptionActive: boolean, message: string } | never throws}
 */
export function evaluateFrontendSecurityPolicy({
  audit,
  now = new Date(),
  netlifyToml = "",
  frontendPackageJson = {},
  frontendLockfile = {},
  frontendSourceFiles = []
} = {}) {
  if (audit == null || typeof audit !== "object" || Array.isArray(audit)) {
    throw fail("Frontend audit JSON is missing or malformed.");
  }
  if (!audit.vulnerabilities || typeof audit.vulnerabilities !== "object") {
    throw fail("Frontend audit JSON is missing a vulnerabilities object.");
  }

  const unique = collectHighOrCriticalFindings(audit.vulnerabilities);

  if (!unique.length) {
    return {
      ok: true,
      exceptionActive: false,
      message: "Frontend dependency security policy passed with no high or critical vulnerabilities."
    };
  }

  const disallowed = [];
  let approvedHits = 0;

  for (const item of unique) {
    if (item.severity === "critical") {
      disallowed.push(item);
      continue;
    }
    const allowedPackage = APPROVED_ROUTER_PACKAGES.includes(item.packageName);
    const allowedAdvisory = normalizeAdvisoryId(item.id) === normalizeAdvisoryId(APPROVED_ADVISORY_ID);
    if (item.severity === "high" && allowedPackage && allowedAdvisory) {
      approvedHits += 1;
      continue;
    }
    disallowed.push(item);
  }

  if (disallowed.length) {
    throw fail("Frontend dependency security policy failed for high/critical findings.", disallowed.map((d) =>
      `${d.severity} ${d.id || "unknown"} on ${d.packageName}${d.title ? ` (${d.title})` : ""}`
    ));
  }

  if (approvedHits > 0) {
    // Exception-only gates apply only when the approved advisory is actually required.
    assertApprovedExceptionGates({
      now,
      netlifyToml,
      frontendPackageJson,
      frontendLockfile,
      frontendSourceFiles
    });
    return {
      ok: true,
      exceptionActive: true,
      message: `Temporary frontend security exception active: ${APPROVED_ADVISORY_ID}`,
      approvedHits
    };
  }

  return {
    ok: true,
    exceptionActive: false,
    message: "Frontend dependency security policy passed with no high or critical vulnerabilities."
  };
}

function defaultRunAudit(cwd) {
  const result = spawnSync("npm", ["--prefix", "frontend", "audit", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null
  };
}

function listFrontendSourceFiles(root) {
  const srcRoot = path.join(root, "frontend", "src");
  const files = [];
  if (!fs.existsSync(srcRoot)) return files;
  const stack = [srcRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        files.push({
          path: path.relative(root, full),
          content: fs.readFileSync(full, "utf8")
        });
      }
    }
  }
  return files;
}

export function runFrontendSecurityAudit(deps = {}) {
  const root = deps.root || process.cwd();
  const runAudit = deps.runAudit || defaultRunAudit;
  const now = deps.now || new Date();

  const auditResult = runAudit(root);
  if (auditResult.error && !auditResult.stdout) {
    throw fail(`Frontend npm audit command failed: ${auditResult.error.message || auditResult.error}`);
  }

  const raw = String(auditResult.stdout || "").trim();
  if (!raw) {
    throw fail("Frontend npm audit produced no JSON output.", [
      `status=${auditResult.status}`,
      `stderr=${String(auditResult.stderr || "").slice(0, 500)}`
    ]);
  }

  let audit;
  try {
    audit = JSON.parse(raw);
  } catch (err) {
    throw fail("Frontend audit JSON is malformed and cannot be parsed.", [err.message]);
  }

  const netlifyToml = deps.netlifyToml ?? fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  const frontendPackageJson =
    deps.frontendPackageJson ??
    JSON.parse(fs.readFileSync(path.join(root, "frontend/package.json"), "utf8"));
  const frontendLockfile =
    deps.frontendLockfile ??
    JSON.parse(fs.readFileSync(path.join(root, "frontend/package-lock.json"), "utf8"));
  const frontendSourceFiles = deps.frontendSourceFiles ?? listFrontendSourceFiles(root);

  return evaluateFrontendSecurityPolicy({
    audit,
    now,
    netlifyToml,
    frontendPackageJson,
    frontendLockfile,
    frontendSourceFiles
  });
}

function main() {
  try {
    const result = runFrontendSecurityAudit();
    console.log(result.message);
    if (result.exceptionActive) {
      console.log(
        [
          `Approved advisory: ${APPROVED_ADVISORY_ID}`,
          `Approved packages: ${APPROVED_ROUTER_PACKAGES.join(", ")} @ ${APPROVED_ROUTER_VERSION}`,
          `Exception expires: ${EXCEPTION_EXPIRES_ON} (UTC)`,
          "Review owner: Technical Director",
          "Rationale: client-only BrowserRouter; Netlify publish=public/; frontend/dist not published; no RSC/server-router usage."
        ].join("\n")
      );
    }
    process.exitCode = 0;
  } catch (err) {
    console.error(err.message || err);
    if (Array.isArray(err.details) && err.details.length) {
      for (const line of err.details) console.error(`- ${line}`);
    }
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) main();
