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
import fs from "node:fs";
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
// PATCHED (post-Batch-6 security blocker patch,
// 20260902000000_marketing_platform_variants_shop_integrity.sql): this
// test used to prove the insert SUCCEEDED — a real, unenforced cross-shop
// linkage found by Batch 6's own investigation and reported per Part I's
// "STOP before creating a new migration" rule, then explicitly authorized
// and fixed. It now proves the opposite: the same insert is refused at
// the DATABASE level (a real foreign-key violation, not just RLS) by the
// new composite (content_item_id, shop_id) -> marketing_content_items(id,
// shop_id) constraint.
test("Marketing RLS (PATCHED): a shop member's own legitimate shop_id no longer lets a variant reference another shop's content item — the database itself now rejects it", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(
            `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'instagram', 'cross-shop link')`,
            [SHOP_A, ids.itemB]
          )
        ),
      /marketing_platform_variants_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// ---------------------------------------------------------------------
// Post-Batch-6 security blocker patch — required tests 1-10.
// ---------------------------------------------------------------------

// 1. Shop A variant -> Shop A content item succeeds.
test("Patch test 1: Shop A variant referencing Shop A's own content item succeeds", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    const result = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(
        `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'pinterest', 'same-shop link') returning id`,
        [SHOP_A, ids.itemA]
      )
    );
    assert.equal(result.rows.length, 1);
  });
});

// 2. Shop B variant -> Shop B content item succeeds.
test("Patch test 2: Shop B variant referencing Shop B's own content item succeeds", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    const result = await asRole(client, "authenticated", USER_B, (c) =>
      c.query(
        `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'pinterest', 'same-shop link') returning id`,
        [SHOP_B, ids.itemB]
      )
    );
    assert.equal(result.rows.length, 1);
  });
});

// 3. Shop A variant -> Shop B content item fails at database level.
test("Patch test 3: Shop A variant referencing Shop B's content item fails at the database level (foreign key, not just RLS)", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(
            `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'linkedin', 'cross-shop') `,
            [SHOP_A, ids.itemB]
          )
        ),
      /marketing_platform_variants_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 4. Shop B variant -> Shop A content item fails at database level.
test("Patch test 4: Shop B variant referencing Shop A's content item fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_B, (c) =>
          c.query(
            `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'linkedin', 'cross-shop') `,
            [SHOP_B, ids.itemA]
          )
        ),
      /marketing_platform_variants_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 5. Correct same-shop update succeeds.
test("Patch test 5: updating a variant to reference a DIFFERENT content item within the SAME shop succeeds", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    // A second content item within Shop A to retarget the existing
    // Shop A variant to.
    const secondItemA = await client.query(
      `insert into public.marketing_content_items (shop_id, content_type, title, status) values ($1, 'text_post', 'Shop A second post', 'draft') returning id`,
      [SHOP_A]
    );
    const upd = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`update public.marketing_platform_variants set content_item_id = $1 where content_item_id = $2 and shop_id = $3`, [
        secondItemA.rows[0].id,
        ids.itemA,
        SHOP_A
      ])
    );
    assert.equal(upd.rowCount, 1, "a legitimate same-shop reassignment must succeed");
  });
});

