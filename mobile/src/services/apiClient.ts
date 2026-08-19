type ApiConfig = {
  baseUrl: string;
  getToken: () => string | null;
  fetchImpl?: typeof fetch;
};

/**
 * Fault-tolerant API client for React Native — mirrors web POS resilience.
 * Retries transient 5xx/ network errors; never retries 401/403.
 */
export function createApiClient({ baseUrl, getToken, fetchImpl = fetch }: ApiConfig) {
  async function request(path: string, init: RequestInit = {}, attempt = 0): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetchImpl(`${baseUrl}/.netlify/functions/${path}`, { ...init, headers });
    let body: { error?: string; code?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* non-JSON */
    }

    if (!res.ok) {
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
        return request(path, init, attempt + 1);
      }
      const err = new Error(body.error || `Request failed (${res.status})`);
      (err as Error & { code?: string }).code = body.code;
      throw err;
    }
    return body;
  }

  return { request };
}
