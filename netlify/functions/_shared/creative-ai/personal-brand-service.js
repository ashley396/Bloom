/**
 * Personal Brand Studio — the orchestration layer shared by both entry
 * points: marketing-studio.js's `personal_brand_command`/
 * `request_personal_brand_digital_twin` HTTP actions (the admin console),
 * and lily-ai.js's normal chat dispatcher (Section 2 of the Lily +
 * Digital Twin integration pass). Extracted here specifically so neither
 * caller re-implements this logic — the exact "do not duplicate" rule the
 * directive calls out.
 *
 * Every function here is caller-authorization-agnostic: it does real,
 * shop-scoped work with whatever `client` it's given (RLS enforces the
 * actual tenant boundary either way) and returns a plain result object,
 * never an HTTP response — the two callers each wrap the result in their
 * own response shape (json() for the HTTP action, a chat reply string for
 * Lily).
 */

import { admin as createServiceRoleClient } from "../supabase.js";
import { SUPPORTED_PLATFORMS } from "../marketing-social-providers.js";
import { CLONE_USAGE_TYPES } from "../marketing-clone-consent.js";
import { selectCloneProvider, notLiveCloneProvider, buildConfiguredCloneProviderRegistry } from "../marketing-clone-providers.js";
import { uploadClonedVoiceAudio } from "../website-media.js";
import { persistGeneratedAsset } from "../ai-creative-engine.js";
import {
  loadPersonalBrandProfile,
  savePersonalBrandPreferences,
  applyExplicitPreferenceUpdates,
  forgetPreference as forgetPersonalBrandTrait,
  buildPersonalBrandStyleSummary
} from "../personal-brand-memory.js";
import { isDigitalTwinUseAuthorized } from "./personal-brand-consent.js";
import { classifyPersonalBrandCommand } from "./personal-brand-intent.js";
import { generatePersonalBrandConcept } from "./personal-brand-concept.js";
import { resolveTargetPlatforms } from "./personal-brand-platform-variants.js";
import { recordCloneVideoJob } from "./clone-video-jobs.js";

/**
 * Founding Beta gate (Section 3/17): Personal Brand Studio's HTTP actions
 * are all `requireSuperAdmin`-gated today because the whole Marketing
 * Studio surface is deliberately admin-only during Founding Beta (see
 * marketing-studio.js's own file header). Routing it into normal Lily
 * chat must NOT quietly widen that to every shop member — until Ashley
 * explicitly opens Personal Brand Studio to all florists, only the
 * platform's own super_admin gets the in-chat convenience; everyone else
 * simply falls through to Lily's ordinary chat response, unchanged.
 */
export async function isRequestingUserPlatformSuperAdmin(userId, { adminClient } = {}) {
  if (!userId) return false;
  try {
    const client = adminClient || createServiceRoleClient();
    const { data, error } = await client.from("platform_admins").select("role,active").eq("user_id", userId).maybeSingle();
    if (error || !data) return false;
    return data.active === true && String(data.role || "").toLowerCase() === "super_admin";
  } catch {
    return false;
  }
}

/**
 * Finds the shop's currently active Digital Twin grant — the most
 * recently granted, not-revoked marketing_clone_consent row, plus
 * whichever of its avatar/voice profiles have actually finished training
 * ('ready'). Returns null when nothing is enrolled yet, or when the only
 * consent on file has been revoked — "Use my Digital Twin" from chat is
 * never itself authorization; this is the real, independent lookup that
 * grounds it. Avatar and voice resolve independently (a shop can have
 * avatar_permission without voice_permission, or a ready avatar profile
 * next to a voice profile still training) — never assume one implies the
 * other.
 */
