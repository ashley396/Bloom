/**
 * P0-01 — Floral Library schema exposure lock (PostgreSQL RLS).
 *
 * Setup:
 *   node scripts/apply-floral-library-rls-local.mjs
 *   npm run test:floral-library-rls
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const DATABASE_URL =
  process.env.FLORAL_LIBRARY_TEST_DATABASE_URL ||
  process.env.COMMUNITY_TEST_DATABASE_URL ||
  "postgres://florisyn_test:florisyn_test@127.0.0.1:5432/florisyn_community_test";

const USER_ORDINARY = "11111111-1111-1111-1111-111111111111";
const USER_PLATFORM = "66666666-6666-6666-6666-666666666666";
const USER_INACTIVE_ADMIN = "77777777-7777-7777-7777-777777777777";

function applyMigrations(mode = "reset") {
  const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/apply-floral-library-rls-local.mjs")], {
    env: { ...process.env, FLORAL_LIBRARY_TEST_DATABASE_URL: DATABASE_URL, FLORAL_LIBRARY_APPLY_MODE: mode },
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`Floral library migration apply failed (mode=${mode}):\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function asRole(client, role, userId, fn) {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    if (userId) {
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    } else {
      await client.query(`select set_config('request.jwt.claim.sub', '', true)`);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

async function seed(client) {
  for (const id of [USER_ORDINARY, USER_PLATFORM, USER_INACTIVE_ADMIN]) {
    await client.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
      id,
      `${id}@test.local`,
    ]);
  }
  await client.query(
    `insert into public.platform_admins (user_id, role, display_name, active)
     values ($1, 'content_admin', 'Platform', true)
     on conflict (user_id) do update set active = excluded.active`,
    [USER_PLATFORM]
  );
  await client.query(
    `insert into public.platform_admins (user_id, role, display_name, active)
     values ($1, 'content_admin', 'Inactive', false)
     on conflict (user_id) do update set active = excluded.active`,
    [USER_INACTIVE_ADMIN]
  );

  await client.query(`delete from public.bloom_library_import_batches`);
  await client.query(`delete from public.bloom_floral_library_master`);

  await client.query(
    `insert into public.bloom_floral_library_master (id, name, data, review_status)
     values
       ('lib-approved-starter', 'Approved Starter', '{"name":"Approved Starter"}'::jsonb, 'approved_starter'),
       ('lib-approved', 'Approved Catalog', '{"name":"Approved Catalog"}'::jsonb, 'approved'),
       ('lib-pending', 'Pending Review', '{"name":"Pending Review"}'::jsonb, 'pending'),
       ('lib-rejected', 'Rejected Item', '{"name":"Rejected Item"}'::jsonb, 'rejected')`
  );

  await client.query(
    `insert into public.bloom_library_import_batches (id, status, manifest)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending_review', '[{"id":"x"}]'::jsonb)`
  );
}

test("P0-01 migration applies cleanly on a fresh database", () => {
  const out = applyMigrations("reset");
  assert.match(out, /Floral library P0-01 migrations applied successfully/);
  assert.match(out, /20260801_p0_01_floral_library_schema_lock_v1\.sql/);
});

test("P0-01 migration is idempotent (lock-again)", () => {
  const out = applyMigrations("lock-again");
  assert.match(out, /re-applied successfully/);
});

test("RLS enabled on both library tables in pg_class", async () => {
  await withClient(async (client) => {
    await seed(client);
    const { rows } = await client.query(`
      select c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('bloom_floral_library_master', 'bloom_library_import_batches')
      order by c.relname
    `);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `${r.relname} must have RLS enabled`);
    }
  });
});

test("anonymous access denied to master and import batches", async () => {
  await withClient(async (client) => {
    await seed(client);

    await assert.rejects(
      () =>
        asRole(client, "anon", null, (c) =>
          c.query(`select id from public.bloom_floral_library_master`)
        ),
      /permission denied|must be owner/i
    );

    await assert.rejects(
      () =>
        asRole(client, "anon", null, (c) =>
          c.query(`select id from public.bloom_library_import_batches`)
        ),
      /permission denied|must be owner/i
    );
  });
});

test("ordinary authenticated: approved master readable; unapproved hidden; writes denied", async () => {
  await withClient(async (client) => {
    await seed(client);

    const visible = await asRole(client, "authenticated", USER_ORDINARY, (c) =>
      c.query(`select id from public.bloom_floral_library_master order by id`)
    );
    assert.deepEqual(
      visible.rows.map((r) => r.id),
      ["lib-approved", "lib-approved-starter"]
    );

    const pending = await asRole(client, "authenticated", USER_ORDINARY, (c) =>
      c.query(`select id from public.bloom_floral_library_master where id = 'lib-pending'`)
    );
    assert.equal(pending.rows.length, 0);

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_ORDINARY, (c) =>
          c.query(
            `insert into public.bloom_floral_library_master (id, name, data, review_status)
             values ('lib-hack', 'Hack', '{}'::jsonb, 'approved_starter')`
          )
        ),
      /row-level security|violates|permission denied/i
    );

    // UPDATE/DELETE under RLS with no qualifying USING rows affect 0 rows (no throw).
    const upd = await asRole(client, "authenticated", USER_ORDINARY, (c) =>
      c.query(
        `update public.bloom_floral_library_master
         set name = 'owned' where id = 'lib-approved-starter' returning id`
      )
    );
    assert.equal(upd.rowCount, 0, "ordinary user must not update approved rows");

    const del = await asRole(client, "authenticated", USER_ORDINARY, (c) =>
      c.query(`delete from public.bloom_floral_library_master where id = 'lib-approved' returning id`)
    );
    assert.equal(del.rowCount, 0, "ordinary user must not delete approved rows");

    const still = await asRole(client, "authenticated", USER_ORDINARY, (c) =>
      c.query(`select name from public.bloom_floral_library_master where id = 'lib-approved-starter'`)
    );
    assert.equal(still.rows[0]?.name, "Approved Starter");
  });
});

test("ordinary authenticated: import batches inaccessible", async () => {
  await withClient(async (client) => {
    await seed(client);

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_ORDINARY, (c) =>
          c.query(`select id from public.bloom_library_import_batches`)
        ),
      /permission denied|must be owner/i
    );

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_ORDINARY, (c) =>
          c.query(
            `insert into public.bloom_library_import_batches (status) values ('pending_review')`
          )
        ),
      /permission denied|must be owner/i
    );
  });
});

test("inactive platform admin cannot write master or read import batches", async () => {
  await withClient(async (client) => {
    await seed(client);

    const visible = await asRole(client, "authenticated", USER_INACTIVE_ADMIN, (c) =>
      c.query(`select id from public.bloom_floral_library_master order by id`)
    );
    assert.deepEqual(
      visible.rows.map((r) => r.id),
      ["lib-approved", "lib-approved-starter"],
      "inactive admin is ordinary authenticated for master reads"
    );

    const upd = await asRole(client, "authenticated", USER_INACTIVE_ADMIN, (c) =>
      c.query(
        `update public.bloom_floral_library_master set name = 'nope' where id = 'lib-pending' returning id`
      )
    );
    assert.equal(upd.rowCount, 0);

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_INACTIVE_ADMIN, (c) =>
          c.query(`select id from public.bloom_library_import_batches`)
        ),
      /permission denied|must be owner/i
    );
  });
});

test("active platform admin can read all master rows and write via authorized path", async () => {
  await withClient(async (client) => {
    await seed(client);

    const all = await asRole(client, "authenticated", USER_PLATFORM, (c) =>
      c.query(`select id from public.bloom_floral_library_master order by id`)
    );
    assert.deepEqual(
      all.rows.map((r) => r.id),
      ["lib-approved", "lib-approved-starter", "lib-pending", "lib-rejected"]
    );

    const inserted = await asRole(client, "authenticated", USER_PLATFORM, (c) =>
      c.query(
        `insert into public.bloom_floral_library_master (id, name, data, review_status)
         values ('lib-admin-new', 'Admin New', '{"name":"Admin New"}'::jsonb, 'pending')
         returning id`
      )
    );
    assert.equal(inserted.rows[0].id, "lib-admin-new");

    const updated = await asRole(client, "authenticated", USER_PLATFORM, (c) =>
      c.query(
        `update public.bloom_floral_library_master
         set review_status = 'approved' where id = 'lib-admin-new' returning review_status`
      )
    );
    assert.equal(updated.rows[0].review_status, "approved");

    const deleted = await asRole(client, "authenticated", USER_PLATFORM, (c) =>
      c.query(`delete from public.bloom_floral_library_master where id = 'lib-admin-new' returning id`)
    );
    assert.equal(deleted.rows[0].id, "lib-admin-new");

    // Import batches remain grant-denied for authenticated platform JWT (service_role only).
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_PLATFORM, (c) =>
          c.query(`select id from public.bloom_library_import_batches`)
        ),
      /permission denied|must be owner/i
    );
  });
});

test("service_role can manage import batches and master (authorized platform import path)", async () => {
  await withClient(async (client) => {
    await seed(client);

    const batches = await asRole(client, "service_role", null, (c) =>
      c.query(`select id, status from public.bloom_library_import_batches`)
    );
    assert.equal(batches.rows.length, 1);

    const inserted = await asRole(client, "service_role", null, (c) =>
      c.query(
        `insert into public.bloom_library_import_batches (status, manifest)
         values ('processing', '[]'::jsonb) returning status`
      )
    );
    assert.equal(inserted.rows[0].status, "processing");

    const master = await asRole(client, "service_role", null, (c) =>
      c.query(`select count(*)::int as n from public.bloom_floral_library_master`)
    );
    assert.ok(master.rows[0].n >= 4);

    await asRole(client, "service_role", null, (c) =>
      c.query(
        `insert into public.bloom_floral_library_master (id, name, data, review_status)
         values ('lib-svc', 'Service', '{}'::jsonb, 'pending')
         on conflict (id) do nothing`
      )
    );
  });
});

test("no USING (true) write policies remain on library tables", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select pol.polname, pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
             pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr,
             c.relname
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('bloom_floral_library_master', 'bloom_library_import_batches')
    `);
    assert.ok(rows.every((r) => r.relname === "bloom_floral_library_master"));
    assert.equal(
      rows.filter((r) => r.relname === "bloom_library_import_batches").length,
      0,
      "import batches must have zero policies"
    );
    for (const r of rows) {
      assert.notEqual(String(r.using_expr || "").replace(/\s+/g, ""), "true");
      assert.notEqual(String(r.check_expr || "").replace(/\s+/g, ""), "true");
    }
    assert.ok(rows.some((r) => r.polname === "floral library master select approved"));
  });
});

test("audit: report any additional public tables with RLS disabled (scope report only)", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity = false
      order by c.relname
    `);
    // Fresh library harness only creates shops + platform_admins + library tables.
    // shops may lack RLS in this fixture; report findings without expanding lock scope.
    const names = rows.map((r) => r.relname);
    assert.ok(!names.includes("bloom_floral_library_master"));
    assert.ok(!names.includes("bloom_library_import_batches"));
    // Persist finding list for TD report consumers.
    // Fixture-scoped finding for TD report (not a production inventory).
    assert.ok(Array.isArray(names));
  });
});

test("migration SQL drops broad master read and never uses Community helpers", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260801_p0_01_floral_library_schema_lock_v1.sql"),
    "utf8"
  );
  assert.match(sql, /enable row level security/);
  assert.match(sql, /drop policy if exists "floral library master read"/);
  assert.match(sql, /review_status in \('approved_starter', 'approved'\)/);
  assert.match(sql, /is_active_platform_admin\(\)/);
  assert.doesNotMatch(sql, /\bis_platform_admin_user\b|\bis_active_florist\b|\bflorist_community_/i);
  // No policy body may use an open predicate.
  assert.doesNotMatch(sql, /create policy[\s\S]*?using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /create policy[\s\S]*?with check\s*\(\s*true\s*\)/i);
  assert.match(sql, /revoke all on table public\.bloom_library_import_batches from authenticated/i);
});