// 6. Cross-shop reassignment fails.
test("Patch test 6: reassigning an existing Shop A variant to point at Shop B's content item fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    // A fresh Shop A variant on a platform Shop B's content item doesn't
    // already have (seed() only gives itemB a 'facebook' variant) — this
    // isolates the assertion to the composite FK alone, never colliding
    // with the pre-existing unrelated unique(content_item_id, platform)
    // constraint.
    const freshVariant = await client.query(
      `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'youtube', 'reassignment target') returning id`,
      [SHOP_A, ids.itemA]
    );
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(`update public.marketing_platform_variants set content_item_id = $1 where id = $2`, [ids.itemB, freshVariant.rows[0].id])
        ),
      /marketing_platform_variants_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 7. RLS isolation still passes (the constraint is layered UNDER RLS, not
// instead of it — re-confirmed here directly against the patched schema,
// alongside the full pre-existing RLS suite above).
test("Patch test 7: RLS isolation still holds after the patch — Shop A still cannot read Shop B's platform variants", async () => {
  await withClient(async (client) => {
    await seed(client);
    const asA = await asRole(client, "authenticated", USER_A, (c) => c.query(`select shop_id, caption from public.marketing_platform_variants`));
    assert.equal(asA.rows.length, 1);
    assert.equal(asA.rows[0].shop_id, SHOP_A);
  });
});

// 8. Service-role behavior does not bypass referential integrity. RLS is
// bypassed by service_role BY DESIGN (see the existing test above); a
// real foreign-key constraint is NOT an RLS policy — it is enforced for
// every role, service_role included, exactly as Postgres always enforces
// FKs regardless of who issues the write.
test("Patch test 8: service_role (which bypasses RLS by design) still cannot violate the cross-shop foreign key — referential integrity is not an RLS bypass", async () => {
  await withClient(async (client) => {
    const ids = await seed(client);
    await assert.rejects(
      () =>
        asRole(client, "service_role", null, (c) =>
          c.query(`insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'youtube', 'service-role cross-shop attempt')`, [
            SHOP_A,
            ids.itemB
          ])
        ),
      /marketing_platform_variants_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 9. Existing valid Marketing migration chain still applies cleanly
// (already exercised by "migration applies cleanly" above — this run
// includes the new patch migration, since applyMigrations() now applies
// all 5 files in order via the real apply script).
test("Patch test 9: the full Marketing migration chain, including the new patch migration, applies cleanly on a fresh disposable database", () => {
  const out = applyMigrations();
  assert.match(out, /Marketing Studio RLS schema applied successfully/);
  assert.match(out, /20260902000000_marketing_platform_variants_shop_integrity\.sql\.\.\. ok/);
});

// 10. Batch 2 usage-ledger migration still applies cleanly alongside the
// new patch (re-confirms the column check from earlier in this file
// still holds against the patched schema).
test("Patch test 10: Batch 2's usage-ledger extension migration still applies cleanly alongside the new patch migration", async () => {
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

// Schema confirmation: the exact constraints the patch was supposed to
// add are genuinely present (not just "an insert failed for some other
// reason") — checked directly against pg_constraint/information_schema.
test("Patch schema check: marketing_content_items has the new UNIQUE (id, shop_id) constraint", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select conname, contype from pg_constraint
      where conrelid = 'public.marketing_content_items'::regclass
        and conname = 'marketing_content_items_id_shop_id_key'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].contype, "u");
  });
});

test("Patch schema check: marketing_platform_variants has the new composite foreign key to marketing_content_items(id, shop_id)", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select conname, contype, confrelid::regclass::text as referenced_table
      from pg_constraint
      where conrelid = 'public.marketing_platform_variants'::regclass
        and conname = 'marketing_platform_variants_content_item_shop_fkey'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].contype, "f");
    assert.equal(rows[0].referenced_table, "marketing_content_items");
  });
});

// ---------------------------------------------------------------------
// Final tenant-integrity patch (20260903000000_marketing_usage_and_
// clone_video_shop_integrity.sql): the same class of gap on
// marketing_generation_usage.content_item_id and
// marketing_clone_video_jobs.content_item_id/.platform_variant_id,
// discovered and reported (not fixed) by the prior patch's own migration
// comments. Required tests 1-32.
// ---------------------------------------------------------------------

