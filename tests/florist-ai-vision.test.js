import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { toVisionImagePayload, assessGeneratedMarketingPhoto } from "../netlify/functions/_shared/florist-ai-vision.js";
import {
  inferFlowersFromPostText,
  buildLocalRecipeDraftFromPost,
  generateRecipeWithCloudflare,
} from "../netlify/functions/_shared/florist-community-recipes.js";

test("toVisionImagePayload accepts data URLs and buffers", () => {
  const buf = Buffer.from("fake-image");
  assert.match(
    toVisionImagePayload({ dataUrl: "data:image/jpeg;base64,abc" }),
    /^data:image\/jpeg;base64,abc/
  );
  assert.match(
    toVisionImagePayload({ buffer: buf, mime: "image/png", path: "x.png" }),
    /^data:image\/png;base64,/
  );
  assert.equal(toVisionImagePayload({}), null);
});

test("inferFlowersFromPostText prioritizes vision analysis text", () => {
  const stems = inferFlowersFromPostText("Modern mix", "", "hydrangea, Freedom rose, eucalyptus");
  assert.ok(stems.some((row) => /hydrangea/i.test(row.name)));
  assert.ok(stems.some((row) => /rose/i.test(row.name)));
});

test("buildLocalRecipeDraftFromPost uses vision text in local fallback", () => {
  const draft = buildLocalRecipeDraftFromPost(
    { caption: "Shop post", body: "" },
    { visionText: "spray rose, stock, leatherleaf" }
  );
  assert.ok(draft.recipe.some((row) => /spray rose|stock|leatherleaf/i.test(row.name)));
  assert.match(draft.description, /photo read/i);
});

test("generateRecipeWithCloudflare tags vision-backed cloud drafts", async () => {
  const out = await generateRecipeWithCloudflare(
    async () => ({
      result: {
        name: "Garden Bowl",
        recipe: [{ name: "Hydrangea", qty: 2, kind: "flower" }],
        instructions: ["Build in bowl."],
      },
    }),
    { caption: "Test" },
    { visionText: "hydrangea, garden rose" }
  );
  assert.equal(out.source, "cloudflare_vision");
  assert.equal(out.draft.name, "Garden Bowl");
});

test("parseClientImageDataUrl accepts browser data URLs for Lily vision", async () => {
  const { parseClientImageDataUrl } = await import(
    "../netlify/functions/_shared/florist-community-storage.js"
  );
  const tiny = Buffer.from("fakejpeg").toString("base64");
  const payload = parseClientImageDataUrl(`data:image/jpeg;base64,${tiny}`);
  assert.ok(payload?.buffer?.length);
  assert.equal(payload.mime, "image/jpeg");
  assert.equal(parseClientImageDataUrl("not-an-image"), null);
});

test("signedImageUrl stays fail-closed without admin bypass in feed", () => {
  const handler = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.doesNotMatch(handler, /signedImageUrl\(client, p\.image_path, \{ adminClient/);
  assert.match(handler, /adminSignedImageUrl/);
});

test("florist-community generate_recipe wires photo vision", () => {
  const handler = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(handler, /analyzeArrangementPhoto/);
  assert.match(handler, /resolveCommunityImageForVision/);
  assert.match(handler, /image_data_url/);
  assert.match(handler, /adminSignedImageUrl/);
  assert.match(handler, /local_vision_fallback/);
});

// ---------------------------------------------------------------------------
// assessGeneratedMarketingPhoto — Phase 2 rebuild, priority-3 gap: a real
// quality-control gate combining invented-text detection with a check that
// the photo actually matches the creative brief it was asked to depict.
// Combined into ONE vision call (see the function's own docstring) — these
// tests exercise the reply-parsing and graceful-degradation contract
// directly, separate from ai-image-engine.test.js's end-to-end retry-loop
// coverage via generateImageCheckingText.
// ---------------------------------------------------------------------------

function mockVisionReply(replyText) {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts?.body || "{}");
    return { ok: true, json: async () => ({ success: true, result: { description: replyText } }) };
  };
  return {
    getSentBody: () => sentBody,
    restore: () => {
      globalThis.fetch = originalFetch;
    }
  };
}

