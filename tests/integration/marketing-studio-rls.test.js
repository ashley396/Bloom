/**
 * Batch 6 ("Preview path + CI + provider cleanup + live-readiness"), Part
 * I — Marketing Studio least-privilege RLS (PostgreSQL), real disposable
 * database, real production migration files applied verbatim.
 *
 * Setup:
 *   node scripts/apply-marketing-rls-local.mjs
 *   npm run test:marketing-rls
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { spawnSync } from "node:child_process";
import path from "node:path";

const DATABASE_URL =
  process.env.MARKETING_TEST_DATABASE_URL ||
  process.env.COMMUNITY_TEST_DATABASE_URL ||
  "postgres://florisyn_test:florisyn_test@127.0.0.1:5432/florisyn_community_test";

const SHOP_A = "aaaaaaaa-0000-0000-0000-000000000001";
const SHOP_B = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_A = "aaaaaaaa-0000-0000-0000-0000000000a1";
const USER_B = "bbbbbbbb-0000-0000-0000-0000000000b1";

function applyMigrations() {
  const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/apply-marketing-rls-local.mjs")], {
    env: { ...process.env, MARKETING_TEST_DATABASE_URL: DATABASE_URL },
    encoding: "utf8"
  });
  if (r.status !== 0) {
    throw new Error(`Marketing RLS migration apply failed:\n${r.stdout}\n${r.stderr}`);
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
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId || ""]);
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
  await client.query(`delete from public.marketing_generation_usage`);
  await client.query(`delete from public.marketing_platform_variants`);
  await client.query(`delete from public.marketing_content_items`);
  await client.query(`delete from public.ai_generated_assets`);
  await client.query(`delete from public.shop_members`);
  await client.query(`delete from public.shops`);
  await client.query(`delete from auth.users`);

  await client.query(`insert into auth.users (id, email) values ($1, 'a@test.local'), ($2, 'b@test.local')`, [USER_A, USER_B]);
  await client.query(`insert into public.shops (id, name) values ($1, 'Shop A'), ($2, 'Shop B')`, [SHOP_A, SHOP_B]);
  await client.query(
    `insert into public.shop_members (shop_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($3, $4, 'owner', 'active')`,
    [SHOP_A, USER_A, SHOP_B, USER_B]
  );

  const itemA = await client.query(
    `insert into public.marketing_content_items (shop_id, content_type, title, status) values ($1, 'text_post', 'Shop A post', 'draft') returning id`,
    [SHOP_A]
  );
  const itemB = await client.query(
    `insert into public.marketing_content_items (shop_id, content_type, title, status) values ($1, 'text_post', 'Shop B post', 'draft') returning id`,
    [SHOP_B]
  );
  const assetA = await client.query(
    `insert into public.ai_generated_assets (shop_id, model, asset_type, content) values ($1, 'test-model', 'social_post', '{"body":"shop A content"}'::jsonb) returning id`,
    [SHOP_A]
  );
  const assetB = await client.query(
    `insert into public.ai_generated_assets (shop_id, model, asset_type, content) values ($1, 'test-model', 'social_post', '{"body":"shop B content"}'::jsonb) returning id`,
    [SHOP_B]
  );
  await client.query(
    `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, asset_id, caption) values ($1, $2, 'facebook', $3, 'Shop A caption')`,
    [SHOP_A, itemA.rows[0].id, assetA.rows[0].id]
  );
  await client.query(
    `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, asset_id, caption) values ($1, $2, 'facebook', $3, 'Shop B caption')`,
    [SHOP_B, itemB.rows[0].id, assetB.rows[0].id]
  );
  await client.query(
    `insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units, model, operation)
     values ($1, $2, 'cloudflare', 'copy', 'request', 1, 'test-model', 'text_generation')`,
    [SHOP_A, itemA.rows[0].id]
  );
  await client.query(
    `insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units, model, operation)
     values ($1, $2, 'cloudflare', 'copy', 'request', 1, 'test-model', 'text_generation')`,
    [SHOP_B, itemB.rows[0].id]
  );

  return { itemA: itemA.rows[0].id, itemB: itemB.rows[0].id, assetA: assetA.rows[0].id, assetB: assetB.rows[0].id };
}

test("Marketing RLS: migration applies cleanly on a fresh disposable database (real production migration files, verbatim)", () => {
  const out = applyMigrations();
  assert.match(out, /Marketing Studio RLS schema applied successfully/);
});

// Part R: the Batch 2 usage-ledger migration is included and applies cleanly.
test("Marketing RLS: Batch 2's usage-ledger extension migration applied cleanly — new columns present", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'marketing_generation_usage'
        and column_name in ('model', 'operation', 'trace_id', 'operation_id', 'attempt_index', 'provider_request_id', 'cost_source')
    `);
    const cols = rows.map((r) => r.column_name).sort();
    assert.deepEqual(cols, ["attempt_index", "cost_source", "model", "operation", "operation_id", "provider_request_id", "trace_id"]);
  });
});

test("Marketing RLS: RLS is enabled on every scoped Marketing table", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('marketing_content_items', 'marketing_platform_variants', 'ai_generated_assets', 'marketing_generation_usage')
      order by c.relname
    `);
    assert.equal(rows.length, 4);
    for (const r of rows) assert.equal(r.relrowsecurity, true, `${r.relname} RLS`);
  });
});

// Part P #17: Shop A cannot read Shop B Marketing content.
test("Marketing RLS: Shop A cannot read Shop B's content items — each shop sees only its own", async () => {
  await withClient(async (client) => {
    await seed(client);
    const asA = await asRole(client, "authenticated", USER_A, (c) => c.query(`select shop_id, title from public.marketing_content_items order by title`));
    assert.equal(asA.rows.length, 1);
    assert.equal(asA.rows[0].shop_id, SHOP_A);
    const asB = await asRole(client, "authenticated", USER_B, (c) => c.query(`select shop_id, title from public.marketing_content_items order by title`));
    assert.equal(asB.rows.length, 1);
    assert.equal(asB.rows[0].shop_id, SHOP_B);
  });
});

// Part P #18: Shop A cannot read Shop B assets.
test("Marketing RLS: Shop A cannot read Shop B's generated assets", async () => {
  await withClient(async (client) => {
    await seed(client);
    const asA = await asRole(client, "authenticated", USER_A, (c) => c.query(`select shop_id, content from public.ai_generated_assets`));
    assert.equal(asA.rows.length, 1);
    assert.equal(asA.rows[0].content.body, "shop A content");
  });
});

// Part P #19: Shop A cannot read Shop B usage rows.
test("Marketing RLS: Shop A cannot read Shop B's usage-ledger rows", async () => {
  await withClient(async (client) => {
    await seed(client);
    const asA = await asRole(client, "authenticated", USER_A, (c) => c.query(`select shop_id from public.marketing_generation_usage`));
    assert.equal(asA.rows.length, 1);
    assert.equal(asA.rows[0].shop_id, SHOP_A);
  });
});

test("Marketing RLS: Shop A cannot read Shop B's platform variants", async () => {
  await withClient(async (client) => {
    await seed(client);
    const asA = await asRole(client, "authenticated", USER_A, (c) => c.query(`select shop_id, caption from public.marketing_platform_variants`));
    assert.equal(asA.rows.length, 1);
    assert.equal(asA.rows[0].caption, "Shop A caption");
  });
});

// Part P #20: Shop A cannot mutate Shop B Marketing rows.
test("Marketing RLS: Shop A cannot update or delete Shop B's content item — RLS blocks the mutation, not just the read", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    // An UPDATE/DELETE whose WHERE clause happens to name a row RLS
    // hides simply matches zero rows — never an error, but never a
    // mutation either. Assert the real row count affected is 0 and the
    // target row is provably untouched afterward.
    const upd = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`update public.marketing_content_items set title = 'hacked' where id = $1`, [ids.itemB])
    );
    assert.equal(upd.rowCount, 0, "Shop A must affect zero rows when targeting Shop B's content item");
    const del = await asRole(client, "authenticated", USER_A, (c) => c.query(`delete from public.marketing_content_items where id = $1`, [ids.itemB]));
    assert.equal(del.rowCount, 0, "Shop A must affect zero rows deleting Shop B's content item");
    const stillThere = await withClientNoRole(client, ids.itemB);
    assert.equal(stillThere.title, "Shop B post", "Shop B's row must be completely untouched");
  });

  async function withClientNoRole(client, id) {
    await client.query("begin");
    await client.query("reset role");
    const r = await client.query(`select title from public.marketing_content_items where id = $1`, [id]);
    await client.query("commit");
    return r.rows[0];
  }
});

test("Marketing RLS: Shop A cannot insert a row directly claiming Shop B's shop_id", async () => {
  await withClient(async (client) => {
    await seed(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(`insert into public.marketing_content_items (shop_id, content_type, title, status) values ($1, 'text_post', 'forged', 'draft')`, [SHOP_B])
        ),
      /new row violates row-level security|permission denied/i
    );
  });
});

// anon: no access at all.
test("Marketing RLS: anon has no access to any scoped Marketing table", async () => {
  await withClient(async (client) => {
    await seed(client);
    for (const table of ["marketing_content_items", "marketing_platform_variants", "ai_generated_assets", "marketing_generation_usage"]) {
      await assert.rejects(() => asRole(client, "anon", null, (c) => c.query(`select 1 from public.${table} limit 1`)), /permission denied/i, table);
    }
  });
});

// Part P #21: service_role remains explicitly shop-scoped in real handler
// logic — proven here at the DB layer as "service_role CAN read
// cross-shop" (bypassrls, as production intends — every real handler in
// marketing-studio.js adds its own explicit .eq("shop_id", shopId)
// filter; RLS is not what scopes a service-role call, the handler code
// is), so a handler bug that forgets the filter is a real, hand-reviewed
// application-layer risk, not one RLS silently covers.
test("Marketing RLS: service_role can read across shops (bypassrls) — explicit shop_id filtering in handler code is what scopes it, not RLS", async () => {
  await withClient(async (client) => {
    await seed(client);
    const all = await asRole(client, "service_role", null, (c) => c.query(`select shop_id from public.marketing_content_items order by shop_id`));
    assert.equal(all.rows.length, 2, "service_role genuinely sees both shops — confirms RLS is not what protects a service-role query without its own explicit filter");
    const filtered = await asRole(client, "service_role", null, (c) => c.query(`select shop_id from public.marketing_content_items where shop_id = $1`, [SHOP_A]));
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.rows[0].shop_id, SHOP_A);
  });
});

// Part I's own explicit question: "verify content/variant relationships
// cannot cross shops where current schema enforces it." Investigated for
// real rather than assumed — see the completion report for what this
// found.
test("Marketing RLS (INVESTIGATION): a shop member cannot forge a variant's own shop_id to point at another shop's content item — RLS still requires is_shop_member on the variant's OWN shop_id", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    // Shop A tries to insert a variant row claiming SHOP_B as its own
    // shop_id (regardless of which content_item_id it names) — RLS's
    // with-check on the variant's own shop_id must still refuse this,
    // exactly like the direct-insert probe above.
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(`insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'facebook', 'forged') `, [SHOP_B, ids.itemB])
        ),
      /new row violates row-level security|permission denied/i
    );
  });
});

// Part I's literal wording, the subtler half: not "forge your own shop_id"
// (already proven blocked above), but "verify content/variant
// relationships cannot cross shops" — can Shop A insert a variant with
// its OWN, legitimate shop_id (passes is_shop_member trivially) while
// naming a content_item_id that actually belongs to Shop B's content
// item? The real migration's own policy
// (20260823000000_marketing_studio_foundation_v1.sql) is:
//   using ((select public.is_shop_member(shop_id)))
//   with check ((select public.is_shop_member(shop_id)))
// — it validates only the variant's own shop_id column. Nothing in the
// schema or RLS policy cross-checks that content_item_id's own shop_id
// matches. The FK on content_item_id only proves the row exists
// somewhere, not that it belongs to the same shop. This test proves,
// empirically, whether that gap is real.
test("Marketing RLS (INVESTIGATION): a shop member CAN currently insert a variant with their own legitimate shop_id but a content_item_id belonging to another shop's content item — current schema does not cross-check this relationship", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    // Shop A, its own real shop_id (SHOP_A, passes is_shop_member), but
    // content_item_id = Shop B's real content item id.
    const result = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(
        `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'instagram', 'cross-shop link') returning id`,
        [SHOP_A, ids.itemB]
      )
    );
    // If this assertion fails (the insert is rejected), the schema
    // already enforces this and there is nothing to report. As of this
    // migration chain, the insert SUCCEEDS — documenting a real,
    // unenforced cross-shop linkage: a Shop-A-owned variant row can
    // reference a Shop-B-owned content item. Per Part I / Part R: this
    // is reported, not silently fixed with a new migration.
    assert.equal(result.rows.length, 1, "the insert must be observed to genuinely succeed or fail — not assumed");
    await client.query(`delete from public.marketing_platform_variants where id = $1`, [result.rows[0].id]);
  });
});