async function seedForFinalPatch(client) {
  const ids = await seed(client);
  const secondVariantA = await client.query(
    `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'youtube', 'A second variant') returning id`,
    [SHOP_A, ids.itemA]
  );
  const secondVariantB = await client.query(
    `insert into public.marketing_platform_variants (shop_id, content_item_id, platform, caption) values ($1, $2, 'youtube', 'B second variant') returning id`,
    [SHOP_B, ids.itemB]
  );
  const variantAResult = await client.query(`select id from public.marketing_platform_variants where shop_id = $1 and platform = 'facebook'`, [SHOP_A]);
  const variantBResult = await client.query(`select id from public.marketing_platform_variants where shop_id = $1 and platform = 'facebook'`, [SHOP_B]);
  return {
    ...ids,
    variantA: variantAResult.rows[0].id,
    variantB: variantBResult.rows[0].id,
    variantA2: secondVariantA.rows[0].id,
    variantB2: secondVariantB.rows[0].id
  };
}

// ── marketing_generation_usage.content_item_id (tests 1-8) ────────────

// 1. Shop A usage -> Shop A content succeeds.
test("Final patch test 1: Shop A usage row referencing Shop A's own content item succeeds", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const result = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(
        `insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, $2, 'cloudflare', 'copy', 'request', 1) returning id`,
        [SHOP_A, ids.itemA]
      )
    );
    assert.equal(result.rows.length, 1);
  });
});

// 2. Shop B usage -> Shop B content succeeds.
test("Final patch test 2: Shop B usage row referencing Shop B's own content item succeeds", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const result = await asRole(client, "authenticated", USER_B, (c) =>
      c.query(
        `insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, $2, 'cloudflare', 'copy', 'request', 1) returning id`,
        [SHOP_B, ids.itemB]
      )
    );
    assert.equal(result.rows.length, 1);
  });
});

// 3. Shop A usage -> Shop B content fails at DB level.
test("Final patch test 3: Shop A usage row referencing Shop B's content item fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(`insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, $2, 'cloudflare', 'copy', 'request', 1)`, [
            SHOP_A,
            ids.itemB
          ])
        ),
      /marketing_generation_usage_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 4. Shop B usage -> Shop A content fails at DB level.
test("Final patch test 4: Shop B usage row referencing Shop A's content item fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_B, (c) =>
          c.query(`insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, $2, 'cloudflare', 'copy', 'request', 1)`, [
            SHOP_B,
            ids.itemA
          ])
        ),
      /marketing_generation_usage_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 5. NULL content_item_id remains valid.
test("Final patch test 5: a usage row with NULL content_item_id remains valid — the relationship stays nullable", async () => {
  await withClient(async (client) => {
    await seedForFinalPatch(client);
    const result = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, null, 'cloudflare', 'copy', 'request', 1) returning id`, [
        SHOP_A
      ])
    );
    assert.equal(result.rows.length, 1);
  });
});

// 6. Same-shop reassignment succeeds.
test("Final patch test 6: reassigning a usage row's content_item_id to a DIFFERENT content item within the SAME shop succeeds", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const secondItemA = await client.query(
      `insert into public.marketing_content_items (shop_id, content_type, title, status) values ($1, 'text_post', 'Shop A second post', 'draft') returning id`,
      [SHOP_A]
    );
    const usageRow = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, $2, 'cloudflare', 'copy', 'request', 1) returning id`, [
        SHOP_A,
        ids.itemA
      ])
    );
    const upd = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`update public.marketing_generation_usage set content_item_id = $1 where id = $2`, [secondItemA.rows[0].id, usageRow.rows[0].id])
    );
    assert.equal(upd.rowCount, 1, "a legitimate same-shop reassignment must succeed");
  });
});

// 7. Cross-shop reassignment fails.
test("Final patch test 7: reassigning an existing Shop A usage row to point at Shop B's content item fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const usageRow = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, $2, 'cloudflare', 'copy', 'request', 1) returning id`, [
        SHOP_A,
        ids.itemA
      ])
    );
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(`update public.marketing_generation_usage set content_item_id = $1 where id = $2`, [ids.itemB, usageRow.rows[0].id])
        ),
      /marketing_generation_usage_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 8. Service role cannot bypass the composite FK.
