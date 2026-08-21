import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Two follow-up fixes from the consolidated 5-workstream audit report:
 *
 * 1. The top-dock "Daisy" button navigated to the Dashboard instead of
 *    opening the real Daisy persona (which only exists inside the Lily-
 *    platform chat panel, with no page of her own). daisy-mascot.js's
 *    naming was also inconsistent — its primary export was named
 *    window.BloomRose (Daisy booted through a variable named after Rose),
 *    even though nothing in that file has anything to do with the real
 *    "Rose" business advisor (florisyn-luxury-business-os.js's
 *    window.FlorisynBusinessOs).
 *
 * 2. The custom-voice-upload control (florist Settings and Admin -> UI
 *    Design Mode) implied uploading changed what the assistant actually
 *    sounds like. It only ever wrote to localStorage for local preview —
 *    it never reached the real ElevenLabs TTS pipeline for Lily/Rose/Bud
 *    (Daisy is the one exception: she speaks only from an uploaded
 *    sample). The UI now says so plainly instead of implying otherwise.
 */

const root = process.cwd();

test("daisy-mascot.js's primary export is honestly named BloomDaisy, not BloomRose", () => {
  const src = fs.readFileSync(path.join(root, "public/daisy-mascot.js"), "utf8");
  assert.match(src, /window\.BloomDaisy\s*=\s*\{/, "BloomDaisy must be the real, primary export");
  assert.doesNotMatch(src, /window\.BloomRose\s*=/, "must not export under the wrong assistant's name");
});

test("no other frontend file still boots the Daisy mascot through the wrongly-named BloomRose global", () => {
  const files = fs.readdirSync(path.join(root, "public")).filter((f) => f.endsWith(".js"));
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, "public", file), "utf8");
    if (/window\.BloomRose\b/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("the Daisy dock button no longer carries a stale route to the Dashboard", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const btnStart = html.indexOf('data-assistant="daisy"');
  assert.ok(btnStart > -1, "the Daisy dock button must still exist");
  const btnTag = html.slice(html.lastIndexOf("<button", btnStart), html.indexOf(">", btnStart) + 1);
  assert.doesNotMatch(btnTag, /data-route=/, "Daisy has no page of her own — a stale data-route silently mis-routed the button");
  assert.doesNotMatch(btnTag, /data-page=/);
});

test("lily-platform.js exposes a real way to open the panel already switched to a given persona", () => {
  const src = fs.readFileSync(path.join(root, "public/lily-platform.js"), "utf8");
  assert.match(src, /function openPersona\(name\)/);
  assert.match(src, /open:\s*openPersona/, "must be exported on window.BloomLilyPlatform as 'open'");
  const fn = src.slice(src.indexOf("function openPersona"), src.indexOf("window.BloomLilyPlatform"));
  assert.match(fn, /setPersona\(name\)/, "must actually switch to the requested persona, not just open on whatever was last selected");
  assert.match(fn, /togglePanel\(true\)/);
});

test("app.js wires the Daisy dock button to actually open the Daisy persona", () => {
  const src = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(src, /\[data-assistant='daisy'\]/);
  assert.match(src, /BloomLilyPlatform\?\.open\?\.\("daisy"\)/);
});

test("no leftover dead calls through the removed BloomRose global anywhere the Daisy mascot is booted", () => {
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const firstRun = fs.readFileSync(path.join(root, "public/bloom-rc2-first-run.js"), "utf8");
  assert.doesNotMatch(appJs, /BloomRose/);
  assert.doesNotMatch(firstRun, /BloomRose/);
  // The real, correctly-named calls must still be present and functional.
  assert.match(appJs, /BloomDaisy\?\.mount\?\.\(\)/);
  assert.match(appJs, /BloomDaisy\?\.mountSettings\?\.\(/);
  assert.match(firstRun, /BloomDaisy\?\.gentleWag\?\.\("Welcome"\)/);
});

test("custom voice upload copy is honest: local preview for Lily/Rose/Bud, and Daisy is the one real exception", () => {
  const florist = fs.readFileSync(path.join(root, "public/assistant-voice.js"), "utf8");
  const admin = fs.readFileSync(path.join(root, "public/florisyn-ui-editor.js"), "utf8");
  for (const src of [florist, admin]) {
    assert.match(src, /Daisy is the one exception/i, "must call out Daisy as the real exception");
    assert.match(src, /doesn't change that|unaffected by this upload/i, "must say plainly that Lily/Rose/Bud's real spoken replies are unaffected");
  }
});

test("existing custom-voice-upload mechanics are untouched by the copy fix", () => {
  const src = fs.readFileSync(path.join(root, "public/florisyn-ui-editor.js"), "utf8");
  assert.match(src, /function uploadVoice\(persona, file\)/);
  assert.match(src, /window\.FlorisynUiEditor\s*=\s*\{[\s\S]*uploadVoice/, "uploadVoice must still be exported for assistant-voice.js to call");
  const voiceJs = fs.readFileSync(path.join(root, "public/assistant-voice.js"), "utf8");
  assert.match(voiceJs, /window\.FlorisynUiEditor\?\.uploadVoice\?\.\(persona, file\)/);
});

test("Daisy is no longer hard-blocked from the real cloud/browser voice pipeline when no sample is uploaded", () => {
  const src = fs.readFileSync(path.join(root, "public/assistant-voice.js"), "utf8");
  const fn = src.slice(src.indexOf("async function speak("), src.indexOf("\n  }", src.indexOf("async function speak(")));
  assert.doesNotMatch(fn, /who === "Daisy"\) return false/, "Daisy must no longer dead-end with no real voice when she has no uploaded sample");
  // An uploaded sample must still be tried first for Daisy specifically.
  assert.match(fn, /options\.preferUploadedVoice \|\| options\.sampleOnly \|\| who === "Daisy"/);
  // But falling through to the real cloud/browser pipeline (loadSettings + tryCloudSpeak/speakBrowser) must not be Daisy-blocked any more.
  const afterUploadBlock = fn.slice(fn.indexOf("const cfg = loadSettings"));
  assert.doesNotMatch(afterUploadBlock, /Daisy/, "no Daisy-specific gate should remain after the upload-sample attempt");
});
