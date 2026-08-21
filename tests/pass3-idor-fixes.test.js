import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Florisyn completion pass #3 (security / shop isolation). Three real
 * cross-tenant write bugs found by a targeted IDOR sweep, each verified by
 * hand before fixing:
 *
 * 1. business-ecosystem.js "loyalty_earn": bloom_loyalty_accounts.customer_id
 *    is the table's real primary key (not a (shop_id, customer_id)
 *    composite). A caller could submit another shop's real customer_id;
 *    the ownership check only ever read with a shop_id filter (silently
 *    returning "no existing account" for a foreign id), and the upsert's
 *    onConflict target was that bare customer_id — hitting the foreign
 *    row's PK and attempting to reassign its shop_id to the caller's shop.
 * 2. business-ecosystem.js "po_transition": ownership was verified on the
 *    read before the update, but the update itself omitted the shop_id
 *    filter the rest of this file uses everywhere else — a single point
 *    of failure resting entirely on the preceding read rather than the
 *    write itself.
 * 3. lily-ai.js: a raw client-supplied conversation_id was trusted outright
 *    to append chat messages and bump updated_at on — no check it was
 *    actually this shop's own conversation.
 *
 * Full handler-level mocking isn't practical here (currentUser() isn't
 * injectable — same constraint noted for dashboard.js elsewhere in this
 * suite), so these are source-text guards confirming the real fix landed,
 * following the same convention as double-submit-guards.test.js.
 */

const root = process.cwd();
const businessEcosystem = fs.readFileSync(path.join(root, "netlify/functions/business-ecosystem.js"), "utf8");
const lilyAi = fs.readFileSync(path.join(root, "netlify/functions/lily-ai.js"), "utf8");

test("loyalty_earn verifies any existing account's shop_id before upserting on the bare customer_id PK", () => {
  const start = businessEcosystem.indexOf('if (action === "loyalty_earn")');
  assert.ok(start > -1, "could not find the loyalty_earn action");
  const end = businessEcosystem.indexOf('if (action === "loyalty_redeem")', start);
  const block = businessEcosystem.slice(start, end);
  assert.match(
    block,
    /owner\.data\.shop_id\s*!==\s*shopId/,
    "must reject when an existing loyalty account for this customer_id belongs to a different shop"
  );
  assert.match(block, /return json\(403/, "must actually block the cross-shop case, not just detect it");
});

test("po_transition's update is scoped by shop_id, not left resting solely on the preceding read", () => {
  const start = businessEcosystem.indexOf('if (action === "po_transition")');
  assert.ok(start > -1, "could not find the po_transition action");
  const end = businessEcosystem.indexOf("\n    }", start);
  const block = businessEcosystem.slice(start, end);
  const updateStart = block.indexOf(".update(");
  const updateBlock = block.slice(updateStart, block.indexOf(".select(", updateStart));
  assert.match(updateBlock, /\.eq\("shop_id",\s*shopId\)/, "the update statement itself must carry the shop_id filter");
});

test("lily-ai chat handler verifies a client-supplied conversation_id belongs to this shop before reusing it", () => {
  const start = lilyAi.indexOf("let conversationId = body.conversation_id || null;");
  assert.ok(start > -1, "could not find the conversationId assignment");
  const end = lilyAi.indexOf('const persona = body.persona', start);
  const block = lilyAi.slice(start, end);
  assert.match(block, /\.eq\("shop_id",\s*shopId\)/, "must verify the conversation's shop_id matches the caller's own shop");
  assert.match(block, /conversationId\s*=\s*null/, "must fall back to starting a new conversation rather than reuse an unowned id");
});

test("persistMessage's conversations touch is also scoped by shop_id as defense-in-depth", () => {
  const start = lilyAi.indexOf("async function persistMessage(");
  const end = lilyAi.indexOf("\n}", start);
  const block = lilyAi.slice(start, end);
  const updateStart = block.indexOf(".from(CONVERSATIONS).update(");
  assert.ok(updateStart > -1, "could not find the conversations update statement");
  const updateStatement = block.slice(updateStart, block.indexOf(";", updateStart));
  assert.match(updateStatement, /\.eq\("id",\s*conversationId\)/, "must still target the given conversation");
  assert.match(updateStatement, /\.eq\("shop_id",\s*shopId\)/, "the conversations UPDATE must also carry shop_id");
});
