import { createApiClient } from "./apiClient";

/**
 * Shared assistant definitions — keep in sync with lib/assistants/registry.js
 */
export const ASSISTANTS = {
  lily: { id: "lily", name: "Lily", page: "LilyAIStudio", portrait: "/assets/assistants/lily-portrait.png" },
  rose: { id: "rose", name: "Rose", page: "Reports", portrait: "/assets/assistants/rose-portrait.png" },
  daisy: { id: "daisy", name: "Daisy", page: "Dashboard", portrait: "/assets/assistants/daisy-portrait.png" },
} as const;

export type AssistantId = keyof typeof ASSISTANTS;

export function createFlorisynServices(config: { baseUrl: string; getToken: () => string | null }) {
  const api = createApiClient(config);
  return {
    api,
    assistants: ASSISTANTS,
    navigateToAssistant(id: AssistantId) {
      return ASSISTANTS[id]?.page ?? "Dashboard";
    },
  };
}
