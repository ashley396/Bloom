/**
 * Personal Brand Studio — structured creation modes (Section 7 of the
 * directive). Modes, not rigid Canva-style templates: each one is prompt
 * guidance + platform defaults that a founder-concept generation blends
 * with the florist's own profile/learned traits/request — never a fixed
 * layout.
 */

export const PERSONAL_BRAND_MODES = Object.freeze({
  founder_portrait: {
    label: "Founder Portrait",
    description: "Professional owner/founder images.",
    promptGuidance:
      "A professional portrait of the founder — polished but warm, not corporate-stock. Show real ownership and pride in the business.",
    defaultBalance: "professional",
    suggestedPlatforms: ["linkedin", "facebook", "instagram"]
  },
  behind_the_counter: {
    label: "Behind the Counter",
    description: "The florist working inside their shop.",
    promptGuidance:
      "The florist actively working inside their own shop — mid-task, real environment, real tools and product around them, not posed like a stock photo.",
    defaultBalance: "balanced",
    suggestedPlatforms: ["instagram", "facebook", "tiktok"]
  },
  floral_designer: {
    label: "Floral Designer",
    description: "The owner designing or holding an arrangement.",
    promptGuidance:
      "The florist actively designing or presenting a real arrangement — hands-on, craft-forward, the flowers are the co-star of the shot.",
    defaultBalance: "balanced",
    suggestedPlatforms: ["instagram", "pinterest", "facebook"]
  },
  founder_story: {
    label: "Founder Story",
    description: "Images and content explaining why they started their business.",
    promptGuidance:
      "A personal, narrative piece about why this florist started their business — draw directly on their own stated founder story; never invent a backstory they haven't given.",
    defaultBalance: "balanced",
    // "website" (the founder-story About-page/homepage-block destination)
    // is deliberately NOT listed here — it isn't a social publish platform
    // (SUPPORTED_PLATFORMS/PLATFORM_TO_DESTINATIONS), so it's handled as
    // its own explicit request_website_founder_content flag rather than
    // flowing through the social platform-variant planner.
    suggestedPlatforms: ["facebook", "instagram", "linkedin"]
  },
  professional: {
    label: "Professional",
    description: "LinkedIn, website About page, media, business profiles.",
    promptGuidance:
      "Polished, credible, business-appropriate — suitable for a LinkedIn profile, a website About page, or press/media use.",
    defaultBalance: "professional",
    // See the founder_story mode's comment above — "website" is handled
    // as its own explicit flag, not a social platform-variant target.
    suggestedPlatforms: ["linkedin"]
  },
  casual: {
    label: "Casual",
    description: "Relatable social content.",
    promptGuidance: "Relaxed, relatable, everyday-life social content — approachable over polished.",
    defaultBalance: "casual",
    suggestedPlatforms: ["instagram", "tiktok", "facebook"]
  },
  humorous_personality: {
    label: "Humorous / Personality",
    description: "Posts based on the florist's personality and business life.",
    promptGuidance:
      "Genuinely funny and personality-driven, grounded in this specific florist's own stated personality traits and real business life — never a generic joke that could belong to anyone.",
    defaultBalance: "casual",
    suggestedPlatforms: ["instagram", "tiktok", "facebook"]
  },
  seasonal: {
    label: "Seasonal",
    description: "Valentine's, Mother's Day, wedding season, prom, Christmas, etc.",
    promptGuidance: "Tied to a real seasonal occasion — the founder framed naturally within that season's real context, not a generic template.",
    defaultBalance: "balanced",
    suggestedPlatforms: ["instagram", "facebook", "pinterest"]
  },
  educational: {
    label: "Educational",
    description: "The owner teaching customers about flowers/design.",
    promptGuidance: "The florist genuinely teaching or explaining something real about flowers/design — expertise-forward, not a sales pitch.",
    defaultBalance: "balanced",
    suggestedPlatforms: ["instagram", "tiktok", "youtube"]
  },
  product_shop_promotion: {
    label: "Product/Shop Promotion",
    description: "The owner naturally incorporated with real shop products.",
    promptGuidance: "The florist naturally present alongside real shop products — promotional but personal, never a disconnected stock-style product shot.",
    defaultBalance: "balanced",
    suggestedPlatforms: ["instagram", "facebook", "google_business"]
  }
});

export const PERSONAL_BRAND_MODE_KEYS = Object.freeze(Object.keys(PERSONAL_BRAND_MODES));

export function getPersonalBrandMode(key) {
  const mode = PERSONAL_BRAND_MODES[key];
  if (!mode) throw new Error(`getPersonalBrandMode: unknown mode "${key}". Valid modes: ${PERSONAL_BRAND_MODE_KEYS.join(", ")}.`);
  return mode;
}
