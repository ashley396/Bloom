# FLORISYN staging capacity tests

This suite exercises the deployed Netlify login function and authenticated dashboard path. It refuses an unrecognized non-staging URL unless `ALLOW_NON_STAGING=true` is also set. Never use that override without a separately approved production test window.

## Prerequisites

- Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/).
- Create staging-only synthetic accounts. Do not use customer accounts.
- Copy `users.example.json` to an ignored file such as `users.staging.json`; provide at least as many distinct accounts as VUs for realistic login tests.
- Obtain written approval for the staging load window and confirm Netlify/Supabase quotas first.
- Watch Netlify function latency/errors and Supabase Auth, API, database, pooler, CPU, memory, and I/O reports while each test runs.

The repository ignores `users.*.json` except the safe example fixture.

## Commands

Run from `load-tests/k6`.

```bash
BASE_URL=https://florisyn-staging.netlify.app \
ALLOW_LOAD_TEST=true \
USERS_FILE=./users.staging.json \
SCENARIO=baseline \
k6 run --summary-export=baseline-summary.json florisyn-auth-capacity.js
```

```bash
BASE_URL=https://florisyn-staging.netlify.app \
ALLOW_LOAD_TEST=true \
USERS_FILE=./users.staging.json \
SCENARIO=burst \
k6 run --summary-export=burst-summary.json florisyn-auth-capacity.js
```

```bash
BASE_URL=https://florisyn-staging.netlify.app \
ALLOW_LOAD_TEST=true \
USERS_FILE=./users.staging.json \
SCENARIO=sustained \
k6 run --summary-export=sustained-summary.json florisyn-auth-capacity.js
```

The sustained 10,000-VU test should run on distributed load generators, not one developer laptop. A normal loop waits 60 seconds, yielding about 167 dashboard requests/second at 10,000 active sessions; adjust `THINK_TIME_SECONDS` only when the target workload model has been approved.

## Safety and interpretation

- Start at 50, 100, 250, and 500 VUs before running 1,000.
- Run the 3,000-in-10-seconds burst only after the 1,000-login gate passes.
- Stop if unexpected errors exceed 1%, database CPU stays above 80% for five minutes, database connections exceed 80% of the tier, memory begins swapping, or p99 login latency exceeds eight seconds.
- HTTP 429 is a controlled overload response, but more than the configured threshold still fails the test.
- Do not retry password failures. Do not load-test signup, email, SMS, payments, or external AI providers in this suite.
- Delete synthetic accounts and tenant rows after the approved test window.
