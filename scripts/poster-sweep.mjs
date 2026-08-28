#!/usr/bin/env node
/**
 * Sweep the poster layer across every canvas the product generates and a wide
 * spread of real florist wording, and report anything that leaves the sheet or
 * is set too small to read.
 *
 * Why this is a committed script and not a scratch file: every geometry fault
 * fixed in this file so far was found by a sweep like this, and each time the
 * sweep was rewritten from scratch it came back slightly different — a
 * different canvas size, no text bounds, no letter-spacing — and missed what
 * the last one caught. The bounded version in tests/flyer-poster.test.js keeps
 * the suite fast; this is the exhaustive one to run after touching layout.
 *
 * It shares tests/helpers/poster-recording-context.mjs with those tests, so
 * both judge "off the sheet" by exactly the same rule.
 *
 * IMPORTANT about what this proves. The recording canvas measures characters
 * at a flat 0.52em; real Parisienne and Playfair are nothing like that. A
 * clean sweep is evidence that the layout RULES hold — that nothing is
 * positioned outside its sheet by construction. It is not visual proof, and it
 * cannot see a descender clipping the line below. Look at a real render.
 *
 * Usage:
 *   node scripts/poster-sweep.mjs            # the standard sweep
 *   node scripts/poster-sweep.mjs --seeds 60 # wider
 */
import { loadPoster, recordingContext, offSheet } from "../tests/helpers/poster-recording-context.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const { poster } = loadPoster(process.cwd());

// ASPECT_RATIOS in netlify/functions/_shared/flyer-templates.js — the sizes a
// florist's flyer is actually generated at. Mirrored rather than imported so
// this stays a plain browser-layer check with no server import; keep in step.
const SIZES = [
  [1080, 1080, "square"],
  [1080, 1920, "story"],
  [1200, 630, "facebook_post"],
  [1275, 1650, "flyer"],
  [1200, 400, "email_banner"]
].filter(([w, h, label]) => {
  // The landscape sizes are handed back to public/flyer-renderer.js rather
  // than drawn here — see posterSuitsCanvas. Sweeping them would be sweeping
  // a poster no florist is ever shown.
  const serves = poster.posterSuitsCanvas(w, h);
  if (!serves) console.log(`skipping ${label} ${w}x${h} — the poster hands this shape to the renderer`);
  return serves;
});

const HEADLINES = [
  "Closing Early Today", "Funeral Flowers", "Remembrance", "Valentine's Day",
  "Mother's Day Weekend Sale", "Chrysanthemums Today", "Congratulations",
  "Thanksgiving Weekend", "In Loving Memory", "Open", "Sympathy", "Spring"
];
const BODIES = [
  "Lilies in Bloom is closing at 2:30 today.",
  "Closed.",
  "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each and every morning of the week.",
  "Standing sprays, casket flowers and small arrangements for the service, made here in the shop by hand each and every morning of the week, with same-day delivery available to every funeral home in the county.",
  "Order at flowers@example-florist-with-a-long-domain.com or www.example-florist-with-a-long-domain.com/orders before Thursday."
];
const CTAS = [
  "Call 606-506-4039 to place an order.",
  "Call 606-506-4039",
  "Order online any time.",
  "",
  "Call 606-506-4039 to place an order today and we will have it ready for you within the hour."
];
const SHOPS = ["Lilies in Bloom", "B", "The Very Long Flower Shop Name Company Limited", "Rose & Thorn"];

const seeds = Number(arg("seeds", "40")) || 40;
const failures = [];
// Tracked separately, because they answer different questions. Ordinary copy
// is what a florist actually writes, and the readability floor governs it. A
// body carrying an unbreakable 45-character email address has no size at which
// it both fits the column and stays readable — there the fit shrinks past the
// floor deliberately, since a small address is at least a correct one.
const smallest = new Map();
const smallestOrdinary = new Map();
const UNBREAKABLE = /\S{28,}/;
let checked = 0;

for (const [width, height, label] of SIZES) {
  for (let seed = 1; seed <= seeds; seed++) {
    for (const headline of HEADLINES) {
      for (const body of BODIES) {
        for (const cta of CTAS) {
          for (const shopName of SHOPS) {
            const ctx = recordingContext(width, height);
            const base = {
              width, height, seed,
              content: { headline, body, cta },
              brand: { shopName, phone: "606-506-4039", primaryColor: "#7c3a58", accentColor: "#c98fae" },
              palette: poster.derivePalette("#7c3a58", "#c98fae", null),
              image: null
            };
            // The same two-pass fit renderPoster runs. Sweeping drawPoster on
            // its own would be sweeping a call no shipped code path makes.
            poster.fitPoster(ctx, base);
            ctx.points.length = 0;
            ctx.texts.length = 0;
            const laid = poster.drawPoster(ctx, base);
            checked++;

            const escaped = offSheet(ctx, width, height);
            if (escaped.length) {
              failures.push({ label, width, height, composition: laid.composition, seed, headline, cta, shopName, first: escaped[0] });
            }
            if (laid.ribbon) {
              for (const t of ctx.texts) {
                if (t.y > laid.ribbon.y && t.y < laid.ribbon.y + laid.ribbon.h) {
                  const key = `${label} ${width}x${height}`;
                  if (!smallest.has(key) || t.size < smallest.get(key).size) smallest.set(key, { size: t.size, text: t.text, composition: laid.composition, seed, cta });
                  if (!UNBREAKABLE.test(body) && (!smallestOrdinary.has(key) || t.size < smallestOrdinary.get(key).size)) {
                    smallestOrdinary.set(key, { size: t.size, text: t.text, composition: laid.composition, seed, cta });
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

console.log(`checked ${checked.toLocaleString()} combinations across ${SIZES.length} canvases\n`);
console.log("smallest message drawn on the ribbon, per canvas:");
console.log(`  ${"canvas".padEnd(28)} ${"ordinary copy".padEnd(15)} with an unbreakable address`);
for (const [key, worst] of smallest) {
  const ordinary = smallestOrdinary.get(key);
  console.log(`  ${key.padEnd(28)} ${(ordinary ? Math.round(ordinary.size) + "px" : "-").padEnd(15)} ${Math.round(worst.size)}px`);
  if (ordinary) console.log(`  ${"".padEnd(28)} ordinary worst case: ${ordinary.composition} seed=${ordinary.seed} "${ordinary.text.slice(0, 40)}"`);
}
console.log("");
if (!failures.length) {
  console.log("nothing left the sheet");
  process.exit(0);
}
const seen = new Set();
for (const f of failures) {
  const key = `${f.label} ${f.composition}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`OFF SHEET  ${key} seed=${f.seed} "${f.headline}" cta="${f.cta}" shop="${f.shopName}"`);
  console.log(`           ${JSON.stringify(f.first)}`);
}
console.log(`\n${failures.length} of ${checked} combinations put something outside the sheet`);
process.exit(1);