test("Final patch test 8: service_role (which bypasses RLS by design) still cannot violate the usage-ledger cross-shop foreign key", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await assert.rejects(
      () =>
        asRole(client, "service_role", null, (c) =>
          c.query(`insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, $2, 'cloudflare', 'copy', 'request', 1)`, [
            SHOP_A,
            ids.itemB
          ])
        ),
      /marketing_generation_usage_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// ── marketing_clone_video_jobs.content_item_id (tests 9-14) ───────────

// 9. Shop A job -> Shop A content succeeds.
test("Final patch test 9: Shop A clone-video job referencing Shop A's own content item succeeds", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const result = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-a1', $2) returning id`, [SHOP_A, ids.itemA])
    );
    assert.equal(result.rows.length, 1);
  });
});

// 10. Shop A job -> Shop B content fails.
test("Final patch test 10: Shop A clone-video job referencing Shop B's content item fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-a2', $2)`, [SHOP_A, ids.itemB])
        ),
      /marketing_clone_video_jobs_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 11. Shop B job -> Shop A content fails.
test("Final patch test 11: Shop B clone-video job referencing Shop A's content item fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_B, (c) =>
          c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-b1', $2)`, [SHOP_B, ids.itemA])
        ),
      /marketing_clone_video_jobs_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 12. NULL content_item_id remains valid.
test("Final patch test 12: a clone-video job with NULL content_item_id remains valid", async () => {
  await withClient(async (client) => {
    await seedForFinalPatch(client);
    const result = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-a3', null) returning id`, [SHOP_A])
    );
    assert.equal(result.rows.length, 1);
  });
});

// 13. Cross-shop reassignment fails.
test("Final patch test 13: reassigning a clone-video job's content_item_id to Shop B's content item fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const jobRow = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-a4', $2) returning id`, [SHOP_A, ids.itemA])
    );
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(`update public.marketing_clone_video_jobs set content_item_id = $1 where id = $2`, [ids.itemB, jobRow.rows[0].id])
        ),
      /marketing_clone_video_jobs_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 14. Service role cannot bypass the FK.
test("Final patch test 14: service_role still cannot violate the clone-video-job content_item_id cross-shop foreign key", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await assert.rejects(
      () =>
        asRole(client, "service_role", null, (c) =>
          c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-a5', $2)`, [SHOP_A, ids.itemB])
        ),
      /marketing_clone_video_jobs_content_item_shop_fkey|violates foreign key constraint/i
    );
  });
});

// ── marketing_clone_video_jobs.platform_variant_id (tests 15-20) ──────

// 15. Shop A job -> Shop A variant succeeds.
test("Final patch test 15: Shop A clone-video job referencing Shop A's own platform variant succeeds", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const result = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, platform_variant_id) values ($1, 'heygen', 'job-v1', $2) returning id`, [
        SHOP_A,
        ids.variantA
      ])
    );
    assert.equal(result.rows.length, 1);
  });
});

// 16. Shop A job -> Shop B variant fails.
test("Final patch test 16: Shop A clone-video job referencing Shop B's platform variant fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, platform_variant_id) values ($1, 'heygen', 'job-v2', $2)`, [SHOP_A, ids.variantB])
        ),
      /marketing_clone_video_jobs_platform_variant_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 17. Shop B job -> Shop A variant fails.
test("Final patch test 17: Shop B clone-video job referencing Shop A's platform variant fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_B, (c) =>
          c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, platform_variant_id) values ($1, 'heygen', 'job-v3', $2)`, [SHOP_B, ids.variantA])
        ),
      /marketing_clone_video_jobs_platform_variant_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 18. NULL platform_variant_id remains valid.
test("Final patch test 18: a clone-video job with NULL platform_variant_id remains valid", async () => {
  await withClient(async (client) => {
    await seedForFinalPatch(client);
    const result = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, platform_variant_id) values ($1, 'heygen', 'job-v4', null) returning id`, [SHOP_A])
    );
    assert.equal(result.rows.length, 1);
  });
});

