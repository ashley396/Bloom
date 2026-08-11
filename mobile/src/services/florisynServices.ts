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
    website: {
      async getProject() {
        return api.request("instant-website", {
          method: "POST",
          body: JSON.stringify({ action: "get_project" }),
        });
      },
      async publishChecklist(payload: { project?: unknown; pages?: unknown[] }) {
        return api.request("instant-website", {
          method: "POST",
          body: JSON.stringify({ action: "publish_checklist", ...payload }),
        });
      },
      async lilyInterviewSteps() {
        return api.request("instant-website", {
          method: "POST",
          body: JSON.stringify({ action: "lily_interview_steps" }),
        });
      },
      async connectDomain(domain: string) {
        return api.request("instant-website", {
          method: "POST",
          body: JSON.stringify({ action: "connect_domain", domain }),
        });
      },
      async verifyDomain(domain: string) {
        return api.request("instant-website", {
          method: "POST",
          body: JSON.stringify({ action: "verify_domain", domain }),
        });
      },
      async updateSeo(seo: { seo_title?: string; meta_description?: string }) {
        return api.request("instant-website", {
          method: "POST",
          body: JSON.stringify({ action: "update_seo", ...seo }),
        });
      },
    },
  };
}
