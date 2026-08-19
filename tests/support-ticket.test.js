import test from "node:test";
import assert from "node:assert/strict";

import { handleSupportTicket } from "../netlify/functions/support-ticket.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

const USER = { id: "user_1", email: "florist@example.test" };
const SHOP_ID = "shop_1";

function postEvent(body) {
  return { httpMethod: "POST", headers: {}, body: JSON.stringify(body) };
}

function deps({ responses = [] } = {}) {
  const client = createFakeSupabaseClient(responses);
  return {
    currentUser: async () => ({ client, user: USER, shopId: SHOP_ID }),
    admin: () => client,
    _client: client
  };
}

test("support ticket create: rejects an empty report before touching the database", async () => {
  const d = deps();
  const response = await handleSupportTicket(postEvent({ action: "create", body: "" }), d);
  assert.equal(response.statusCode, 400);
  assert.equal(d._client.calls.length, 0);
});

test("support ticket create: files a real bug_report ticket scoped to the reporting shop and user", async () => {
  const d = deps({
    responses: [{ data: { id: "ticket_1", status: "open", created_at: "2026-08-17T00:00:00.000Z" }, error: null }]
  });
  const response = await handleSupportTicket(
    postEvent({ action: "create", subject: "Delete button", body: "The delete button on Orders doesn't remove the order." }),
    d
  );
  assert.equal(response.statusCode, 201);
  const bodyOut = JSON.parse(response.body);
  assert.equal(bodyOut.item.id, "ticket_1");
  assert.match(bodyOut.message, /Bud sent that in/);

  const insertCall = d._client.calls.find((c) => c.table === "platform_support_items" && c.payload);
  assert.ok(insertCall, "expected an insert into platform_support_items");
  assert.equal(insertCall.payload.item_type, "bug_report");
  assert.equal(insertCall.payload.status, "open");
  assert.equal(insertCall.payload.shop_id, SHOP_ID);
  assert.equal(insertCall.payload.user_id, USER.id);
  assert.match(insertCall.payload.notes[0].text, /Bud/);
});

test("support ticket create: a missing subject falls back to the body text, not a blank subject", async () => {
  const d = deps({ responses: [{ data: { id: "ticket_2", status: "open", created_at: "now" }, error: null }] });
  await handleSupportTicket(postEvent({ action: "create", body: "Checkout is stuck on the loading spinner." }), d);
  const insertCall = d._client.calls.find((c) => c.table === "platform_support_items" && c.payload);
  assert.equal(insertCall.payload.subject, "Checkout is stuck on the loading spinner.");
});

test("support ticket list: only returns tickets for the requesting shop and user", async () => {
  const d = deps({ responses: [{ data: [{ id: "ticket_1", subject: "x", status: "open" }], error: null }] });
  const response = await handleSupportTicket(postEvent({ action: "list" }), d);
  assert.equal(response.statusCode, 200);
  const bodyOut = JSON.parse(response.body);
  assert.equal(bodyOut.items.length, 1);

  const listCall = d._client.calls.find((c) => c.table === "platform_support_items" && !c.payload);
  const eqOps = listCall.ops.filter(([name]) => name === "eq");
  assert.deepEqual(
    eqOps.map((op) => op[1]),
    [["shop_id", SHOP_ID], ["user_id", USER.id]]
  );
});

test("support ticket: an unknown action is rejected with 400", async () => {
  const d = deps();
  const response = await handleSupportTicket(postEvent({ action: "delete_everything" }), d);
  assert.equal(response.statusCode, 400);
});
