/**
 * Florisyn AI Core — structured generation with real outcome contracts
 * (Phase 2/4 of the AI-OS rebuild — the direct fix for Failure 1).
 *
 * The old path handed the model `Task: Write facebook marketing copy` plus
 * the user's own literal words as `input.prompt`, with nothing telling it
 * to produce the finished asset rather than reflect the instruction back —
 * and the raw `{text}` result got JSON.stringify-dumped into the chat.
 * Every generation call here instead: (1) tells the model explicitly that
 * its job is to write the actual, publish-ready content, never describe or
 * restate the request; (2) requests a real structured shape per asset type
 * (platform/headline/body/cta/visual brief/hashtags — not just "text");
 * (3) persists the result to ai_generated_assets so it's reusable, not
 * chat-transcript-only; (4) is parsed/validated before it ever reaches a
 * client, so a malformed model response fails loudly instead of rendering
 * as broken JSON in the UI.
 */

import { runCloudflareGenerate } from "../ai-assistant.js";

/**
 * Real, live-found failure: a florist named "Lilies in Bloom" asked (three
 * times, three different phrasings) for "today's post for Lilies in Bloom" —
 * an ordinary, no-specific-topic request for her shop's regular update — and
 * got back a caption and photo entirely about lily FLOWERS ("Our lilies are
 * in full bloom... our lilies are the perfect choice"), with her shop's own
 * identity barely or never mentioned. The shop's name reached the model only
 * as inert JSON data (input.shop.name); nothing in the prompt TEXT ever told
 * it the name was identity rather than a topic, and a name that happens to
 * spell a real flower/plant phrase reads as an obvious theme to write about.
 * This is a real category, not a one-off — "The Rose Garden," "Daisy Chain
 * Florals," "Petal Pushers" and plenty of other real shop names have the
 * same shape. Never mention a specific shop here — that would violate
 * multi-tenant safety; this reads shopName fresh from whichever real,
 * authenticated shop is calling.
 */
// Generic scaffolding a florist's own phrasing is built from ("make today's
// post for X", "create me X's post") — stripped out before comparing what's
// LEFT against the shop's own name. Deliberately conservative (English
// filler only): a false negative here just falls back to the base rule
// below, never breaks anything; a false positive would suppress a real
// topic, which is the failure mode to avoid.
const REQUEST_SCAFFOLDING_WORDS = new Set([
  "make", "made", "making", "create", "created", "creating", "today", "todays",
  "me", "my", "a", "an", "the", "post", "posts", "posting", "flyer", "flyers",
  "facebook", "instagram", "fb", "ig", "photo", "photos", "picture", "pictures",
  "pic", "pics", "image", "images", "for", "about", "of", "on", "please",
  "can", "you", "i", "need", "want", "would", "like", "this", "that", "and"
]);

