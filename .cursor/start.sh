#!/usr/bin/env bash
# Per-boot reconciliation for the Florisyn / Bloom Cloud Agent environment.
#
# Brings up the local PostgreSQL 16 cluster that the RLS / db test suites and
# the `db:*` and `test:*-rls` npm scripts connect to, then ensures the Florisyn
# test login role and database exist. Mirrors the isolated Postgres used by
# .github/workflows/p0-required-checks.yml. Safe to run repeatedly.
set -uo pipefail

# 1. Start the PostgreSQL 16 cluster if it is not already running.
if command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo pg_ctlcluster 16 main start 2>/dev/null || true
fi

# 2. Wait briefly for the server to accept connections.
for _ in $(seq 1 15); do
  if sudo -u postgres pg_isready -q 2>/dev/null; then
    break
  fi
  sleep 1
done

# 3. Ensure the test login role exists (superuser, matches CI + local scripts).
sudo -u postgres psql -v ON_ERROR_STOP=0 -c \
  "DO \$\$ BEGIN CREATE ROLE florisyn_test LOGIN SUPERUSER PASSWORD 'florisyn_test'; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" \
  >/dev/null 2>&1 || true

# 4. Ensure the test database exists, owned by the test role.
if ! sudo -u postgres psql -tAc \
  "SELECT 1 FROM pg_database WHERE datname='florisyn_community_test'" 2>/dev/null | grep -q 1; then
  sudo -u postgres createdb -O florisyn_test florisyn_community_test 2>/dev/null || true
fi

echo "Florisyn start: PostgreSQL 16 online; test role/database ensured."
