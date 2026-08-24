import test from "node:test";
import assert from "node:assert/strict";
import {
  planVideoRender,
  selectVideoRenderProvider,
  notLiveVideoRenderProvider,
  buildConfiguredVideoRenderProviderRegistry,
  VIDEO_RENDER_NOT_LIVE,
  VIDEO_ASPECT_RATIOS
} from "../netlify/functions/_shared/marketing-video-render-engine.js";

// Priority 3 ("as far as technically possible" pass): the video-rendering
// provider abstraction. No real provider is configured anywhere — every
// live-execution method must fail honestly; planVideoRender() is the real,
// buildable-today piece.

test("planVideoRender: rejects a request with no source image(s) or video", () => {
  const result = planVideoRender({});
  assert.equal(result.ok, false);
  assert.match(result.error, /source image or a source video/i);
});

test("planVideoRender: builds a real, timed shot list from multiple source images", () => {
  const result = planVideoRender({
    sourceImageUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    durationSeconds: 10,
    aspectRatio: "9:16"
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.shots.length, 2);
  assert.equal(result.plan.shots[0].startSeconds, 0);
  assert.equal(result.plan.shots[0].durationSeconds, 5);
  assert.equal(result.plan.shots[1].startSeconds, 5);
  assert.equal(result.plan.status, "plan_only", "never claims a finished render");
});

test("planVideoRender: clamps duration into a sane range and defaults an invalid aspect ratio to 9:16", () => {
  const tooLong = planVideoRender({ sourceImageUrls: ["https://example.com/a.jpg"], durationSeconds: 999 });
  assert.equal(tooLong.plan.durationSeconds, 60);
  const tooShort = planVideoRender({ sourceImageUrls: ["https://example.com/a.jpg"], durationSeconds: 0.1 });
  assert.equal(tooShort.plan.durationSeconds, 3);
  const badRatio = planVideoRender({ sourceImageUrls: ["https://example.com/a.jpg"], aspectRatio: "not-a-ratio" });
  assert.equal(badRatio.plan.aspectRatio, "9:16");
  assert.deepEqual(badRatio.plan.canvas, VIDEO_ASPECT_RATIOS["9:16"]);
});

test("planVideoRender: text overlays and captions are real structured plan fields, capped and sanitized", () => {
  const result = planVideoRender({
    sourceImageUrls: ["https://example.com/a.jpg"],
    textOverlays: [{ text: "Fall Collection", atSeconds: 1, position: "top" }],
    captions: "Introducing our fall collection"
  });
  assert.equal(result.plan.textOverlays.length, 1);
  assert.equal(result.plan.textOverlays[0].position, "top");
  assert.equal(result.plan.captions.burnedIn, true);
});

test("planVideoRender: a source video (no images) produces one static shot for the full duration", () => {
  const result = planVideoRender({ sourceVideoUrl: "https://example.com/clip.mp4", durationSeconds: 20 });
  assert.equal(result.plan.shots.length, 1);
  assert.equal(result.plan.shots[0].motion, "static");
  assert.equal(result.plan.shots[0].durationSeconds, 20);
});

test("notLiveVideoRenderProvider: every method throws the typed not-live error, never a fake success", async () => {
  for (const method of ["renderVideo", "getRenderStatus", "cancelRender", "estimateCost"]) {
    await assert.rejects(() => notLiveVideoRenderProvider[method]({}), (err) => {
      assert.equal(err.code, VIDEO_RENDER_NOT_LIVE);
      assert.equal(err.statusCode, 501);
      return true;
    });
  }
});

test("selectVideoRenderProvider: falls back to the not-live provider when the registry is empty", () => {
  const provider = selectVideoRenderProvider({}, {});
  assert.equal(provider, notLiveVideoRenderProvider);
});

test("buildConfiguredVideoRenderProviderRegistry: always empty today — no video-rendering provider adapter exists yet", () => {
  const registry = buildConfiguredVideoRenderProviderRegistry({ env: { SOME_VIDEO_KEY: "present" } });
  assert.deepEqual(registry, {});
});