export function significantWords(text) {
  return String(text || "")
    .toLowerCase()
    // Strip a possessive "'s" BEFORE the general apostrophe strip below —
    // otherwise "Iris's" collapses into "iriss" (the letters either side
    // of the apostrophe merging into one word) instead of the real word
    // "iris". Found reviewing a person's-name-that's-also-a-flower shop
    // name ("Iris's Flowers") for the shop-identity fixation check.
    .replace(/['’]s\b/g, "")
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((w) => !REQUEST_SCAFFOLDING_WORDS.has(w));
}

/**
 * True when a request/occasion, once ordinary scaffolding words are
 * stripped, is nothing but the shop's own name — "make today's post for
 * Lilies in Bloom," "create me today's lilies in bloom post" — meaning
 * there is no real topic or occasion here at all beyond naming the shop.
 *
 * A real, independent-review-found gap in an earlier draft: checking only
 * "every word in the request is part of the shop's own name" wrongly
 * caught a shop with a LONGER floral name too. "Daisy Chain Florals" is
 * three words; "make today's daisy post" reduces to just ["daisy"] —
 * one word, trivially "part of" the shop's name — and got the same "no
 * real topic" redirect a genuine, single-flower request deserves to keep.
 * Requiring the request to also cover MOST of the shop's own distinct
 * words (not merely be a subset of them) closes that: one shared word out
 * of three no longer matches, while "lilies in bloom" against "Lilies in
 * Bloom" (covering all three) still does. Pure; never mentions a specific
 * shop.
 */
export function requestIsJustShopName(requestText, shopName) {
  const words = significantWords(requestText);
  const shopWords = significantWords(shopName);
  const shopWordSet = new Set(shopWords);
  const distinctShopWords = shopWordSet.size;
  if (!words.length || !distinctShopWords) return false;
  if (!words.every((w) => shopWordSet.has(w))) return false;
  const requestWordSet = new Set(words);
  const covered = shopWords.filter((w) => requestWordSet.has(w)).length;
  const missing = distinctShopWords - covered;
  return missing <= 1 && covered / distinctShopWords > 0.5;
}

function shopIdentityRule(shopName, occasion) {
  const name = String(shopName || "").trim();
  if (!name) return "";
  const base = `- This shop's own name is exactly "${name}" — that is ONLY the business's identity/branding, never a topic, flower, plant, or product to write content about, even when the name itself is or contains a flower/plant word. A request that simply names the shop (e.g. "make today's post for ${name}", "a ${name} post", "today's ${name} post") is asking for an ordinary, general shop-update post — ground it in whatever real occasion, inventory, or topic the request ACTUALLY gives, never in words from the shop's own name.`;
  // Stronger, real-example-found gap: telling the model the name is merely
  // "not a topic" wasn't enough on its own — the SAME words were also
  // sitting in "Occasion/theme: <request text>" one line up, still reading
  // as an obvious theme. When the request truly reduces to nothing but the
  // shop's own name restated, say so explicitly and redirect to a genuinely
  // general post, rather than leaving the model to infer it.
  if (!requestIsJustShopName(occasion, name)) return base;
  return `${base}\n- This exact request is nothing more than the shop's own name restated as "today's post" — there is NO real occasion, theme, or specific flower/product here. Write an ordinary, general "come see us today" update. visual_brief must show a general, appealing shop/floral scene — a mixed seasonal arrangement, real current inventory broadly — NEVER a photo specifically of whatever flower or plant word "${name}" happens to contain, unless the shop's real inventory or a genuinely separate topic actually calls for it.`;
}

/**
 * Real, live-found root cause behind the redirect above still losing to
 * the model in practice: Ashley's "Make today's Facebook post for lilies
 * in bloom" (shop: "Lilies in Bloom") kept coming back entirely about the
 * lily flower — "Our lily collection is looking stunning, with gorgeous
 * Asiatic and Oriental varieties" — DESPITE shopIdentityRule's explicit
 * correction bullet already being in the prompt. The comment above this
 * function already correctly diagnosed the mechanism (the literal
 * occasion text restated, unfiltered, as "Occasion/theme: <text>" right
 * at the TOP of the prompt anchors the model before it ever reaches a
 * correction bullet several lines further down) but the occasion line
 * itself was never actually changed to stop doing that — only the later
 * bullet was added. This is what actually closes it: when the request is
 * genuinely nothing but the shop's own name, the occasion line itself
 * never restates it as a theme at all, so there is no earlier anchor for
 * the correction bullet to have to fight.
 */
function occasionLine(occasion, shopName) {
  if (!occasion) return "";
  if (requestIsJustShopName(occasion, shopName)) {
    return "Occasion/theme: none — this request is nothing more than the shop's own name restated, with no real topic of its own (see the rule below for what to write instead).";
  }
  return `Occasion/theme: ${occasion}.`;
}

/**
 * Real gap an independent review found in occasionLine just above: that
 * fix only edited the TASK text. The literal, unfiltered request text
 * still reached the model a SECOND time, verbatim, via the structured
 * Input JSON block runCloudflareGenerate always appends right before
 * "Return ONLY valid JSON" (see cloudflareAi() in ai-assistant.js) — if
 * anything a STRONGER anchor than the one occasionLine removes, since
 * it's the very last real text the model reads before it starts
 * generating. Every input:{request:...}/{message:...} site below must
 * route the literal text through this, so there is exactly ONE place
 * that can ever suppress it — never two independently-maintained copies
 * of the same decision that can silently drift apart again.
 */
export function sanitizedRequestForModel(requestText, shopName) {
  if (requestIsJustShopName(requestText, shopName)) {
    return "(No real topic — this request is nothing more than the shop's own name restated as today's post. Follow the task instructions above: write a general, ordinary shop update, never fixated on any flower/plant word from the shop's own name.)";
  }
  return requestText;
}

function buildSocialPostTask({ channel, occasion, audience, shop, brandVoiceSummary, visualStyleSummary, inventorySummary, audienceSummary }) {
  return `You are writing the ACTUAL, FINISHED social media post Florisyn will show a florist to publish today. Do not describe the request. Do not summarize what was asked. Do not restate the user's instruction. Write real, publish-ready copy a customer would read right now.

Platform: ${channel || "facebook"}.
${occasionLine(occasion, shop?.name)}
${audience ? `Audience: ${audience}.` : ""}
${brandVoiceSummary ? `This shop's own learned brand voice (from what they've explicitly told Lily and repeatedly approved) — follow it as the DEFAULT whenever the request above doesn't say otherwise; the request's own explicit instructions always win if they conflict: ${brandVoiceSummary}.` : ""}
${visualStyleSummary ? `This shop's own learned VISUAL creative style (backgrounds/lighting/colors/mood/etc., separate from the writing voice above) — use it to fill in what visual_brief doesn't otherwise specify; the request's own explicit visual direction always wins if it conflicts, and a one-time visual request never overrides this standing style: ${visualStyleSummary}.` : ""}
${inventorySummary ? `${inventorySummary} Only mention specific flowers/stems by name if the request above is actually about what's in stock, what to sell, or what to feature — do not force an inventory mention into a post that isn't about that. When you do reference stock, name only items from this list; never name a flower, color, or variety that isn't on it.` : ""}
${audienceSummary ? audienceSummary : ""}

Rules:
- Never restate or describe the request itself — the output must be usable as-is, with no editing.
- Use the shop's real name/products from the input where given; never invent products, prices, or promises Florisyn can't confirm.
${shopIdentityRule(shop?.name, occasion)}
- Match the platform's real voice: warm and conversational for Facebook/Instagram, concise everywhere.
- visual_brief must describe a concrete photo concept (say what's actually in the shot — never a vague placeholder like "a beautiful arrangement").
- brand_traits_used / visual_traits_used: only the traits from the summaries above that you actually wove into this post — [] if none were used. Never list a trait you didn't actually use.
- Never state an audience size, subscriber count, or customer-segment number that isn't in the real audience data above (if any was given) — no rounding up, no guessing "hundreds of loyal customers".
- If the request describes a TEMPORARY or one-time schedule change (closing early, closed today, closing at a specific time today, temporarily closed, closed for the holiday, a delivery cutoff, changed hours) never write it as if the business itself is shutting down — no farewell/sadness/gratitude/"last day"/"after X years" language. Say plainly that it's temporary and the shop is open as normal otherwise. Only write permanent-closure language if the request explicitly says the closure is permanent (e.g. "going out of business," "closing for good," "our last day").
- Any exact fact the request gives verbatim — a time, phone number, price, date, or link — must appear in your output EXACTLY as given, never paraphrased or rounded.
- If this is a plain operational/informational post (a schedule change, early closing, holiday hours, delivery cutoff, reopening — not a celebratory or memorial occasion), visual_brief must describe a plain, professional, on-brand shop or floral visual — never an emotional, farewell, or sympathy-style image.
- LENGTH: three or four short sentences for the body, then stop. A wall of text is not a social post. Say one thing well.
- Write something only THIS florist could say. Never use stock business filler: "we understand the importance of", "whether you're looking for", "we've got you covered", "our experienced florists", "from classic X to custom Y", "high-quality", "a wide range of", "contact us today to discuss your needs", "every step of the way". If a sentence would suit a plumber with the nouns swapped, cut it.
- A FLORIST SUPPLIES THE FLOWERS. The shop is not a funeral home, a venue, a caterer or an events company, and must never be written as though it holds the service itself. Never "funeral services available", "memorial services", "we host", "we officiate". Say "funeral flowers", "sympathy flowers", "flowers for the service", "standing sprays and casket flowers". "Funeral arrangements" alone reads as undertaking rather than flowers — name the flowers.
- SYMPATHY OPENINGS ARE NOT PRODUCT LABELS. On funeral, sympathy or memorial work never open with the category or with availability — not "We have funeral flowers", not "Funeral flowers available", not "We offer a variety of sympathy arrangements". A family two days after a death is not shopping a category, and a supply notice reads as cold at the worst possible moment. Open with the person: what you will do for them, or what you have seen families ask for. Name the actual flowers after that, not before.
- SYMPATHY AND FUNERAL WORK is the most delicate writing a florist does. Never frame a death as a celebration, a milestone, an occasion, or anything upbeat — no "celebrating life's milestones", no exclamation marks, no enthusiasm. Write plainly, gently and briefly, as one person to another who has just lost someone. Say what the shop will actually do for them. ("Celebration of life" is a real name for a memorial service and is fine when the request uses it.) Never pressure: no "book now", no urgency, no scarcity.
- visual_brief must NEVER ask for legible on-image text of any kind — no words, letters, numbers, signage, or lettering of any sort, whether a phone number, time, price, URL, headline, or any other wording. The image model can't render text reliably; any post whose important information needs to actually be READ on the graphic itself is handled by Florisyn's own deterministic flyer renderer, never this image model — visual_brief only ever describes a purely visual scene.`;
}

const SOCIAL_POST_SCHEMA = {
  platform: "string",
  headline: "string — a short hook/opening line",
  body: "string — the complete finished post text, ready to publish as-is",
  cta: "string — the exact call-to-action line",
  visual_brief: "string — a concrete visual concept for a matching image",
  hashtags: ["string"],
  asset_requirements: ["string"],
  brand_traits_used: [{ category: "string", text: "string" }],
  visual_traits_used: [{ category: "string", text: "string" }]
};

function normalizeTraitsUsed(raw) {
  return Array.isArray(raw)
    ? raw
        .filter((t) => t?.category && t?.text)
        .slice(0, 20)
        .map((t) => ({ category: String(t.category), text: String(t.text).slice(0, 160) }))
    : [];
}

/**
 * Real, live-found failure: the model self-reports brand_traits_used/
 * visual_traits_used as "what I actually used from your learned style" —
 * but that self-report was never checked against the summary text it was
 * actually given, so a fresh shop with no learned style yet (empty
 * summary) could still get back invented "traits" (a phrase from its own
 * generated caption or visual_brief, misrepresented as learned style).
 * Those traits are read straight back into real Brand Brain / My Style
 * storage on the next Approve (see marketing-studio.js's approve_content),
 * and shown to the florist as "your learned style" (marketing-studio-shop-
 * ui.js's groundingHtml) — so an ungrounded trait is never just cosmetic,
 * it's a real contamination path. A trait only survives here if its own
 * text literally appears in the summary that was actually fed to the
 * model for this call; an empty/missing summary means nothing could have
 * legitimately been "used" from it, so every trait is dropped.
 */
function traitsGroundedInSummary(traits, summaryText) {
  const summary = String(summaryText || "").toLowerCase().trim();
  if (!summary) return [];
  return traits.filter((t) => {
    const text = String(t.text || "").toLowerCase().trim();
    return text.length > 0 && summary.includes(text);
  });
}

/** Generates one finished, platform-formatted social post. Never throws —
 * returns { ok:false, error } on any failure so a caller can persist that
 * outcome and keep the rest of a multi-step job running. */
export async function generateSocialPost({ persona = "Lily", channel, occasion, audience, shop, requestText, brandVoiceSummary, visualStyleSummary, inventorySummary, audienceSummary } = {}) {
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona,
      task: buildSocialPostTask({ channel, occasion, audience, shop, brandVoiceSummary, visualStyleSummary, inventorySummary, audienceSummary }),
      input: { request: sanitizedRequestForModel(requestText, shop?.name), shop: shop || {} },
      schema: SOCIAL_POST_SCHEMA,
      max_tokens: 700
    });
    const post = result?.result;
    if (!post || !post.body) return { ok: false, error: "The AI didn't return usable post copy. Try again." };
    return {
      ok: true,
      content: {
        platform: String(post.platform || channel || "facebook"),
        headline: String(post.headline || "").slice(0, 200),
        body: String(post.body || "").slice(0, 3000),
        cta: String(post.cta || "").slice(0, 200),
        visual_brief: String(post.visual_brief || "").slice(0, 600),
        hashtags: Array.isArray(post.hashtags) ? post.hashtags.slice(0, 15).map(String) : [],
        asset_requirements: Array.isArray(post.asset_requirements) ? post.asset_requirements.slice(0, 10).map(String) : [],
        // Anti-fabrication (same contract as ai-intent-router.js's
        // buildVisualBrief traits_used): only what the model itself
        // reports actually using, AND only when that trait's own text is
        // actually present in the summary this call was given — the
        // model's self-report alone is never trusted (see
        // traitsGroundedInSummary's docstring for the real failure this
        // closes: invented "learned style" reaching Brand Brain/My Style).
        brand_traits_used: traitsGroundedInSummary(normalizeTraitsUsed(post.brand_traits_used), brandVoiceSummary),
        visual_traits_used: traitsGroundedInSummary(normalizeTraitsUsed(post.visual_traits_used), visualStyleSummary)
      },
      model: result.model
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

function buildVideoConceptTask({ occasion, audience, channel, shop, brandVoiceSummary, visualStyleSummary, inventorySummary, audienceSummary }) {
  return `Plan a short-form marketing video (Reel/TikTok-style) for a flower shop. You are NOT rendering video — final AI video rendering is not connected yet. You ARE producing the complete creative plan: script, shot-by-shot storyboard, on-screen captions. Write the actual finished plan, not a description of what a video could contain.

Channel: ${channel || "instagram/facebook reels"}.
${occasionLine(occasion, shop?.name)}
${audience ? `Audience: ${audience}.` : ""}
${brandVoiceSummary ? `This shop's own learned brand voice (from what they've explicitly told Lily and repeatedly approved) — follow it as the DEFAULT whenever the request above doesn't say otherwise; the request's own explicit instructions always win if they conflict: ${brandVoiceSummary}.` : ""}
${visualStyleSummary ? `This shop's own learned VISUAL creative style (backgrounds/lighting/colors/mood/etc., separate from the writing voice above) — use it to fill in what the shot descriptions don't otherwise specify; the request's own explicit visual direction always wins if it conflicts, and a one-time visual request never overrides this standing style: ${visualStyleSummary}.` : ""}
${inventorySummary ? `${inventorySummary} Only show/name specific flowers/stems if the request above is actually about what's in stock, what to sell, or what to feature — do not force an inventory mention into a video that isn't about that. When you do reference stock, name only items from this list; never name a flower, color, or variety that isn't on it.` : ""}
${audienceSummary ? audienceSummary : ""}

Rules:
${shopIdentityRule(shop?.name, occasion)}
- scenes: each entry is one concrete shot as a single string formatted "0-3s: shot description — on-screen text: ...". Be specific about what's shown, never generic.
- captions: the literal on-screen caption lines, not a description of captions.
- Keep it realistic for one florist with a phone camera — no crew, no equipment they don't have.
- brand_traits_used / visual_traits_used: only the traits from the summaries above that you actually wove into this plan — [] if none were used. Never list a trait you didn't actually use.
- Never state an audience size, subscriber count, or customer-segment number that isn't in the real audience data above (if any was given) — no rounding up, no guessing.`;
}

const VIDEO_CONCEPT_SCHEMA = {
  concept: "string — one sentence pitch",
  script: "string — spoken/voiceover script, or empty string if silent/text-only",
  scenes: ["string"],
  captions: ["string"],
  hashtags: ["string"],
  suggested_length_seconds: "number",
  brand_traits_used: [{ category: "string", text: "string" }],
  visual_traits_used: [{ category: "string", text: "string" }]
};

/** Generates a full video concept/script/storyboard — never a finished
 * video. Result always carries renderingAvailable:false so nothing
 * downstream can mistake a concept for a rendered asset. */
export async function generateVideoConcept({ persona = "Lily", channel, occasion, audience, shop, requestText, brandVoiceSummary, visualStyleSummary, inventorySummary, audienceSummary } = {}) {
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona,
      task: buildVideoConceptTask({ occasion, audience, channel, shop, brandVoiceSummary, visualStyleSummary, inventorySummary, audienceSummary }),
      input: { request: sanitizedRequestForModel(requestText, shop?.name), shop: shop || {} },
      schema: VIDEO_CONCEPT_SCHEMA,
      max_tokens: 900
    });
    const plan = result?.result;
    if (!plan || !(Array.isArray(plan.scenes) && plan.scenes.length)) {
      return { ok: false, error: "The AI didn't return a usable video plan. Try again." };
    }
    return {
      ok: true,
      content: {
        concept: String(plan.concept || "").slice(0, 400),
        script: String(plan.script || "").slice(0, 3000),
        scenes: plan.scenes.slice(0, 20).map((s) => String(s).slice(0, 300)),
        captions: Array.isArray(plan.captions) ? plan.captions.slice(0, 20).map((c) => String(c).slice(0, 200)) : [],
        hashtags: Array.isArray(plan.hashtags) ? plan.hashtags.slice(0, 15).map(String) : [],
        suggested_length_seconds: Number(plan.suggested_length_seconds) || null,
        renderingAvailable: false,
        renderingNote: "Final AI video rendering is not connected yet — this is the finished script, storyboard, and captions, ready for a video provider once one is chosen.",
        brand_traits_used: normalizeTraitsUsed(plan.brand_traits_used),
        visual_traits_used: normalizeTraitsUsed(plan.visual_traits_used)
      },
      model: result.model
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

/** Turns a website-promotional draft into a real content bundle a Website
 * Builder X section could be populated from — headline/subhead/CTA/image
 * brief, not a bare navigate. Wave 2 (Website Builder X integration) is
 * what actually writes this into a live page section; this produces the
 * ready-to-apply content today. */
export async function generateWebsiteSectionDraft({ persona = "Lily", occasion, audience, shop, requestText } = {}) {
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona,
      task: `Write the actual, finished copy for a promotional website section (a homepage banner or campaign landing block) — not a description of the section, the real headline/subheadline/CTA text a visitor would read.
${occasionLine(occasion, shop?.name)}
${audience ? `Audience: ${audience}.` : ""}
${shopIdentityRule(shop?.name, occasion)}
Never invent products, prices, or promises Florisyn can't confirm.`,
      input: { request: sanitizedRequestForModel(requestText, shop?.name), shop: shop || {} },
      schema: {
        headline: "string",
        subheadline: "string",
        body: "string",
        cta_label: "string",
        visual_brief: "string"
      },
      max_tokens: 500
    });
    const section = result?.result;
    if (!section || !section.headline) return { ok: false, error: "The AI didn't return usable website copy. Try again." };
    return {
      ok: true,
      content: {
        headline: String(section.headline || "").slice(0, 200),
        subheadline: String(section.subheadline || "").slice(0, 300),
        body: String(section.body || "").slice(0, 1200),
        cta_label: String(section.cta_label || "").slice(0, 100),
        visual_brief: String(section.visual_brief || "").slice(0, 600),
        appliedToLivePage: false
      },
      model: result.model
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

function buildFlyerContentTask({ occasion, visualStyleSignal, shop }) {
  return `You are writing the ACTUAL, FINISHED text content for a flyer/graphic a florist will show customers today — not a description of the flyer. Write real, ready-to-display content.

${occasionLine(occasion, shop?.name)}
${visualStyleSignal ? "This request carries real aesthetic direction — a mood/material/color/theme." : "This request is plain and operational (a notice, a closing time, a phone number) — keep the content minimal and direct, no invented flourish."}

Rules:
${shopIdentityRule(shop?.name, occasion)}
- ANY concrete fact the florist gave you verbatim — a time, a phone number, a price, a date, a percentage — must appear in your output EXACTLY as given. Never paraphrase, round, or reformat a number or time. This is the single most important rule here.
- headline: short, bold, the first thing read.
- body: the supporting line(s) — can be empty string if the headline says everything.
- cta: the one action line (a phone number to call, "Order online," "Stop by today," etc).
- Never invent a price, discount, date, or promise Florisyn can't confirm — if the florist didn't give you a fact, don't make one up.
- Preserve the florist's own meaning exactly — never add a reason, an urgency phrase, a future plan, or a farewell/gratitude line they didn't write. A plain operational notice (a temporary closing, a schedule change, a phone number to call) stays plain: no "final orders," no "prepare for," no "we look forward to serving you again," no invented event or sentiment of any kind. If the florist only said the shop is closing early and gave a number to call, that is the ENTIRE message — say only that, just more concisely if needed, never more.
- A FLORIST SUPPLIES THE FLOWERS. The shop is not a funeral home, a venue, a caterer or an events company, and must never be written as though it holds the service itself. Never "funeral services available", "memorial services", "we host", "we officiate". Say "funeral flowers", "sympathy flowers", "flowers for the service", "standing sprays and casket flowers". "Funeral arrangements" alone reads as undertaking rather than flowers — name the flowers.
- SYMPATHY HEADLINES ARE NOT PRODUCT LABELS. On funeral, sympathy or memorial work the headline must be addressed to the person reading it, never to the market. Never "Funeral Flowers", "Sympathy Flowers Available", "Funeral Arrangements", "Now Available", "We Offer", "Order Now" — a family two days after a death is not shopping a category, and a supply notice reads as cold at the worst possible moment. Lead with what a sympathy CARD says — "With Sympathy", "In Loving Memory", "Thinking of You", "With Deepest Sympathy", "For the Family", "When Words Aren't Enough" — or with what the shop will actually do for them. Then name the flowers in the message underneath, where they belong. This is the difference between a flyer a grieving family responds to and one they scroll past.
- If the request describes a TEMPORARY or one-time schedule change (closing early, closed today, closing at a specific time today, temporarily closed, closed for the holiday, a delivery cutoff) never write it as if the business itself is shutting down — no farewell/sadness/gratitude/"last day" language, and never imply a future event or reopening that wasn't mentioned. Only write permanent-closure language if the request explicitly says the closure is permanent.`;
}

const FLYER_CONTENT_SCHEMA = {
  headline: "string",
  body: "string",
  cta: "string"
};

/** Generates the finished text content for a flyer/graphic — never the
 * pixels. The client-side renderer (public/flyer-renderer.js) turns this,
 * plus the shop's brand and either a generated background or this
 * template's own palette, into the actual image. Keeping content and
 * rendering separate is what makes a revision like "make the phone number
 * bigger" free — it re-renders the same content, no new AI call. */
export async function generateFlyerContent({ persona = "Lily", message, occasion, visualStyleSignal, shop } = {}) {
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona,
      task: buildFlyerContentTask({ occasion, visualStyleSignal, shop }),
      input: { request: sanitizedRequestForModel(message, shop?.name), shop: shop || {} },
      schema: FLYER_CONTENT_SCHEMA,
      max_tokens: 400
    });
    const content = result?.result;
    if (!content || !content.headline) return { ok: false, error: "The AI didn't return usable flyer content. Try again." };
    return {
      ok: true,
      content: {
        headline: String(content.headline || "").slice(0, 140),
        body: String(content.body || "").slice(0, 400),
        cta: String(content.cta || "").slice(0, 140)
      },
      model: result.model
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

/** Persists one generated asset (success or failure) so results are
 * reusable across sessions and a failed step can be retried without
 * losing the successful ones around it. */
export async function persistGeneratedAsset(client, {
  shopId,
  userId,
  persona = "Lily",
  jobId = null,
  campaignId = null,
  assetType,
  provider = "cloudflare",
  model,
  prompt = null,
  content = null,
  mediaId = null,
  parentAssetId = null,
  // 'reframe'|'transcode'|'caption_burn'|'thumbnail'|'trim'|null — the
  // ai_generated_assets.transformation_type column added in the Aug-24
  // media migration. Only ever set alongside parentAssetId (the DB's own
  // ai_generated_assets_master_derived_consistency check enforces this);
  // media-transform-executor.js is the first real caller.
  transformationType = null,
  status = "completed",
  error = null
}) {
  const { data, error: dbError } = await client
    .from("ai_generated_assets")
    .insert({
      shop_id: shopId,
      created_by: userId,
      persona,
      job_id: jobId,
      campaign_id: campaignId,
      asset_type: assetType,
      provider,
      model: model || "unknown",
      prompt,
      content,
      media_id: mediaId,
      parent_asset_id: parentAssetId,
      transformation_type: transformationType,
      status,
      error
    })
    .select()
    .single();
  if (dbError) return { ok: false, error: dbError.message };
  return { ok: true, asset: data };
}
