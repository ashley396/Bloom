import { json, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "GET") return methodNotAllowed();
  try {
    const { client } = await currentUser(event);
    const { data, error } = await client
      .from("platform_settings")
      .select("value")
      .eq("key", "rose_foundation")
      .maybeSingle();
    if (error) {
      return json(200, { roseFoundationTotal: 0 });
    }
    return json(200, { roseFoundationTotal: Number(data?.value?.total || 0) });
  } catch (error) {
    if (error.statusCode === 401) return fail(error);
    return json(200, { roseFoundationTotal: 0 });
  }
}