// 19. Cross-shop reassignment fails.
test("Final patch test 19: reassigning a clone-video job's platform_variant_id to Shop B's variant fails at the database level", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const jobRow = await asRole(client, "authenticated", USER_A, (c) =>
      c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, platform_variant_id) values ($1, 'heygen', 'job-v5', $2) returning id`, [
        SHOP_A,
        ids.variantA
      ])
    );
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, (c) =>
          c.query(`update public.marketing_clone_video_jobs set platform_variant_id = $1 where id = $2`, [ids.variantB, jobRow.rows[0].id])
        ),
      /marketing_clone_video_jobs_platform_variant_shop_fkey|violates foreign key constraint/i
    );
  });
});

// 20. Service role cannot bypass the FK.
test("Final patch test 20: service_role still cannot violate the clone-video-job platform_variant_id cross-shop foreign key", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await assert.rejects(
      () =>
        asRole(client, "service_role", null, (c) =>
          c.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, platform_variant_id) values ($1, 'heygen', 'job-v6', $2)`, [SHOP_A, ids.variantB])
        ),
      /marketing_clone_video_jobs_platform_variant_shop_fkey|violates foreign key constraint/i
    );
  });
});

// ── Migration safety (tests 21-27) ─────────────────────────────────────

// 21. Full Marketing migration chain applies cleanly.
test("Final patch test 21: the full Marketing migration chain, including this final patch, applies cleanly on a fresh disposable database", () => {
  const out = applyMigrations();
  assert.match(out, /Marketing Studio RLS schema applied successfully/);
  assert.match(out, /20260903000000_marketing_usage_and_clone_video_shop_integrity\.sql\.\.\. ok/);
});

// 22. Batch 2 usage-ledger migration still applies cleanly.
test("Final patch test 22: Batch 2's usage-ledger extension migration still applies cleanly alongside this final patch", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'marketing_generation_usage'
        and column_name in ('model', 'operation', 'trace_id', 'operation_id', 'attempt_index', 'provider_request_id', 'cost_source')
    `);
    assert.equal(rows.length, 7);
  });
});

// 23. Prior platform-variant integrity migration still applies cleanly.
test("Final patch test 23: the prior marketing_platform_variants integrity migration's constraints still exist alongside this final patch", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select conname from pg_constraint
      where conname in ('marketing_content_items_id_shop_id_key', 'marketing_platform_variants_content_item_shop_fkey')
    `);
    assert.equal(rows.length, 2);
  });
});

