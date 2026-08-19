import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, publicSettings } from "./_shared/supabase.js";
import {
  generateReferralCode,
  normalizeReferralCode,
  referralShareMessage,
  REFERRAL_REWARD,
  CASE_STUDIES
} from "../../lib/growth/referral-program.js";

function missingTable(error) {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || msg.includes("does not exist");
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const action =
      event.httpMethod === "GET"
        ? event.queryStringParameters?.action || "case-studies"
        : bodyOf(event).action;

    if (action === "case-studies") {
      return json(200, { studies: CASE_STUDIES, reward: REFERRAL_REWARD });
    }

    if (action === "validate") {
      const code = normalizeReferralCode(
        event.queryStringParameters?.code || bodyOf(event).code
      );
      if (!code) return json(400, { error: "Referral code required." });
      const { url, anonKey } = publicSettings();
      const { createClient } = await import("@supabase/supabase-js");
      const pub = createClient(url, anonKey);
      const { data, error } = await pub
        .from("shop_referral_codes")
        .select("code, shop_id")
        .eq("code", code)
        .maybeSingle();
      if (error && !missingTable(error)) throw error;
      if (!data) return json(404, { error: "Referral code not found." });
      return json(200, { valid: true, code: data.code, reward: REFERRAL_REWARD });
    }

    const { client, shopId } = await currentUser(event);
    const body = bodyOf(event);

    if (action === "load") {
      const [{ data: shop }, { data: codeRow }] = await Promise.all([
        client.from("shops").select("name").eq("id", shopId).single(),
        client.from("shop_referral_codes").select("*").eq("shop_id", shopId).maybeSingle()
      ]);
      const site = process.env.SITE_URL || process.env.URL || "https://www.florisyn.com";
      let code = codeRow?.code;
      if (!code) {
        code = generateReferralCode(shop?.name);
        await client.from("shop_referral_codes").upsert({
          shop_id: shopId,
          code,
          updated_at: new Date().toISOString()
        });
      }
      return json(200, {
        reward: REFERRAL_REWARD,
        stats: codeRow || { referred_count: 0, rewards_earned_months: 0 },
        share: referralShareMessage(code, site)
      });
    }

    if (action === "regenerate") {
      const { data: shop } = await client.from("shops").select("name").eq("id", shopId).single();
      const code = generateReferralCode(shop?.name);
      const { data, error } = await client
        .from("shop_referral_codes")
        .upsert({ shop_id: shopId, code, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      const site = process.env.SITE_URL || process.env.URL || "https://www.florisyn.com";
      return json(200, { code: data.code, share: referralShareMessage(data.code, site) });
    }

    if (action === "attribute") {
      const code = normalizeReferralCode(body.code);
      if (!code) return json(400, { error: "Referral code required." });
      const { data: ref } = await client.from("shop_referral_codes").select("shop_id, code").eq("code", code).maybeSingle();
      if (!ref || ref.shop_id === shopId) return json(400, { error: "Invalid referral code." });
      const { error } = await client.from("shop_referral_attributions").upsert({
        referral_code: code,
        referrer_shop_id: ref.shop_id,
        referred_shop_id: shopId,
        status: "trial"
      });
      if (error) throw error;
      return json(200, { ok: true, referrer_shop_id: ref.shop_id });
    }

    return json(400, { error: "Unknown referral action." });
  } catch (error) {
    if (missingTable(error)) {
      return json(503, { error: "Referral tables not migrated yet. Apply florist_network_growth_v1 migration." });
    }
    return fail(error);
  }
}
