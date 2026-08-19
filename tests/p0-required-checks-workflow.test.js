/**
 * P0-03 / P0-03 R1 — Required PR CI workflow + frontend security policy regressions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  APPROVED_ADVISORY_ID,
  APPROVED_ROUTER_VERSION,
  EXCEPTION_EXPIRES_ON,
  evaluateFrontendSecurityPolicy,
  runFrontendSecurityAudit
} from "../scripts/audit-frontend-security.mjs";

const WORKFLOW_PATH = path.join(process.cwd(), ".github/workflows/p0-required-checks.yml");

function loadWorkflow() {
  assert.ok(fs.existsSync(WORKFLOW_PATH), "workflow file must exist");
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

function approvedLockfile(version = APPROVED_ROUTER_VERSION) {
  return {
    packages: {
      "node_modules/react-router": { version },
      "node_modules/react-router-dom": { version }
    }
  };
}

function approvedPackageJson(version = APPROVED_ROUTER_VERSION) {
  return {
    dependencies: {
      "react-router-dom": version
    }
  };
}

function baseContext(overrides = {}) {
  return {
    now: new Date("2026-08-01T12:00:00.000Z"),
    netlifyToml: 'publish = "public"\n',
    frontendPackageJson: approvedPackageJson(),
    frontendLockfile: approvedLockfile(),
    frontendSourceFiles: [{ path: "frontend/src/main.tsx", content: 'import { BrowserRouter } from "react-router-dom";\n' }],
    ...overrides
  };
}

function auditWithApprovedException() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      "react-router": {
        severity: "high",
        via: [
          {
            name: "react-router",
            severity: "high",
            title: "React Router: RSC Mode CSRF Bypass",
            url: `https://github.com/advisories/${APPROVED_ADVISORY_ID}`
          }
        ]
      },
      "react-router-dom": {
        severity: "high",
        via: ["react-router"]
      }
    },
    metadata: { vulnerabilities: { high: 2, critical: 0, total: 2 } }
  };
}

test("P0 required-checks workflow triggers on pull_request to main", () => {
  const src = loadWorkflow();
  assert.match(src, /\bon:\s*\n\s*pull_request:/);
  assert.match(src, /pull_request:[\s\S]*branches:[\s\S]*-\s*main/);
  assert.match(src, /\bworkflow_dispatch:\s*$/m);
  assert.doesNotMatch(src, /\bpull_request_target\b/);
});

test("P0 required-checks workflow is contents:read only", () => {
  const src = loadWorkflow();
  assert.match(src, /permissions:\s*\n\s*contents:\s*read\s*$/m);
  assert.doesNotMatch(src, /permissions:[\s\S]*\b(write|contents:\s*write)\b/);
  assert.doesNotMatch(src, /\b(id-token|packages|pull-requests|actions):\s*write\b/);
});

test("P0 required-checks workflow uses Node.js 22", () => {
  const src = loadWorkflow();
  assert.match(src, /NODE_VERSION:\s*"22"/);
  assert.match(src, /node-version:\s*\$\{\{\s*env\.NODE_VERSION\s*\}\}/);
});

test("P0 required-checks workflow provides digest-pinned PostgreSQL 16 and both RLS suites", () => {
  const src = loadWorkflow();
  assert.match(
    src,
    /image:\s*postgres:16@sha256:33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20/
  );
  assert.match(src, /PostgreSQL 16/);
  assert.match(src, /npm run test:community-rls/);
  assert.match(src, /npm run test:floral-library-rls/);
  assert.match(src, /COMMUNITY_TEST_DATABASE_URL:/);
  assert.match(src, /FLORAL_LIBRARY_TEST_DATABASE_URL:/);
  assert.match(src, /CREATE ROLE florisyn_test/);
  assert.match(src, /Require both RLS suites to pass/);
});

test("P0 required-checks workflow has no deploy or production credentials", () => {
  const src = loadWorkflow();
  assert.doesNotMatch(src, /\b(netlify deploy|npm run deploy|wrangler deploy|vercel deploy)\b/i);
  assert.doesNotMatch(src, /\b(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|STRIPE_SECRET_KEY|NETLIFY_AUTH_TOKEN)\b/);
  assert.doesNotMatch(src, /\bsecrets\.[A-Z0-9_]+\b/);
  assert.doesNotMatch(src, /\b(production|staging)\s+migration\b/i);
});

test("P0 required-checks pins official actions to commit SHAs with version comments", () => {
  const src = loadWorkflow();
  assert.match(src, /uses:\s*actions\/checkout@[0-9a-f]{40}\s*#\s*v[\d.]+/);
  assert.match(src, /uses:\s*actions\/setup-node@[0-9a-f]{40}\s*#\s*v[\d.]+/);
  assert.match(src, /concurrency:[\s\S]*cancel-in-progress:\s*true/);
});

test("P0 required-checks runs root audit and frontend security policy without suppression", () => {
  const src = loadWorkflow();
  assert.match(src, /^\s*-\s*name:\s*npm audit \(high\+\)\s*$/m);
  assert.match(src, /^\s*run:\s*npm audit --audit-level=high\s*$/m);
  assert.match(src, /^\s*-\s*name:\s*Frontend dependency security policy\s*$/m);
  assert.match(src, /^\s*run:\s*node scripts\/audit-frontend-security\.mjs\s*$/m);

  const frontendStep = src.split("Frontend dependency security policy")[1]?.split("\n\n")[0] || "";
  assert.doesNotMatch(frontendStep, /continue-on-error:\s*true/);
  assert.doesNotMatch(frontendStep, /\|\|\s*true/);
  assert.doesNotMatch(src, /npm audit fix/);
  assert.doesNotMatch(src, /--audit-level=high\s*\|\|/);
});

// ---------------------------------------------------------------------------
// Frontend security policy (P0-03 R1 / R2)
// ---------------------------------------------------------------------------

function cleanAudit() {
  return {
    vulnerabilities: {},
    metadata: { vulnerabilities: { high: 0, critical: 0, total: 0 } }
  };
}

test("policy allows exact approved advisory under approved conditions", () => {
  const result = evaluateFrontendSecurityPolicy({
    ...baseContext(),
    audit: auditWithApprovedException()
  });
  assert.equal(result.ok, true);
  assert.equal(result.exceptionActive, true);
  assert.match(result.message, /Temporary frontend security exception active: GHSA-qwww-vcr4-c8h2/);
  assert.doesNotMatch(result.message, /0 vulnerabilities/i);
});

test("policy fails another high advisory", () => {
  assert.throws(
    () =>
      evaluateFrontendSecurityPolicy({
        ...baseContext(),
        audit: {
          vulnerabilities: {
            lodash: {
              severity: "high",
              via: [
                {
                  name: "lodash",
                  severity: "high",
                  title: "Prototype pollution",
                  url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz"
                }
              ]
            }
          }
        }
      }),
    (err) => /failed for high\/critical findings/i.test(err.message)
  );
});

test("policy fails critical advisory", () => {
  assert.throws(
    () =>
      evaluateFrontendSecurityPolicy({
        ...baseContext(),
        audit: {
          vulnerabilities: {
            "react-router": {
              severity: "critical",
              via: [
                {
                  name: "react-router",
                  severity: "critical",
                  title: "Critical issue",
                  url: `https://github.com/advisories/${APPROVED_ADVISORY_ID}`
                }
              ]
            }
          }
        }
      }),
    (err) => /failed for high\/critical findings/i.test(err.message) && /critical/i.test(err.details.join(" "))
  );
});

test("policy fails malformed audit JSON through runner", () => {
  assert.throws(
    () =>
      runFrontendSecurityAudit({
        ...baseContext(),
        runAudit: () => ({ status: 1, stdout: "{not-json", stderr: "" })
      }),
    (err) => /malformed and cannot be parsed/i.test(err.message)
  );
});

test("policy fails audit command without JSON output", () => {
  assert.throws(
    () =>
      runFrontendSecurityAudit({
        ...baseContext(),
        runAudit: () => ({ status: 1, stdout: "", stderr: "npm ERR! network boom" })
      }),
    (err) => /produced no JSON output/i.test(err.message)
  );
});

test("policy fails additional advisory hidden through transitive via string", () => {
  assert.throws(
    () =>
      evaluateFrontendSecurityPolicy({
        ...baseContext(),
        audit: {
          vulnerabilities: {
            "react-router-dom": {
              severity: "high",
              via: ["react-router"]
            },
            "react-router": {
              severity: "high",
              via: [
                {
                  name: "react-router",
                  severity: "high",
                  title: "Approved CSRF",
                  url: `https://github.com/advisories/${APPROVED_ADVISORY_ID}`
                },
                {
                  name: "react-router",
                  severity: "high",
                  title: "Hidden second high",
                  url: "https://github.com/advisories/GHSA-hide-me-now-0000"
                }
              ]
            }
          }
        }
      }),
    (err) =>
      /failed for high\/critical findings/i.test(err.message)
      && /GHSA-HIDE-ME-NOW-0000/i.test(err.details.join(" "))
  );
});

test("policy fails router version other than 7.18.2", () => {
  assert.throws(
    () =>
      evaluateFrontendSecurityPolicy({
        ...baseContext({
          frontendPackageJson: approvedPackageJson("7.11.0"),
          frontendLockfile: approvedLockfile("7.11.0")
        }),
        audit: auditWithApprovedException()
      }),
    (err) => /must both resolve to exact 7\.18\.2/i.test(err.message)
  );
});

test("policy fails when netlify publishes frontend/dist", () => {
  assert.throws(
    () =>
      evaluateFrontendSecurityPolicy({
        ...baseContext({ netlifyToml: 'publish = "frontend/dist"\n' }),
        audit: auditWithApprovedException()
      }),
    (err) => /publishes frontend\/dist/i.test(err.message)
  );
});

test("policy fails RSC/server-router source markers", () => {
  assert.throws(
    () =>
      evaluateFrontendSecurityPolicy({
        ...baseContext({
          frontendSourceFiles: [
            { path: "frontend/src/server.tsx", content: "export const handler = createRequestHandler();\n" }
          ]
        }),
        audit: auditWithApprovedException()
      }),
    (err) => /RSC\/server-routing source markers/i.test(err.message)
  );
});

test("policy fails RSC/server-router dependency", () => {
  assert.throws(
    () =>
      evaluateFrontendSecurityPolicy({
        ...baseContext({
          frontendPackageJson: {
            dependencies: {
              "react-router-dom": APPROVED_ROUTER_VERSION,
              "react-server-dom-webpack": "19.0.0"
            }
          }
        }),
        audit: auditWithApprovedException()
      }),
    (err) => /RSC\/server-router dependency present/i.test(err.message)
  );
});

test("policy fails after 2026-08-15", () => {
  assert.throws(
    () =>
      evaluateFrontendSecurityPolicy({
        ...baseContext({ now: new Date("2026-08-16T00:00:00.000Z") }),
        audit: auditWithApprovedException()
      }),
    (err) => new RegExp(`expired after ${EXCEPTION_EXPIRES_ON}`).test(err.message)
  );
});

test("policy passes zero-high audit without using the exception", () => {
  const result = evaluateFrontendSecurityPolicy({
    ...baseContext(),
    audit: cleanAudit()
  });
  assert.equal(result.ok, true);
  assert.equal(result.exceptionActive, false);
  assert.match(result.message, /no high or critical vulnerabilities/i);
  assert.doesNotMatch(result.message, /Temporary frontend security exception active/);
});

test("R2: zero-high audit passes after 2026-08-15 without exception gates", () => {
  const result = evaluateFrontendSecurityPolicy({
    ...baseContext({ now: new Date("2026-08-16T00:00:00.000Z") }),
    audit: cleanAudit()
  });
  assert.equal(result.ok, true);
  assert.equal(result.exceptionActive, false);
  assert.match(result.message, /no high or critical vulnerabilities/i);
});

test("R2: zero-high audit passes with a different safely resolved router version", () => {
  const result = evaluateFrontendSecurityPolicy({
    ...baseContext({
      frontendPackageJson: approvedPackageJson("8.3.0"),
      frontendLockfile: approvedLockfile("8.3.0")
    }),
    audit: cleanAudit()
  });
  assert.equal(result.ok, true);
  assert.equal(result.exceptionActive, false);
});

test("R2: zero-high audit passes if frontend/dist is published", () => {
  const result = evaluateFrontendSecurityPolicy({
    ...baseContext({ netlifyToml: 'publish = "frontend/dist"\n' }),
    audit: cleanAudit()
  });
  assert.equal(result.ok, true);
  assert.equal(result.exceptionActive, false);
});

test("R2: zero-high audit passes when RSC/server-router code or dependencies exist", () => {
  const result = evaluateFrontendSecurityPolicy({
    ...baseContext({
      frontendPackageJson: {
        dependencies: {
          "react-router-dom": "8.3.0",
          "react-server-dom-webpack": "19.0.0"
        }
      },
      frontendLockfile: approvedLockfile("8.3.0"),
      frontendSourceFiles: [
        { path: "frontend/src/server.tsx", content: 'import { ServerRouter } from "react-router";\n' }
      ]
    }),
    audit: cleanAudit()
  });
  assert.equal(result.ok, true);
  assert.equal(result.exceptionActive, false);
});

test("live script accepts current frontend audit without temporary exception", () => {
  const result = runFrontendSecurityAudit({
    now: new Date("2026-08-01T15:00:00.000Z")
  });
  assert.equal(result.ok, true);
  assert.equal(result.exceptionActive, false);
  assert.match(result.message, /passed with no high or critical vulnerabilities/i);
});