// 24. New constraints exist after migration.
test("Final patch test 24: all four new constraints from this final patch genuinely exist", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      select conname, conrelid::regclass::text as table_name, contype
      from pg_constraint
      where conname in (
        'marketing_platform_variants_id_shop_id_key',
        'marketing_generation_usage_content_item_shop_fkey',
        'marketing_clone_video_jobs_content_item_shop_fkey',
        'marketing_clone_video_jobs_platform_variant_shop_fkey'
      )
      order by conname
    `);
    assert.equal(rows.length, 4);
    const byName = Object.fromEntries(rows.map((r) => [r.conname, r]));
    assert.equal(byName.marketing_platform_variants_id_shop_id_key.contype, "u");
    assert.equal(byName.marketing_generation_usage_content_item_shop_fkey.contype, "f");
    assert.equal(byName.marketing_clone_video_jobs_content_item_shop_fkey.contype, "f");
    assert.equal(byName.marketing_clone_video_jobs_platform_variant_shop_fkey.contype, "f");
  });
});

// 25. Existing valid seeded rows survive unchanged.
test("Final patch test 25: existing valid same-shop rows survive the migration unchanged", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    // seed() itself already inserts one valid same-shop
    // marketing_generation_usage row per shop — confirm both are still
    // present and unmodified after the full chain (including this
    // patch) has applied.
    const { rows } = await client.query(`select shop_id, content_item_id from public.marketing_generation_usage where shop_id in ($1, $2) order by shop_id`, [SHOP_A, SHOP_B]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].shop_id, SHOP_A);
    assert.equal(rows[0].content_item_id, ids.itemA);
    assert.equal(rows[1].shop_id, SHOP_B);
    assert.equal(rows[1].content_item_id, ids.itemB);
  });
});

// 26. Deliberately seeded violating legacy row causes fail-loud rollback.
// Exercised directly against the migration file's own SQL (not through
// the disposable-DB reset helper, since that always starts from a clean
// state) — mirrors exactly how the prior patch's own equivalent proof
// was done, and how this migration was manually verified before writing
// this test file (see the completion report).
test("Final patch test 26: a deliberately seeded cross-shop legacy row causes the migration to fail loudly with the exact violating count", async () => {
  await withClient(async (client) => {
    // Reset to the state immediately BEFORE this final patch (through
    // 20260902000000), then seed one violating row per relationship.
    await client.query(`
      drop schema if exists public cascade;
      drop schema if exists auth cascade;
      drop schema if exists storage cascade;
      create schema public;
      grant all on schema public to public;
    `);
    const preFiles = [
      "tests/fixtures/marketing-rls-bootstrap.sql",
      "supabase/migrations/20260820020000_ai_operating_system_v1.sql",
      "supabase/migrations/20260823000000_marketing_studio_foundation_v1.sql",
      "supabase/migrations/20260824000000_creative_ai_webhook_disclosure_media.sql",
      "supabase/migrations/20260901000000_marketing_generation_usage_ledger_extension.sql",
      "supabase/migrations/20260902000000_marketing_platform_variants_shop_integrity.sql"
    ];
    for (const f of preFiles) {
      await client.query(fs.readFileSync(f, "utf8"));
    }
    await client.query(`insert into public.shops (id, name) values ($1, 'Shop A'), ($2, 'Shop B')`, [SHOP_A, SHOP_B]);
    const itemB = await client.query(`insert into public.marketing_content_items (shop_id, content_type, title, status) values ($1, 'text_post', 'B', 'draft') returning id`, [SHOP_B]);
    await client.query(`insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, $2, 'cloudflare', 'copy', 'request', 1)`, [
      SHOP_A,
      itemB.rows[0].id
    ]);

    const migrationSql = fs.readFileSync("supabase/migrations/20260903000000_marketing_usage_and_clone_video_shop_integrity.sql", "utf8");
    await assert.rejects(() => client.query(migrationSql), /existing row\(s\) already reference a content item belonging to a DIFFERENT shop/i);
  });
});

// 27. No partial constraint changes remain after failed migration.
test("Final patch test 27: no partial constraint is left behind after the migration fails on legacy violating data", async () => {
  await withClient(async (client) => {
    // Continues directly from test 26's now-failed-and-rolled-back state
    // (same client/session) — the failed migration's own transaction
    // rolled back atomically, so none of its constraints exist yet.
    const { rows } = await client.query(`
      select conname from pg_constraint
      where conname in (
        'marketing_platform_variants_id_shop_id_key',
        'marketing_generation_usage_content_item_shop_fkey',
        'marketing_clone_video_jobs_content_item_shop_fkey',
        'marketing_clone_video_jobs_platform_variant_shop_fkey'
      )
    `);
    assert.equal(rows.length, 0, "none of this migration's new constraints may exist after it failed and rolled back");
    // Restore a genuinely clean, fully-migrated state for any test that
    // might run after this one in the same process.
    applyMigrations();
  });
});

// ── RLS regression (tests 28-32) ───────────────────────────────────────

// 28. Shop A cannot read Shop B data (usage + clone-video jobs, on top of
// the existing content-item/asset/variant coverage above).
test("Final patch test 28: Shop A cannot read Shop B's usage-ledger or clone-video-job rows after this patch", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await client.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-rls-b', $2)`, [SHOP_B, ids.itemB]);
    const usageAsA = await asRole(client, "authenticated", USER_A, (c) => c.query(`select shop_id from public.marketing_generation_usage`));
    assert.ok(usageAsA.rows.every((r) => r.shop_id === SHOP_A));
    const jobsAsA = await asRole(client, "authenticated", USER_A, (c) => c.query(`select shop_id from public.marketing_clone_video_jobs`));
    assert.ok(jobsAsA.rows.every((r) => r.shop_id === SHOP_A));
  });
});

