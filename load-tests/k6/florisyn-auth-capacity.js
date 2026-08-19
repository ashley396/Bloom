import http from "k6/http";
import exec from "k6/execution";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = String(__ENV.BASE_URL || "").replace(/\/$/, "");
const SCENARIO = __ENV.SCENARIO || "baseline";
const USERS_FILE = __ENV.USERS_FILE || "./users.example.json";
const USERS = JSON.parse(open(USERS_FILE)).users || [];

if (!BASE_URL) throw new Error("BASE_URL is required");
if (__ENV.ALLOW_LOAD_TEST !== "true") {
  throw new Error("Set ALLOW_LOAD_TEST=true after confirming the staging-only target");
}
if (!/(staging|deploy-preview|localhost|127\.0\.0\.1)/i.test(BASE_URL) && __ENV.ALLOW_NON_STAGING !== "true") {
  throw new Error(`Refusing non-staging target: ${BASE_URL}`);
}
if (!USERS.length) throw new Error(`No synthetic users found in ${USERS_FILE}`);

const unexpectedErrors = new Rate("unexpected_errors");
const rateLimited = new Rate("rate_limited");
const loginSuccess = new Rate("login_success");
const loginLatency = new Trend("login_latency", true);
const coreLatency = new Trend("core_latency", true);

const commonThresholds = {
  unexpected_errors: ["rate<0.01"],
  login_success: [SCENARIO === "burst" ? "rate>0.95" : "rate>0.99"],
  rate_limited: [SCENARIO === "burst" ? "rate<0.05" : "rate<0.01"],
  "login_latency{endpoint:auth-login}": ["p(95)<2000", "p(99)<4000"],
  "core_latency{endpoint:dashboard}": ["p(95)<800", "p(99)<2000"],
};

const scenarios = {
  baseline: {
    executor: "per-vu-iterations",
    exec: "baselineLogin",
    vus: Number(__ENV.VUS || 1000),
    iterations: 1,
    maxDuration: __ENV.MAX_DURATION || "3m",
    gracefulStop: "15s",
  },
  burst: {
    executor: "constant-arrival-rate",
    exec: "burstLogin",
    rate: Number(__ENV.RATE || 300),
    timeUnit: "1s",
    duration: __ENV.DURATION || "10s",
    preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 1000),
    maxVUs: Number(__ENV.MAX_VUS || 3000),
    gracefulStop: "15s",
  },
  sustained: {
    executor: "ramping-vus",
    exec: "sustainedSession",
    startVUs: 0,
    stages: [
      { duration: __ENV.RAMP_UP || "10m", target: Number(__ENV.VUS || 10000) },
      { duration: __ENV.HOLD || "30m", target: Number(__ENV.VUS || 10000) },
      { duration: __ENV.RAMP_DOWN || "5m", target: 0 },
    ],
    gracefulRampDown: "2m",
    gracefulStop: "30s",
  },
};

if (!scenarios[SCENARIO]) throw new Error(`Unknown SCENARIO=${SCENARIO}`);

export const options = {
  discardResponseBodies: false,
  scenarios: { [SCENARIO]: scenarios[SCENARIO] },
  thresholds: commonThresholds,
  noConnectionReuse: false,
  userAgent: "florisyn-staging-capacity-test/1.0",
};

function testUser() {
  const rawIndex = Math.max(0, Number(exec.vu.idInTest || exec.scenario.iterationInTest + 1) - 1);
  const user = USERS[rawIndex % USERS.length];
  if (!user?.email || !user?.password) throw new Error(`Synthetic user ${rawIndex % USERS.length} is incomplete`);
  return user;
}

function login(user) {
  const response = http.post(
    `${BASE_URL}/api/auth-login`,
    JSON.stringify({ email: user.email, password: user.password }),
    {
      headers: { "Content-Type": "application/json" },
      timeout: __ENV.LOGIN_TIMEOUT || "8s",
      tags: { endpoint: "auth-login" },
    },
  );

  loginLatency.add(response.timings.duration, { endpoint: "auth-login" });
  rateLimited.add(response.status === 429);
  const ok = response.status === 200;
  loginSuccess.add(ok);
  unexpectedErrors.add(response.status >= 500 || (response.status !== 200 && response.status !== 429));

  if (!check(response, { "login returned 200 or controlled 429": (r) => r.status === 200 || r.status === 429 })) {
    return null;
  }
  if (!ok) return null;

  let body;
  try {
    body = response.json();
  } catch {
    unexpectedErrors.add(true);
    return null;
  }
  return body?.accessToken ? body : null;
}

function readCore(session) {
  const response = http.get(`${BASE_URL}/.netlify/functions/dashboard`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    timeout: __ENV.CORE_TIMEOUT || "8s",
    tags: { endpoint: "dashboard" },
  });
  coreLatency.add(response.timings.duration, { endpoint: "dashboard" });
  rateLimited.add(response.status === 429);
  unexpectedErrors.add(response.status >= 500 || ![200, 429].includes(response.status));
  check(response, { "dashboard returned 200 or controlled 429": (r) => r.status === 200 || r.status === 429 });
}

export function baselineLogin() {
  const session = login(testUser());
  if (session) readCore(session);
}

export function burstLogin() {
  login(testUser());
}

let sustainedSessionToken = null;

export function sustainedSession() {
  if (!sustainedSessionToken) sustainedSessionToken = login(testUser());
  if (sustainedSessionToken) readCore(sustainedSessionToken);
  sleep(Number(__ENV.THINK_TIME_SECONDS || 60));
}
