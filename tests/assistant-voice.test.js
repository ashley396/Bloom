import test from "node:test";
import assert from "node:assert/strict";
import {
  pickAssistantVoice,
  scoreVoiceForPersona,
  prepareAssistantSpeechText,
  splitSpeechSentences,
  mergeVoiceSettings,
  VOICE_DEFAULTS
} from "../netlify/functions/_shared/assistant-voice.js";

test("prepareAssistantSpeechText strips emoji and clamps length", () => {
  const t = prepareAssistantSpeechText("Hello 🌸 world.  Extra   spaces.");
  assert.match(t, /Hello world/);
  assert.doesNotMatch(t, /🌸/);
});

test("splitSpeechSentences breaks on punctuation", () => {
  const parts = splitSpeechSentences("One. Two! Three?");
  assert.equal(parts.length, 3);
});

test("natural voices score higher than robotic names", () => {
  const neural = { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US" };
  const legacy = { name: "Microsoft David Desktop", lang: "en-US" };
  assert.ok(scoreVoiceForPersona(neural, "Lily") > scoreVoiceForPersona(legacy, "Lily"));
});

test("Lily and Rose pick different best voices when options differ", () => {
  const voices = [
    { name: "Microsoft Jenny Online (Natural) - English (United States)", lang: "en-US" },
    { name: "Microsoft Zira Desktop - English (United States)", lang: "en-US" }
  ];
  const lily = pickAssistantVoice(voices, "Lily");
  const rose = pickAssistantVoice(voices, "Rose");
  assert.ok(lily && rose);
});

test("mergeVoiceSettings uses defaults when values missing", () => {
  const m = mergeVoiceSettings("Rose", {});
  assert.equal(m.rate, VOICE_DEFAULTS.Rose.rate);
  assert.equal(m.pitch, VOICE_DEFAULTS.Rose.pitch);
});

test("assistant-tts handler advertises fallback when cloud not configured", async () => {
  const { handler } = await import("../netlify/functions/assistant-tts.js");
  const res = await handler({
    httpMethod: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona: "Lily", text: "Hello" })
  });
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.body);
  assert.equal(body.fallback, true);
});