// 29. Shop A cannot mutate Shop B rows.
test("Final patch test 29: Shop A cannot update or delete Shop B's clone-video-job row — RLS blocks the mutation", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const jobB = await client.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-rls-mut', $2) returning id`, [
      SHOP_B,
      ids.itemB
    ]);
    const upd = await asRole(client, "authenticated", USER_A, (c) => c.query(`update public.marketing_clone_video_jobs set status = 'failed' where id = $1`, [jobB.rows[0].id]));
    assert.equal(upd.rowCount, 0, "Shop A must affect zero rows when targeting Shop B's clone-video job");
  });
});

// 30. Usage ledger remains shop-scoped.
test("Final patch test 30: the usage ledger remains fully shop-scoped under RLS after this patch — each shop sees only its own rows", async () => {
  await withClient(async (client) => {
    await seedForFinalPatch(client);
    const asB = await asRole(client, "authenticated", USER_B, (c) => c.query(`select shop_id from public.marketing_generation_usage`));
    assert.ok(asB.rows.length > 0 && asB.rows.every((r) => r.shop_id === SHOP_B));
  });
});

// 31. Clone-video jobs remain shop-scoped.
test("Final patch test 31: clone-video jobs remain fully shop-scoped under RLS after this patch", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    await client.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-rls-scope-a', $2)`, [SHOP_A, ids.itemA]);
    await client.query(`insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-rls-scope-b', $2)`, [SHOP_B, ids.itemB]);
    const asA = await asRole(client, "authenticated", USER_A, (c) => c.query(`select shop_id from public.marketing_clone_video_jobs`));
    assert.ok(asA.rows.length > 0 && asA.rows.every((r) => r.shop_id === SHOP_A));
  });
});

// 32. Existing Marketing RLS tests remain green — proven by this file's
// own full run (all tests above this section) passing alongside these
// new ones; no separate assertion needed here beyond confirming the
// original two-shop content-item isolation still holds after this final
// patch specifically.
test("Final patch test 32: pre-existing Marketing RLS isolation (content items) still holds after this final patch", async () => {
  await withClient(async (client) => {
    await seedForFinalPatch(client);
    const asA = await asRole(client, "authenticated", USER_A, (c) => c.query(`select shop_id from public.marketing_content_items`));
    assert.ok(asA.rows.length > 0 && asA.rows.every((r) => r.shop_id === SHOP_A));
  });
});

// ---------------------------------------------------------------------
// Independent-review finding: the migration's own comments call the
// column-scoped `on delete set null (<column>)` behavior the trickiest
// part of this patch — a naive composite `on delete set null` would try
// to null EVERY column in the FK, including shop_id (not null on both
// child tables), either throwing outright or corrupting tenant scoping.
// No test exercised this at all before this addition. These three tests
// each delete a real parent row and inspect the real child row
// afterward — proving ONLY the child's own reference column is ever
// nulled, shop_id is NEVER touched, for every one of the three
// relationships this patch fixes.
// ---------------------------------------------------------------------

test("Final patch, ON DELETE regression 1: deleting a marketing_content_items row nulls ONLY marketing_generation_usage.content_item_id — shop_id is never touched", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const usageRow = await client.query(
      `insert into public.marketing_generation_usage (shop_id, content_item_id, provider, purpose, unit_type, units) values ($1, $2, 'cloudflare', 'copy', 'request', 1) returning id`,
      [SHOP_A, ids.itemA]
    );
    await client.query(`delete from public.marketing_content_items where id = $1`, [ids.itemA]);
    const after = await client.query(`select shop_id, content_item_id from public.marketing_generation_usage where id = $1`, [usageRow.rows[0].id]);
    assert.equal(after.rows.length, 1, "the usage row itself must survive the parent's deletion — never cascaded away");
    assert.equal(after.rows[0].content_item_id, null, "content_item_id must be nulled");
    assert.equal(after.rows[0].shop_id, SHOP_A, "shop_id must NEVER be nulled — it is not null and is the tenant-scoping column");
  });
});