export async function findActiveDigitalTwinGrant(client, shopId) {
  const consentResult = await client
    .from("marketing_clone_consent")
    .select("id,avatar_permission,voice_permission,approved_usage,approved_platforms,revoked_at")
    .eq("shop_id", shopId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (consentResult.error || !consentResult.data) return null;
  const consent = consentResult.data;

  let avatarProfileId = null;
  if (consent.avatar_permission) {
    const avatarResult = await client
      .from("marketing_avatar_profiles")
      .select("id,status")
      .eq("shop_id", shopId)
      .eq("consent_id", consent.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    avatarProfileId = avatarResult.data?.id || null;
  }

  let voiceProfileId = null;
  if (consent.voice_permission) {
    const voiceResult = await client
      .from("marketing_voice_profiles")
      .select("id,status")
      .eq("shop_id", shopId)
      .eq("consent_id", consent.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    voiceProfileId = voiceResult.data?.id || null;
  }

  return { consentId: consent.id, consent, avatarProfileId, voiceProfileId };
}

/**
 * Most recent founder_concept asset for this shop — used when a chat
 * message asks to use the Digital Twin without describing new content in
 * the same turn ("use my Digital Twin" as a bare follow-up). Deliberately
 * shop-scoped rather than conversation-scoped: unlike Visual Creation
 * Studio's ai_execution_jobs-backed findLastVisualAsset(), a founder
 * concept is persisted directly via persistGeneratedAsset() with no job/
 * conversation wrapper, so there is no conversation_id to scope by today.
 * Still fully tenant-safe (shop_id-scoped, never cross-tenant) — just a
 * coarser "most recent for this shop" rather than "most recent in this
 * thread".
 */
export async function findLastPersonalBrandConceptAsset(client, shopId) {
  const { data } = await client
    .from("ai_generated_assets")
    .select("id,content")
    .eq("shop_id", shopId)
    .eq("asset_type", "founder_concept")
    // Revoked-media hardening: defense-in-depth. founder_concept assets
    // are never the ones this pass quarantines (only Digital Twin video
    // output gets a consent_id/quarantine disposition today), but this
    // "most recent for the shop" lookup should never silently hand back
    // quarantined media if that ever changes.
    .neq("status", "quarantined")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/**
 * The full personal_brand_command workflow: classify -> apply any
 * standing memory statement -> (if a mode was resolved) generate and
 * persist a founder concept -> (if "use my Digital Twin"/"use my voice"
 * was also asked) verify consent and kick off a render. Identical logic
 * for both callers — see this module's header. `conversationAssetId`
 * (optional) is the fallback target for a bare "use my Digital Twin"
 * follow-up with no concept described this turn — the caller resolves it
 * via findLastPersonalBrandConceptAsset() when relevant.
 */
export async function runPersonalBrandCommand(client, { shopId, userId, message, conversationAssetId = null } = {}) {
  const classification = await classifyPersonalBrandCommand(message);
  if (!classification) {
    return { understood: false, note: "Lily couldn't understand that Personal Brand request. Try rephrasing." };
  }

  const { profile: current } = await loadPersonalBrandProfile(client, shopId);
  let memoryAck = null;
  if (classification.memory_action === "remember_like" || classification.memory_action === "remember_avoid") {
    if (classification.memory_category && classification.memory_text) {
      const polarity = classification.memory_action === "remember_avoid" ? "negative" : "positive";
      const next = applyExplicitPreferenceUpdates(current.preferences, [{ category: classification.memory_category, text: classification.memory_text, polarity }]);
      await savePersonalBrandPreferences(client, shopId, next);
      current.preferences = next;
      memoryAck = "Got it — I'll remember that.";
    }
  } else if (classification.memory_action === "forget" && classification.memory_category && classification.memory_text) {
    const next = forgetPersonalBrandTrait(current.preferences, { category: classification.memory_category, text: classification.memory_text });
    await savePersonalBrandPreferences(client, shopId, next);
    current.preferences = next;
    memoryAck = "Forgotten.";
  }

  let asset = null;
  let content = null;
  let suggestedPlatforms = null;
  if (classification.mode) {
    const styleSummary = buildPersonalBrandStyleSummary(current.preferences);
    const gen = await generatePersonalBrandConcept({
      mode: classification.mode,
      profile: current,
      styleSummary,
      toneHint: classification.tone_hint,
      requestText: message
    });
    if (!gen.ok) return { understood: true, classification, memoryAck, asset: null, error: gen.error };

    const persisted = await persistGeneratedAsset(client, {
      shopId,
      userId,
      persona: "Lily",
      assetType: "founder_concept",
      provider: "cloudflare",
      model: gen.model,
      content: gen.content,
      status: "completed"
    });
    if (!persisted.ok) throw new Error(persisted.error);

    asset = persisted.asset;
    content = gen.content;
    suggestedPlatforms = resolveTargetPlatforms({ mode: classification.mode, explicitPlatform: classification.target_platform, requestedPlatforms: null });
  }

  // "Use my Digital Twin" / "Use my voice" — understanding the command is
  // not authorization (Section 5): every path here goes through the real
  // consent lookup and requestDigitalTwinGeneration()'s own independent
  // avatar/voice checks, never a caller-supplied flag treated as consent.
  let digitalTwin = null;
  if (classification.use_digital_twin || classification.use_voice) {
    const targetAssetId = asset?.id || conversationAssetId || null;
    if (!targetAssetId) {
      digitalTwin = { attempted: false, reason: "no_concept_to_render" };
    } else {
      const grant = await findActiveDigitalTwinGrant(client, shopId);
      if (!grant) {
        digitalTwin = { attempted: false, reason: "not_enrolled" };
      } else {
        const avatarProfileId = classification.use_digital_twin ? grant.avatarProfileId : null;
        // "Don't use my voice" is an explicit override that always wins,
        // even over a same-message "use my voice" (which would be a
        // contradictory request the classifier shouldn't produce, but
        // fail toward the more conservative reading if it ever does).
        const voiceProfileId = classification.suppress_voice ? null : classification.use_voice ? grant.voiceProfileId : null;
        if (!avatarProfileId && !voiceProfileId) {
          digitalTwin = { attempted: false, reason: "profile_not_ready" };
        } else {
          const targetPlatforms = resolveTargetPlatforms({
            mode: classification.mode || "founder_portrait",
            explicitPlatform: classification.target_platform,
            requestedPlatforms: suggestedPlatforms
          });
          const twinResult = await requestDigitalTwinGeneration(client, {
            shopId,
            userId,
            assetId: targetAssetId,
            avatarProfileId,
            voiceProfileId,
            consentId: grant.consentId,
            platform: targetPlatforms[0],
            usage: "social_video"
          });
          digitalTwin = { attempted: true, ...twinResult };
        }
      }
    }
  }

  return { understood: true, classification, memoryAck, asset, content, suggestedPlatforms, digitalTwin };
}

/**
 * Kicks off a Digital Twin render for an approved founder concept.
 * Consent is verified server-side, independently for avatar vs. voice
 * (Section 5) — "use my Digital Twin" from Lily chat is understanding a
 * command, never authorization to act on it. Returns
 * { ok, statusCode, body } — statusCode/body map directly onto the HTTP
 * action's json() response; lily-ai.js reads ok/body to build a chat
 * reply instead.
 */
export async function requestDigitalTwinGeneration(
  client,
  { shopId, userId, assetId, avatarProfileId, voiceProfileId, consentId, platform, usage } = {}
) {
  if (!assetId) return { ok: false, statusCode: 400, body: { error: "asset_id is required." } };
  if (!avatarProfileId && !voiceProfileId) return { ok: false, statusCode: 400, body: { error: "avatar_profile_id or voice_profile_id is required." } };
  if (!consentId) return { ok: false, statusCode: 400, body: { error: "consent_id is required — a Digital Twin render always needs an active, named consent grant." } };
  if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) {
    return { ok: false, statusCode: 400, body: { error: `platform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}.` } };
  }

  // Revoked-media hardening (Section 2/9): a quarantined asset can never
  // become source/reference material for a NEW Digital Twin render — the
  // direct-ID lookup here is exactly the bypass a list filter elsewhere
  // would miss.
  const asset = await client.from("ai_generated_assets").select("id,content,asset_type").eq("id", assetId).eq("shop_id", shopId).neq("status", "quarantined").maybeSingle();
  if (asset.error) throw asset.error;
  if (!asset.data || asset.data.asset_type !== "founder_concept") return { ok: false, statusCode: 404, body: { error: "Founder concept asset not found." } };

  const consent = await client
    .from("marketing_clone_consent")
    .select("id,avatar_permission,voice_permission,approved_usage,approved_platforms,revoked_at")
    .eq("id", consentId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (consent.error) throw consent.error;
  if (!consent.data) return { ok: false, statusCode: 404, body: { error: "Consent record not found." } };

  const resolvedUsage = CLONE_USAGE_TYPES.includes(usage) ? usage : "social_video";
  // Avatar and voice permission are checked INDEPENDENTLY — "use my
  // avatar" never implies voice consent, and vice versa (Section 5).
  const authz = isDigitalTwinUseAuthorized({
    consentRow: consent.data,
    usage: resolvedUsage,
    platform,
    needsAvatar: Boolean(avatarProfileId),
    needsVoice: Boolean(voiceProfileId)
  });
  if (!authz.authorized) return { ok: false, statusCode: 403, body: { error: `Digital Twin use not authorized: ${authz.reason}.` } };

  const cloneRegistry = buildConfiguredCloneProviderRegistry({
    env: process.env,
    uploadAudio: (buffer, filename) => uploadClonedVoiceAudio(client, shopId, buffer, filename)
  });
  const provider = selectCloneProvider({}, cloneRegistry);
  if (provider === notLiveCloneProvider) {
    return { ok: true, statusCode: 200, body: { note: "NOT LIVE — PROVIDER CONNECTION REQUIRED. No avatar/voice provider is connected yet.", asset_id: assetId } };
  }

  const script = [asset.data.content?.body, asset.data.content?.founder_presence_brief].filter(Boolean).join(" ");
  try {
    const result = await provider.generateVideo({
      avatarProfileId,
      voiceProfileId,
      script,
      title: asset.data.content?.headline || "Founder video"
    });
    try {
      await recordCloneVideoJob(client, {
        shopId,
        provider: result.provider || "heygen",
        providerJobId: result.jobId,
        source: "content_generation",
        sourceAssetId: assetId,
        avatarProfileId,
        voiceProfileId,
        consentId,
        usage: resolvedUsage,
        platform,
        createdBy: userId
      });
    } catch (correlationError) {
      console.warn(
        JSON.stringify({ level: "warn", fn: "personal-brand-service", message: "digital_twin_job_record_failed", reason: String(correlationError?.message || correlationError) })
      );
    }
    return {
      ok: true,
      statusCode: 202,
      body: {
        job_id: result.jobId,
        status: result.status || "rendering",
        source_asset_id: assetId,
        note: "Render kicked off. The finished video will correlate back via the HeyGen webhook/poll (clone_job_status) — no ai_generated_assets row exists for it yet."
      }
    };
  } catch (error) {
    return { ok: false, statusCode: 502, body: { error: String(error?.message || error).slice(0, 300) } };
  }
}
