import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { toVisionImagePayload } from "../netlify/functions/_shared/florist-ai-vision.js";
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

test("florist-community generate_recipe wires photo vision", () => {
  const handler = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(handler, /analyzeArrangementPhoto/);
  assert.match(handler, /resolveCommunityImageForVision/);
  assert.match(handler, /image_data_url/);
  assert.match(handler, /adminSignedImageUrl/);
  assert.match(handler, /local_vision_fallback/);
});
