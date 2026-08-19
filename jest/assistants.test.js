import { getAssistant, resolveAssistantNavigation, ASSISTANT_LIST } from "../lib/assistants/registry.js";

describe("assistants registry", () => {
  test("lists Lily, Rose, Daisy, and Bud", () => {
    const ids = ASSISTANT_LIST.map((a) => a.id);
    expect(ids).toEqual(["lily", "rose", "daisy", "bud"]);
  });

  test("Lily routes to AI Studio and opens panel", () => {
    const nav = resolveAssistantNavigation("lily");
    expect(nav.page).toBe("aiStudioPage");
    expect(nav.openLily).toBe(true);
  });

  test("Rose routes to reports", () => {
    expect(resolveAssistantNavigation("rose").page).toBe("reportsPage");
  });

  test("Daisy routes to dashboard with gentle feedback", () => {
    const nav = resolveAssistantNavigation("daisy");
    expect(nav.page).toBe("dashboardPage");
    expect(nav.gentleWag).toBe(true);
  });

  test("unknown assistant returns safe default", () => {
    expect(getAssistant("unknown")).toBeNull();
    expect(resolveAssistantNavigation("unknown").page).toBe("dashboardPage");
  });
});
