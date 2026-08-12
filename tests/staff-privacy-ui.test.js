import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("new employees require a PIN while employee edits keep PIN optional", () => {
  assert.match(index, /<input name="pin" type="password"[^>]*pattern="\[0-9\]\{4,8\}"/);
  assert.match(app, /pin\.required=!x\?\.id/);
  assert.match(index, /Leave blank while editing to keep the current PIN\./);
});
