import test from "node:test";
import assert from "node:assert/strict";
import { buildPersonalBrandConceptTask, generatePersonalBrandConcept } from "../netlify/functions/_shared/creative-ai/personal-brand-concept.js";

function mockCloudflareOnce(jsonResult) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) };
  };
  return {
    getSentBody: () => sentBody,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

test("buildPersonalBrandConceptTask: throws on an unknown mode rather than silently building a generic task", () => {
  assert.throws(() => buildPersonalBrandConceptTask({ mode: "not_a_mode", profile: {} }), /unknown mode/);
});

test("buildPersonalBrandConceptTask: folds in this specific florist's real profile fields", () => {
  const task = buildPersonalBrandConceptTask({
    mode: "founder_portrait",
    profile: { display_name: "Jordan Lee", founder_title: "Owner & Lead Designer", professional_casual_balance: "professional" }
  });
  assert.match(task, /Jordan Lee/);
  assert.match(task, /Owner & Lead Designer/);
  assert.match(task, /Founder Portrait/);
});

test("buildPersonalBrandConceptTask: founder_story mode includes the florist's own stated story verbatim, never a generic placeholder", () => {
  const task = buildPersonalBrandConceptTask({
    mode: "founder_story",
    profile: { founder_story: "Started arranging flowers for my grandmother's funeral in 2015." }
  });
  assert.match(task, /Started arranging flowers for my grandmother's funeral in 2015\./);
  assert.match(task, /never invent a different one/);
});

test("buildPersonalBrandConceptTask: a mode other than founder_story never leaks the founder story into the prompt", () => {
  const task = buildPersonalBrandConceptTask({
    mode: "casual",
    profile: { founder_story: "A private detail not relevant to a casual post." }
  });
  assert.doesNotMatch(task, /A private detail not relevant/);
});

test("buildPersonalBrandConceptTask: includes the florist's learned style summary when given", () => {
  const task = buildPersonalBrandConceptTask({ mode: "behind_the_counter", profile: {}, styleSummary: "clothing style: black apron over a white blouse" });
  assert.match(task, /black apron over a white blouse/);
});

test("buildPersonalBrandConceptTask: two different florists' profiles never bleed into each other's task text", () => {
  const taskA = buildPersonalBrandConceptTask({ mode: "founder_portrait", profile: { display_name: "Jordan Lee" } });
  const taskB = buildPersonalBrandConceptTask({ mode: "founder_portrait", profile: { display_name: "Priya Nair" } });
  assert.match(taskA, /Jordan Lee/);
  assert.doesNotMatch(taskA, /Priya Nair/);
  assert.match(taskB, /Priya Nair/);
  assert.doesNotMatch(taskB, /Jordan Lee/);
});

test("generatePersonalBrandConcept: returns real finished content including a founder_presence_brief", async () => {
  const mock = mockCloudflareOnce({
    headline: "Meet the founder",
    body: "I started this shop because flowers say what words can't.",
    cta: "Come say hi this weekend",
    visual_brief: "Warm, sunlit shop interior",
    founder_presence_brief: "Standing behind the design counter, mid-laugh, black apron",
    hashtags: ["#florist", "#smallbusiness"]
  });
  try {
    const result = await generatePersonalBrandConcept({ mode: "founder_portrait", profile: { display_name: "Jordan Lee" }, requestText: "make me a founder portrait" });
    assert.equal(result.ok, true);
    assert.equal(result.content.mode, "founder_portrait");
    assert.match(result.content.founder_presence_brief, /apron/);
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /never restate or describe the request/i);
  } finally {
    mock.restore();
  }
});

test("generatePersonalBrandConcept: returns ok:false (never throws) when the model returns no usable body", async () => {
  const mock = mockCloudflareOnce({ headline: "x" });
  try {
    const result = await generatePersonalBrandConcept({ mode: "casual", profile: {}, requestText: "x" });
    assert.equal(result.ok, false);
  } finally {
    mock.restore();
  }
});
