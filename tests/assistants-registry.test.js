import test from "node:test";
import assert from "node:assert/strict";
import { ASSISTANTS, ASSISTANT_LIST, getAssistant, resolveAssistantNavigation } from "../lib/assistants/registry.js";

// lib/assistants/registry.js had zero test coverage despite being the one
// canonical source web, mobile, and the AI endpoints all read from for
// Lily/Rose/Daisy/Bud identity and navigation — a typo here silently
// breaks routing across every surface at once.

test("ASSISTANTS: all four personas are present with the expected AI endpoint wiring", () => {
  assert.equal(ASSISTANTS.lily.aiEndpoint, "lily-ai");
  assert.equal(ASSISTANTS.rose.aiEndpoint, "lily-ai");
  assert.equal(ASSISTANTS.bud.aiEndpoint, "lily-ai");
  assert.equal(ASSISTANTS.daisy.aiEndpoint, null, "Daisy is not an AI-chat persona");
});

test("ASSISTANT_LIST mirrors ASSISTANTS in a fixed, stable order", () => {
  assert.equal(ASSISTANT_LIST.length, 4);
  assert.deepEqual(ASSISTANT_LIST.map((a) => a.id), ["lily", "rose", "daisy", "bud"]);
});

test("the registry is frozen — accidental mutation at runtime is a no-op, not silent corruption", () => {
  assert.throws(() => {
    "use strict";
    ASSISTANTS.lily.name = "Not Lily";
  }, TypeError);
});

test("getAssistant: resolves by id case-insensitively", () => {
  assert.equal(getAssistant("lily"), ASSISTANTS.lily);
  assert.equal(getAssistant("ROSE"), ASSISTANTS.rose);
  assert.equal(getAssistant("Bud"), ASSISTANTS.bud);
});

test("getAssistant: an unknown or missing id returns null, never a default persona", () => {
  assert.equal(getAssistant("nonexistent"), null);
  assert.equal(getAssistant(""), null);
  assert.equal(getAssistant(undefined), null);
});

test("resolveAssistantNavigation: an unknown assistant falls back to the dashboard without opening any panel", () => {
  assert.deepEqual(resolveAssistantNavigation("nope"), { page: "dashboardPage", openLily: false });
});

test("resolveAssistantNavigation: Lily opens her panel on her default page by default", () => {
  const nav = resolveAssistantNavigation("lily");
  assert.equal(nav.page, "aiStudioPage");
  assert.equal(nav.openLily, true);
});

test("resolveAssistantNavigation: Lily's panel can be suppressed via preferPanel:false (navigate only)", () => {
  const nav = resolveAssistantNavigation("lily", { preferPanel: false });
  assert.equal(nav.openLily, false);
});

test("resolveAssistantNavigation: Rose and Bud navigate to their page without opening Lily's panel", () => {
  assert.deepEqual(resolveAssistantNavigation("rose"), { page: "reportsPage", openLily: false });
  assert.deepEqual(resolveAssistantNavigation("bud"), { page: "aiStudioPage", openLily: false });
});

test("resolveAssistantNavigation: Daisy gets a gentle wag and a default tip when none is supplied", () => {
  const nav = resolveAssistantNavigation("daisy");
  assert.equal(nav.page, "dashboardPage");
  assert.equal(nav.gentleWag, true);
  assert.match(nav.tip, /Lily or Rose/);
});

test("resolveAssistantNavigation: Daisy's tip is overridable", () => {
  const nav = resolveAssistantNavigation("daisy", { tip: "Custom tip" });
  assert.equal(nav.tip, "Custom tip");
});
