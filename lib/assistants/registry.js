/**
 * Lily, Rose, Daisy, and Bud — canonical assistant definitions shared by
 * web (PWA), React Native mobile, and Netlify AI endpoints.
 */

export const ASSISTANTS = Object.freeze({
  lily: Object.freeze({
    id: "lily",
    name: "Lily",
    role: "Creative Assistant",
    portrait: "/assets/assistants/lily-portrait.png",
    defaultPage: "aiStudioPage",
    capabilities: ["copywriting", "seo", "website", "product-descriptions", "chat"],
    aiEndpoint: "lily-ai",
  }),
  rose: Object.freeze({
    id: "rose",
    name: "Rose",
    role: "Business Advisor",
    portrait: "/assets/assistants/rose-portrait.png",
    defaultPage: "reportsPage",
    capabilities: ["reports", "profit", "briefings", "foundation"],
    aiEndpoint: "lily-ai",
  }),
  daisy: Object.freeze({
    id: "daisy",
    name: "Daisy",
    role: "Shop Mascot",
    portrait: "/assets/assistants/daisy-portrait.png",
    defaultPage: "dashboardPage",
    capabilities: ["tips", "onboarding", "gentle-feedback"],
    aiEndpoint: null,
  }),
  bud: Object.freeze({
    id: "bud",
    name: "Bud",
    role: "Problem Solver",
    portrait: "/assets/assistants/bud-portrait.webp",
    defaultPage: "aiStudioPage",
    capabilities: ["troubleshooting", "bug-reports", "support-tickets", "chat"],
    aiEndpoint: "lily-ai",
  }),
});

export const ASSISTANT_LIST = Object.freeze([ASSISTANTS.lily, ASSISTANTS.rose, ASSISTANTS.daisy, ASSISTANTS.bud]);

/** Resolve assistant by id or data-assistant attribute value. */
export function getAssistant(id) {
  const key = String(id || "").toLowerCase();
  return ASSISTANTS[key] || null;
}

/** Where navigation should land when the user taps an assistant chip. */
export function resolveAssistantNavigation(assistantId, options = {}) {
  const a = getAssistant(assistantId);
  if (!a) return { page: "dashboardPage", openLily: false };
  if (a.id === "lily") {
    return {
      page: a.defaultPage,
      openLily: options.preferPanel !== false,
    };
  }
  if (a.id === "daisy") {
    return { page: a.defaultPage, gentleWag: true, tip: options.tip || "Daisy is here — tap Lily or Rose for AI help." };
  }
  return { page: a.defaultPage, openLily: false };
}