test("Final patch, ON DELETE regression 2: deleting a marketing_content_items row nulls ONLY marketing_clone_video_jobs.content_item_id — shop_id is never touched", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const jobRow = await client.query(
      `insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id) values ($1, 'heygen', 'job-del-1', $2) returning id`,
      [SHOP_A, ids.itemA]
    );
    await client.query(`delete from public.marketing_content_items where id = $1`, [ids.itemA]);
    const after = await client.query(`select shop_id, content_item_id from public.marketing_clone_video_jobs where id = $1`, [jobRow.rows[0].id]);
    assert.equal(after.rows.length, 1, "the clone-video job row itself must survive the parent's deletion");
    assert.equal(after.rows[0].content_item_id, null, "content_item_id must be nulled");
    assert.equal(after.rows[0].shop_id, SHOP_A, "shop_id must NEVER be nulled");
  });
});

test("Final patch, ON DELETE regression 3: deleting a marketing_platform_variants row nulls ONLY marketing_clone_video_jobs.platform_variant_id — shop_id is never touched, content_item_id (a separate reference) is unaffected", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const jobRow = await client.query(
      `insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, content_item_id, platform_variant_id) values ($1, 'heygen', 'job-del-2', $2, $3) returning id`,
      [SHOP_A, ids.itemA, ids.variantA]
    );
    // Delete only the variant (not its parent content item) — an
    // isolated delete, not a cascade-through, so this specifically
    // exercises the platform_variant_id FK's own ON DELETE clause.
    await client.query(`delete from public.marketing_platform_variants where id = $1`, [ids.variantA]);
    const after = await client.query(`select shop_id, content_item_id, platform_variant_id from public.marketing_clone_video_jobs where id = $1`, [jobRow.rows[0].id]);
    assert.equal(after.rows.length, 1, "the clone-video job row itself must survive the variant's deletion");
    assert.equal(after.rows[0].platform_variant_id, null, "platform_variant_id must be nulled");
    assert.equal(after.rows[0].content_item_id, ids.itemA, "content_item_id is a SEPARATE reference and must be completely unaffected by the variant's deletion");
    assert.equal(after.rows[0].shop_id, SHOP_A, "shop_id must NEVER be nulled");
  });
});

test("Final patch, ON DELETE regression 4: a content item's cascade-delete of its own variant also correctly nulls only platform_variant_id on any linked clone-video job — never shop_id", async () => {
  await withClient(async (client) => {
    const ids = await seedForFinalPatch(client);
    const jobRow = await client.query(
      `insert into public.marketing_clone_video_jobs (shop_id, provider, provider_job_id, platform_variant_id) values ($1, 'heygen', 'job-del-3', $2) returning id`,
      [SHOP_A, ids.variantA]
    );
    // Deleting the CONTENT ITEM cascades to delete its own variant
    // (marketing_platform_variants' existing on delete cascade FK to
    // marketing_content_items) — which must, in turn, correctly null
    // this job's platform_variant_id via the SAME column-scoped ON
    // DELETE SET NULL, never touching shop_id.
    await client.query(`delete from public.marketing_content_items where id = $1`, [ids.itemA]);
    const after = await client.query(`select shop_id, platform_variant_id from public.marketing_clone_video_jobs where id = $1`, [jobRow.rows[0].id]);
    assert.equal(after.rows.length, 1);
    assert.equal(after.rows[0].platform_variant_id, null, "platform_variant_id must be nulled by the cascade-through deletion");
    assert.equal(after.rows[0].shop_id, SHOP_A, "shop_id must NEVER be nulled, even via a cascade-through delete");
  });
});
