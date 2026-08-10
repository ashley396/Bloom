import { createFlorisynServices } from "../florisynServices";

describe("website services", () => {
  const fetchImpl = jest.fn(async () => ({
    ok: true,
    json: async () => ({ project: { status: "draft" }, steps: [] }),
  })) as unknown as typeof fetch;

  beforeEach(() => fetchImpl.mockClear?.());

  it("calls get_project on instant-website", async () => {
    const svc = createFlorisynServices({ baseUrl: "https://example.com", getToken: () => "tok" });
    await svc.website.getProject();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/.netlify/functions/instant-website",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("calls publish_checklist action", async () => {
    const svc = createFlorisynServices({ baseUrl: "https://example.com", getToken: () => null });
    await svc.website.publishChecklist({ project: {}, pages: [] });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe("publish_checklist");
  });
});
