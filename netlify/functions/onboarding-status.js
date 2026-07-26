import { authenticatedUser, fail, json } from "./_shared/saas.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  try {
    const { client, user } = await authenticatedUser(event);
    const { data: profile } = await client
      .from("profiles")
      .select("full_name, default_shop_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.default_shop_id) {
      return json(200, { needsOnboarding: true, user: { email: user.email, fullName: profile?.full_name || user.user_metadata?.full_name || "" } });
    }

    const [{ data: shop, error: shopError }, { data: subscription }] = await Promise.all([
      client.from("shops").select("*").eq("id", profile.default_shop_id).single(),
      client.from("shop_subscriptions").select("*").eq("shop_id", profile.default_shop_id).maybeSingle()
    ]);
    if (shopError) throw shopError;

    return json(200, {
      needsOnboarding: !shop.onboarding_complete,
      user: { email: user.email, fullName: profile.full_name || user.user_metadata?.full_name || "" },
      shop,
      subscription
    });
  } catch (error) {
    return fail(error);
  }
}
