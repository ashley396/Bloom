import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractHelper(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} helper not found`);
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const publicSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

const context = {
  console,
  String,
  Array,
  Object,
  Number,
  Boolean,
  Date,
  RegExp,
  localStorage: {
    getItem() { return null; },
    setItem() {}
  }
};
vm.createContext(context);
vm.runInContext(extractHelper(appSource, "aiGeneratedText"), context);
vm.runInContext(extractHelper(publicSource, "aiGeneratedText"), context);

const { aiGeneratedText } = context;

assert.strictEqual(aiGeneratedText("plain text"), "plain text");
assert.strictEqual(aiGeneratedText({ answer: { text: "Hello from Lily" } }), "Hello from Lily");
assert.strictEqual(aiGeneratedText({ reply: { content: ["First line", "Second line"] } }), "First line\nSecond line");
assert.strictEqual(aiGeneratedText({ data: { message: "Nested value" } }), "data: Nested value");
assert.strictEqual(aiGeneratedText({ details: { outcome: { response: "Done" } } }), "details: outcome: Done");
assert.strictEqual(aiGeneratedText({ nested: { example: { value: 42 } } }), "nested: example: 42");

console.log("AI text extraction regression tests passed");