test("assessGeneratedMarketingPhoto: a clean PASS/NO verdict is accepted", async () => {
  const mock = mockVisionReply("TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: matches the brief");
  try {
    const result = await assessGeneratedMarketingPhoto(
      { dataUrl: "data:image/jpeg;base64,abc" },
      { creativeBrief: { primary_subject: "A dozen garden roses" } }
    );
    assert.equal(result.ok, true);
    assert.equal(result.accepted, true);
    assert.equal(result.hasText, false);
    assert.equal(result.reason, "matches the brief");
  } finally {
    mock.restore();
  }
});

test("assessGeneratedMarketingPhoto: invented text alone is enough to reject, even with a subject match", async () => {
  const mock = mockVisionReply("TEXT: YES\nSUBJECT_MATCH: PASS\nREASON: garbled watermark in the corner");
  try {
    const result = await assessGeneratedMarketingPhoto({ dataUrl: "data:image/jpeg;base64,abc" });
    assert.equal(result.hasText, true);
    assert.equal(result.accepted, false);
  } finally {
    mock.restore();
  }
});

test("assessGeneratedMarketingPhoto: a subject mismatch alone is enough to reject, even with no text", async () => {
  const mock = mockVisionReply("TEXT: NO\nSUBJECT_MATCH: FAIL\nREASON: shows a birthday cake, not flowers");
  try {
    const result = await assessGeneratedMarketingPhoto(
      { dataUrl: "data:image/jpeg;base64,abc" },
      { creativeBrief: { primary_subject: "A dozen garden roses" } }
    );
    assert.equal(result.hasText, false);
    assert.equal(result.accepted, false);
    assert.match(result.reason, /birthday cake/);
  } finally {
    mock.restore();
  }
});

test("assessGeneratedMarketingPhoto: the real prompt sent to the model carries the creativeBrief's primary_subject and mood", async () => {
  const mock = mockVisionReply("TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: ok");
  try {
    await assessGeneratedMarketingPhoto(
      { dataUrl: "data:image/jpeg;base64,abc" },
      { creativeBrief: { primary_subject: "A dozen garden roses in a low ceramic vase", mood: "romantic, soft" } }
    );
    const body = mock.getSentBody();
    const sentText = JSON.stringify(body);
    assert.match(sentText, /A dozen garden roses in a low ceramic vase/);
    assert.match(sentText, /romantic, soft/);
  } finally {
    mock.restore();
  }
});

test("assessGeneratedMarketingPhoto: with no creativeBrief/visualBrief/occasion at all, the subject check is told to always pass rather than reject on nothing to compare against", async () => {
  const mock = mockVisionReply("TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: ok");
  try {
    await assessGeneratedMarketingPhoto({ dataUrl: "data:image/jpeg;base64,abc" });
    const sentText = JSON.stringify(mock.getSentBody());
    assert.match(sentText, /No specific subject was given to check against/);
  } finally {
    mock.restore();
  }
});

test("assessGeneratedMarketingPhoto: an unparseable reply never blocks a real photo — defaults to accepted", async () => {
  const mock = mockVisionReply("I'm not sure how to answer that.");
  try {
    const result = await assessGeneratedMarketingPhoto({ dataUrl: "data:image/jpeg;base64,abc" });
    assert.equal(result.accepted, true);
    assert.equal(result.hasText, false);
  } finally {
    mock.restore();
  }
});

test("assessGeneratedMarketingPhoto: a vision-model outage never blocks a real photo — returns ok:false, accepted:true", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ success: false, errors: [{ message: "vision model unavailable" }] }) });
  try {
    const result = await assessGeneratedMarketingPhoto({ dataUrl: "data:image/jpeg;base64,abc" });
    assert.equal(result.ok, false);
    assert.equal(result.accepted, true, "a QA-check outage must never hold up a real, otherwise-successful photo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assessGeneratedMarketingPhoto: no usable image payload at all returns accepted:true without ever calling the model", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS" } }) };
  };
  try {
    const result = await assessGeneratedMarketingPhoto({});
    assert.equal(result.accepted, true);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
