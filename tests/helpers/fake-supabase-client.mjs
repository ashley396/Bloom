/**
 * A minimal, dependency-free stand-in for a Supabase JS client, used by
 * handler-level tests that inject a fake `client`/`admin()` instead of
 * hitting a real database. It is not a query engine: each `.from(table)`
 * call returns a chainable builder that records every method call it
 * receives (`select`, `eq`, `in`, `update`, `insert`, `upsert`, ...) and,
 * when awaited (either directly or via a terminal `.single()` /
 * `.maybeSingle()`), resolves to the next `{ data, error }` pair from a
 * response queue you configure up front — mirroring how the real
 * `@supabase/supabase-js` query builder is itself a thenable.
 *
 * This intentionally keeps tests honest about *order*: responses are
 * consumed in the same sequence the handler under test issues queries, so
 * a test has to know (and therefore document, via its queued responses)
 * what the handler actually does — not just assert on source text.
 */

export function createFakeSupabaseClient(responses = [], { storage } = {}) {
  const queue = [...responses];
  const calls = [];

  function nextResponse() {
    if (queue.length === 0) return { data: null, error: null };
    return queue.shift();
  }

  function chain(table) {
    const record = { table, ops: [] };
    calls.push(record);

    const builder = {
      select(...args) {
        record.ops.push(["select", args]);
        return builder;
      },
      eq(...args) {
        record.ops.push(["eq", args]);
        return builder;
      },
      is(...args) {
        record.ops.push(["is", args]);
        return builder;
      },
      gte(...args) {
        record.ops.push(["gte", args]);
        return builder;
      },
      lte(...args) {
        record.ops.push(["lte", args]);
        return builder;
      },
      ilike(...args) {
        record.ops.push(["ilike", args]);
        return builder;
      },
      in(...args) {
        record.ops.push(["in", args]);
        return builder;
      },
      order(...args) {
        record.ops.push(["order", args]);
        return builder;
      },
      limit(...args) {
        record.ops.push(["limit", args]);
        return builder;
      },
      update(payload) {
        record.ops.push(["update", [payload]]);
        record.payload = payload;
        return builder;
      },
      insert(payload) {
        record.ops.push(["insert", [payload]]);
        record.payload = payload;
        return builder;
      },
      upsert(payload, ...rest) {
        record.ops.push(["upsert", [payload, ...rest]]);
        record.payload = payload;
        return builder;
      },
      delete(...args) {
        record.ops.push(["delete", args]);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(nextResponse());
      },
      single() {
        return Promise.resolve(nextResponse());
      },
      // Real supabase-js query builders are PromiseLike — awaiting a
      // `.update().eq()` chain directly (no terminal `.single()`) is a
      // normal, common pattern in this codebase.
      then(resolve, reject) {
        return Promise.resolve(nextResponse()).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    from(table) {
      return chain(table);
    },
    rpc(name, args) {
      calls.push({ rpc: name, args });
      return Promise.resolve(nextResponse());
    },
    storage: storage || {
      from() {
        throw new Error("fake client has no storage configured — pass { storage } to createFakeSupabaseClient");
      },
    },
    calls,
  };
}

/**
 * Minimal fake for the `.storage.from(bucket)` surface (upload/remove/
 * getPublicUrl) — pass as the `storage` option to createFakeSupabaseClient
 * for handlers that touch Supabase Storage. Queues are consumed in call
 * order per method, same pattern as the row-response queue above.
 */
export function createFakeSupabaseStorage({ uploadResponses = [], removeResponses = [], publicUrl } = {}) {
  const uploadQueue = [...uploadResponses];
  const removeQueue = [...removeResponses];
  const calls = [];
  return {
    calls,
    from(bucket) {
      return {
        upload(path, body, options) {
          calls.push({ op: "upload", bucket, path, options });
          return Promise.resolve(uploadQueue.length ? uploadQueue.shift() : { data: { path }, error: null });
        },
        remove(paths) {
          calls.push({ op: "remove", bucket, paths });
          return Promise.resolve(removeQueue.length ? removeQueue.shift() : { data: paths, error: null });
        },
        getPublicUrl(path) {
          calls.push({ op: "getPublicUrl", bucket, path });
          return { data: { publicUrl: publicUrl ? publicUrl(path) : `https://fake.storage/${bucket}/${path}` } };
        },
      };
    },
  };
}
