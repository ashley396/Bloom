import { createApiClient } from "../apiClient";

describe("apiClient", () => {
  test("retries once on 503 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) {
        return { ok: false, status: 503, json: async () => ({ error: "busy" }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    };
    const api = createApiClient({ baseUrl: "https://example.com", getToken: () => null, fetchImpl });
    const out = await api.request("health");
    expect(out).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});
