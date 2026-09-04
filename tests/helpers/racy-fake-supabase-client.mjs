/**
 * A REAL (if tiny) in-memory Postgres-like store — not a canned response
 * queue — used ONLY by the Batch 4.1 concurrency tests
 * (marketing-premium-creative-job-idempotency-race.test.js). The
 * ordinary fake-supabase-client.mjs plays back a scripted sequence of
 * `{data, error}` responses in call order, which is exactly right for
 * testing sequential handler logic but CANNOT prove anything about a
 * real concurrency race — it would just replay whatever outcome the
 * test author already decided.
 *
 * This client instead keeps real shared mutable state (in-memory Maps)
 * and enforces the SAME partial unique constraints the real Postgres
 * migration (20260904000000_premium_creative_job_idempotency.sql) adds:
 *   - ai_execution_jobs.idempotency_key (unique where not null)
 *   - marketing_generation_usage.operation_id (unique where not null AND
 *     provider='openai' AND operation='premium_creative_image')
 *
 * Two "concurrent" calls (kicked off via Promise.all without either one
 * being awaited first) really do race against this shared state: each
 * insert's conflict check happens synchronously against whatever is
 * ALREADY committed in the Map at the moment that specific insert runs —
 * never against a value decided ahead of time by the test. Because
 * JavaScript's single-threaded execution runs each call's synchronous
 * prefix in program order, exactly one of two truly-concurrent inserts
 * for the same key will see the Map still empty and win; the other will
 * always see the winner's row already present and receive a real
 * `{error: {code: "23505"}}` conflict — the same invariant a real
 * Postgres unique index guarantees, just made deterministic here by
 * calling order rather than by network/lock timing. That is exactly
 * what these tests need to prove: SOME caller wins, the OTHER gets a
 * well-defined conflict and must load-and-return the winner — never
 * both succeeding independently.
 */

function nowIso() {
  return new Date().toISOString();
}

function matchesFilters(row, filters) {
  return filters.every(([kind, col, val]) => {
    if (kind === "eq") return row[col] === val;
    if (kind === "in") return Array.isArray(val) && val.includes(row[col]);
    return true;
  });
}

function checkUniqueConflict(tables, table, row) {
  if (table === "ai_execution_jobs") {
    if (row.idempotency_key == null) return null;
    for (const existing of tables.ai_execution_jobs.values()) {
      if (existing.idempotency_key === row.idempotency_key) return existing;
    }
    return null;
  }
  if (table === "marketing_generation_usage") {
    if (row.operation_id == null) return null;
    // Mirrors marketing_generation_usage_premium_operation_uidx's own
    // narrow partial predicate exactly — never a bare global check.
    if (row.provider !== "openai" || row.operation !== "premium_creative_image") return null;
    for (const existing of tables.marketing_generation_usage.values()) {
      if (existing.operation_id === row.operation_id && existing.provider === "openai" && existing.operation === "premium_creative_image") {
        return existing;
      }
    }
    return null;
  }
  return null;
}

export function createRacyFakeSupabaseClient() {
  const tables = {
    ai_execution_jobs: new Map(),
    marketing_generation_usage: new Map()
  };
  let seq = 1;
  const calls = [];

  function chain(table) {
    const filters = [];
    let pendingOp = null; // { type: "insert" | "update", payload }
    let orderCol = null;
    let orderAscending = true;

    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push(["eq", col, val]);
        return builder;
      },
      in(col, vals) {
        filters.push(["in", col, vals]);
        return builder;
      },
      order(col, { ascending = true } = {}) {
        orderCol = col;
        orderAscending = ascending;
        return builder;
      },
      insert(payload) {
        pendingOp = { type: "insert", payload };
        return builder;
      },
      update(payload) {
        pendingOp = { type: "update", payload };
        return builder;
      },
      maybeSingle() {
        return execute(true);
      },
      single() {
        return execute(true);
      },
      then(resolve, reject) {
        return execute(false).then(resolve, reject);
      },
      catch(onRejected) {
        return execute(false).catch(onRejected);
      }
    };

    // Deliberately declared `async` but with NO internal `await` — the
    // entire check-and-mutate happens synchronously against the shared
    // Map, exactly once, at the moment this specific call is invoked.
    // This synchronous-body-then-resolved-promise shape is what makes
    // two "concurrent" callers genuinely race against real shared state
    // rather than against a pre-scripted outcome — see this module's
    // own doc comment above.
    async function execute(wantSingle) {
      calls.push({ table, op: pendingOp?.type || "select", filters: filters.map((f) => [...f]) });
      const store = tables[table];
      if (!store) return { data: null, error: { message: `racy fake client has no table "${table}"` } };

      if (pendingOp?.type === "insert") {
        const id = `${table}-${seq++}`;
        const row = { id, created_at: nowIso(), updated_at: nowIso(), ...pendingOp.payload };
        const conflict = checkUniqueConflict(tables, table, row);
        if (conflict) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        store.set(id, row);
        return wantSingle ? { data: row, error: null } : { data: [row], error: null };
      }

      if (pendingOp?.type === "update") {
        const matches = [...store.values()].filter((row) => matchesFilters(row, filters));
        const updated = [];
        for (const row of matches) {
          Object.assign(row, pendingOp.payload, { updated_at: nowIso() });
          updated.push(row);
        }
        return wantSingle ? { data: updated[0] || null, error: null } : { data: updated, error: null };
      }

      let matches = [...store.values()].filter((row) => matchesFilters(row, filters));
      if (orderCol) {
        matches = [...matches].sort((a, b) => {
          if (a[orderCol] < b[orderCol]) return orderAscending ? -1 : 1;
          if (a[orderCol] > b[orderCol]) return orderAscending ? 1 : -1;
          return 0;
        });
      }
      if (wantSingle) return { data: matches[0] || null, error: null };
      return { data: matches, error: null };
    }

    return builder;
  }

  return {
    from(table) {
      return chain(table);
    },
    calls,
    _tables: tables
  };
}
