/**
 * P0-01 R1 — Floral Library least-privilege RLS (PostgreSQL).
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
const USER_SUPER = "66666666-6666-6666-6666-666666666666";
const USER_INACTIVE_SUPER = "77777777-7777-7777-7777-777777777777";
const USER_SUPPORT = "88888888-8888-8888-8888-888888888888";
const USER_DESIGNER = "99999999-9999-9999-9999-999999999999";
const USER_BILLING = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const APPROVED_IDS = ["lib-approved", "lib-approved-starter"];
const ALL_MASTER_IDS = ["lib-approved", "lib-approved-starter", "lib-pending", "lib-rejected"];

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
  const users = [
    USER_ORDINARY,
    USER_SUPER,
    USER_INACTIVE_SUPER,
    USER_SUPPORT,
    USER_DESIGNER,
    USER_BILLING,
  ];
  for (const id of users) {
    await client.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
      id,
      `${id}@test.local`,
    ]);
  }

  await client.query(`delete from public.platform_admins`);
  const admins = [
    [USER_SUPER, "super_admin", true],
    [USER_INACTIVE_SUPER, "super_admin", false],
    [USER_SUPPORT, "support", true],
    [USER_DESIGNER, "designer", true],
    [USER_BILLING, "billing", true],
  ];
  for (const [userId, role, active] of admins) {
    await client.query(
      `insert into public.platform_admins (user_id, role, display_name, active)
       values ($1, $2, $3, $4)`,
      [userId, role, role, active]
    );
  }

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

async function masterIdsFor(client, userId) {
  const r = await asRole(client, "authenticated", userId, (c) =>
    c.query(`select id from public.bloom_floral_library_master order by id`)
  );
  return r.rows.map((row) => row.id);
}

async function assertApprovedOnlyNoWrites(client, userId, label) {
  assert.deepEqual(await masterIdsFor(client, userId), APPROVED_IDS, `${label}: approved master only`);

  await assert.rejects(
    () =>
      asRole(client, "authenticated", userId, (c) =>
        c.query(
          `insert into public.bloom_floral_library_master (id, name, data, review_status)
           values ('lib-hack-${userId.slice(0, 8)}', 'Hack', '{}'::jsonb, 'approved_starter')`
        )
      ),
    /permission denied/i,
    `${label}: insert denied`
  );

  await assert.rejects(
    () =>
      asRole(client, "authenticated", userId, (c) =>
        c.query(
          `update public.bloom_floral_library_master
           set name = 'owned' where id = 'lib-approved-starter' returning id`
        )
      ),
    /permission denied/i,
    `${label}: update denied`
  );

  await assert.rejects(
    () =>
      asRole(client, "authenticated", userId, (c) =>
        c.query(`delete from public.bloom_floral_library_master where id = 'lib-approved' returning id`)
      ),
    /permission denied/i,
    `${label}: delete denied`
  );
}

test("P0-01 R1 migration applies cleanly on a fresh database", () => {
  const out = applyMigrations("reset");
  assert.match(out, /Floral library P0-01 migrations applied successfully/);
  assert.match(out, /20260801_p0_01_floral_library_schema_lock_v1\.sql/);
});

test("P0-01 R1 migration is idempotent (lock-again) and retires obsolete helper", async () => {
  const out = applyMigrations("lock-again");
  assert.match(out, /re-applied successfully/);
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_active_platform_admin'
    `);
    assert.equal(rows.length, 0, "obsolete is_active_platform_admin must not remain callable");
  });
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
    for (const r of rows) assert.equal(r.relrowsecurity, true, `${r.relname} RLS`);
  });
});

test("production-parity platform_admins role constraint rejects unsupported roles", async () => {
  await withClient(async (client) => {
    await seed(client);
    const { rows } = await client.query(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.platform_admins'::regclass
        and contype = 'c'
    `);
    const def = rows.map((r) => r.def).join(" ");
    assert.match(def, /super_admin/);
    assert.match(def, /support/);
    assert.match(def, /designer/);
    assert.match(def, /billing/);
    assert.doesNotMatch(def, /content_admin/);

    await client.query(
      `insert into auth.users (id, email) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bad-role@test.local')
       on conflict do nothing`
    );
    await assert.rejects(
      () =>
        client.query(
          `insert into public.platform_admins (user_id, role, active)
           values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'content_admin', true)`
        ),
      /check|violates/i
    );
  });
});

test("anon: no master/import access", async () => {
  await withClient(async (client) => {
    await seed(client);
    await assert.rejects(
      () => asRole(client, "anon", null, (c) => c.query(`select id from public.bloom_floral_library_master`)),
      /permission denied/i
    );
    await assert.rejects(
      () => asRole(client, "anon", null, (c) => c.query(`select id from public.bloom_library_import_batches`)),
      /permission denied/i
    );
  });
});

test("ordinary authenticated: approved master only; no writes", async () => {
  await withClient(async (client) => {
    await seed(client);
    await assertApprovedOnlyNoWrites(client, USER_ORDINARY, "ordinary");
  });
});

test("inactive super_admin: approved master only; no writes", async () => {
  await withClient(async (client) => {
    await seed(client);
    await assertApprovedOnlyNoWrites(client, USER_INACTIVE_SUPER, "inactive super_admin");
  });
});

test("active support: approved master only; no writes", async () => {
  await withClient(async (client) => {
    await seed(client);
    await assertApprovedOnlyNoWrites(client, USER_SUPPORT, "support");
  });
});

test("active designer: approved master only; no writes", async () => {
  await withClient(async (client) => {
    await seed(client);
    await assertApprovedOnlyNoWrites(client, USER_DESIGNER, "designer");
  });
});

test("active billing: approved master only; no writes", async () => {
  await withClient(async (client) => {
    await seed(client);
    await assertApprovedOnlyNoWrites(client, USER_BILLING, "billing");
  });
});

test("active super_admin: all master rows readable; direct JWT writes denied", async () => {
  await withClient(async (client) => {
    await seed(client);
    assert.deepEqual(await masterIdsFor(client, USER_SUPER), ALL_MASTER_IDS);

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_SUPER, (c) =>
          c.query(
            `insert into public.bloom_floral_library_master (id, name, data, review_status)
             values ('lib-super-write', 'Nope', '{}'::jsonb, 'pending')`
          )
        ),
      /permission denied/i,
      "super_admin JWT must not INSERT (SELECT grant only)"
    );
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_SUPER, (c) =>
          c.query(
            `update public.bloom_floral_library_master
             set name = 'x' where id = 'lib-pending'`
          )
        ),
      /permission denied/i
    );
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_SUPER, (c) =>
          c.query(`delete from public.bloom_floral_library_master where id = 'lib-pending'`)
        ),
      /permission denied/i
    );
  });
});

test("service_role: master and import CRUD works", async () => {
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

    await asRole(client, "service_role", null, (c) =>
      c.query(
        `insert into public.bloom_floral_library_master (id, name, data, review_status)
         values ('lib-svc', 'Service', '{}'::jsonb, 'pending')
         on conflict (id) do nothing`
      )
    );
    const upd = await asRole(client, "service_role", null, (c) =>
      c.query(
        `update public.bloom_floral_library_master
         set review_status = 'approved' where id = 'lib-svc' returning review_status`
      )
    );
    assert.equal(upd.rows[0].review_status, "approved");
    const del = await asRole(client, "service_role", null, (c) =>
      c.query(`delete from public.bloom_floral_library_master where id = 'lib-svc' returning id`)
    );
    assert.equal(del.rows[0].id, "lib-svc");
  });
});

test("ordinary/platform JWT cannot access import batches", async () => {
  await withClient(async (client) => {
    await seed(client);
    for (const uid of [USER_ORDINARY, USER_SUPER, USER_SUPPORT]) {
      await assert.rejects(
        () =>
          asRole(client, "authenticated", uid, (c) =>
            c.query(`select id from public.bloom_library_import_batches`)
          ),
        /permission denied/i
      );
    }
  });
});

test("function security: can_read_unapproved_floral_library_master catalogs and behavior", async () => {
  await withClient(async (client) => {
    await seed(client);

    const { rows } = await client.query(`
      select
        p.proname,
        p.prosecdef as security_definer,
        coalesce(p.proconfig, array[]::text[]) as proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'can_read_unapproved_floral_library_master'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].security_definer, true);
    assert.ok(
      rows[0].proconfig.some((c) => /^search_path=(?:''|\"\")$/.test(c) || c === "search_path="),
      `search_path must be empty, got ${JSON.stringify(rows[0].proconfig)}`
    );

    const { rows: grants } = await client.query(`
      select grantee, privilege_type
      from information_schema.routine_privileges
      where specific_schema = 'public'
        and routine_name = 'can_read_unapproved_floral_library_master'
        and privilege_type = 'EXECUTE'
      order by grantee
    `);
    const executeGrantees = grants.map((g) => g.grantee.toLowerCase());
    assert.ok(executeGrantees.includes("authenticated"));
    assert.ok(executeGrantees.includes("service_role"));
    assert.ok(!executeGrantees.includes("public"));
    assert.ok(!executeGrantees.includes("anon"));

    const src = await client.query(`
      select pg_get_functiondef(p.oid) as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'can_read_unapproved_floral_library_master'
    `);
    const def = src.rows[0].def;
    assert.match(def, /public\.platform_admins/);
    assert.match(def, /auth\.uid\(\)/);
    assert.match(def, /lower\(pa\.role\) = 'super_admin'/);
    assert.doesNotMatch(def, /user_metadata|raw_user_meta_data/i);

    const nullUid = await asRole(client, "authenticated", null, (c) =>
      c.query(`select public.can_read_unapproved_floral_library_master() as ok`)
    );
    assert.equal(nullUid.rows[0].ok, false);

    const superOk = await asRole(client, "authenticated", USER_SUPER, (c) =>
      c.query(`select public.can_read_unapproved_floral_library_master() as ok`)
    );
    assert.equal(superOk.rows[0].ok, true);

    const supportOk = await asRole(client, "authenticated", USER_SUPPORT, (c) =>
      c.query(`select public.can_read_unapproved_floral_library_master() as ok`)
    );
    assert.equal(supportOk.rows[0].ok, false);
  });
});

test("no authenticated write policies; SELECT grant only on master", async () => {
  await withClient(async (client) => {
    const { rows: policies } = await client.query(`
      select pol.polname, pol.polcmd
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'bloom_floral_library_master'
    `);
    assert.equal(policies.length, 1);
    assert.equal(policies[0].polname, "floral library master select approved");
    assert.equal(policies[0].polcmd, "r"); // SELECT

    const { rows: batchPol } = await client.query(`
      select count(*)::int as n
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'bloom_library_import_batches'
    `);
    assert.equal(batchPol[0].n, 0);

    const { rows: grants } = await client.query(`
      select grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'bloom_floral_library_master'
      order by grantee, privilege_type
    `);
    const authPrivs = grants.filter((g) => g.grantee === "authenticated").map((g) => g.privilege_type);
    assert.deepEqual(authPrivs, ["SELECT"]);
    const svc = grants.filter((g) => g.grantee === "service_role").map((g) => g.privilege_type).sort();
    assert.deepEqual(svc, ["DELETE", "INSERT", "SELECT", "UPDATE"]);
    assert.ok(!grants.some((g) => g.grantee === "anon"));
  });
});

test("platformAdmin user-client cannot read platform_admins under production-parity grants (boundary finding)", async () => {
  await withClient(async (client) => {
    await seed(client);
    // Mirrors platformAdmin()'s user-JWT select against platform_admins.
    // Production-parity: no GRANT and no browser policy → permission denied (or empty under RLS).
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_SUPER, (c) =>
          c.query(`select user_id, role, active from public.platform_admins where user_id = $1`, [USER_SUPER])
        ),
      /permission denied/i,
      "P0 Admin Authorization Boundary: authenticated JWT cannot read platform_admins"
    );
  });
});

test("migration SQL uses capability helper; no Community helpers; no authenticated writes", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260801_p0_01_floral_library_schema_lock_v1.sql"),
    "utf8"
  );
  assert.match(sql, /drop function if exists public\.is_active_platform_admin/);
  assert.match(sql, /can_read_unapproved_floral_library_master/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /lower\(pa\.role\) = 'super_admin'/);
  assert.match(sql, /grant select on table public\.bloom_floral_library_master to authenticated/i);
  assert.doesNotMatch(
    sql,
    /grant select, insert, update, delete on table public\.bloom_floral_library_master to authenticated/i
  );
  assert.doesNotMatch(sql, /create policy "floral library master admin /);
  assert.doesNotMatch(sql, /\bis_platform_admin_user\b|\bis_active_florist\b|\bflorist_community_/i);
});

test("floral-library-admin endpoint is super_admin only", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/floral-library-admin.js"), "utf8");
  assert.match(src, /platformAdmin\(event,\s*\["super_admin"\]\)/);
  assert.doesNotMatch(src, /content_admin/);
});

test("schema audit truth: migrations vs legacy vs fixture (report-only assertions)", () => {
  const migRoot = path.join(process.cwd(), "supabase/migrations");
  const legacyRoot = path.join(process.cwd(), "supabase");
  const fixture = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/floral-library-rls-bootstrap.sql"), "utf8");

  assert.match(fixture, /check \(role in \('super_admin', 'support', 'designer', 'billing'\)\)/);
  assert.doesNotMatch(fixture, /content_admin/);

  const legacyAdmin = fs.readFileSync(path.join(legacyRoot, "migration_v20.5_admin_control_center.sql"), "utf8");
  assert.match(legacyAdmin, /check \(role in \('super_admin','support','designer','billing'\)\)/);

  // Staff A2 remains a separate paused track — do not apply/modify.
  const staffA2 = path.join(migRoot, "20260729_phase2a_a2_staff_time_entries_rls_v1.sql");
  assert.ok(fs.existsSync(staffA2), "Staff A2 migration file exists but is out of P0-01 scope");
  const staffSql = fs.readFileSync(staffA2, "utf8");
  assert.match(staffSql, /staff_time_entries/i);
});
