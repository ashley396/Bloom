/**
 * Marketing image-provider adapter: OpenAI GPT-Image-2 (Batch 1, "Hybrid
 * Marketing Studio — Implementation Batch 1", Parts 4/5/6).
 *
 * ============================================================================
 * NOT YET ACTIVATED. Read this before touching this file.
 * ============================================================================
 * This adapter exists so the registry CAN recognize a second, real
 * provider once it is genuinely configured (a real OPENAI_API_KEY present
 * server-side) — it does NOT mean normal Marketing Studio generation is
 * routed here. Nothing in marketing-studio.js, marketing-image-quality.js,
 * or any other live call site selects this provider yet (Batch 1, Part
 * 12). generate()/edit() below make a REAL, GENUINELY BILLABLE POST to
 * OpenAI's API if ever actually invoked — they are not mocks/stubs — but
 * as of Batch 1 nothing in the live request path calls them. Activating
 * live traffic to this provider is a deliberate, separate, future change
 * that requires its own explicit approval.
 *
 * Cost figures cited in comments here (and in marketing-cost-config.js)
 * are WebSearch-triangulated, third-party-aggregated estimates from the
 * architecture-review pass, NOT a primary fetch of OpenAI's own current
 * pricing page — this sandbox's network policy blocks direct access to
 * openai.com. Treat them as "safe to reserve against," not "verified."
 * ============================================================================
 *
 * Deliberately mirrors marketing-image-provider-cloudflare.js's shape
 * exactly — same 5-method interface, same "thin adapter, no second engine"
 * philosophy — so marketing-image-providers.js's existing registry/router
 * needs zero changes to also carry this provider once it's configured.
 *
 * Interface (see marketing-image-providers.js for the registry/router):
 *   { name, configured(), capabilities(), estimateCost(), generate(...) }
 * Also exposes edit() beyond that 5-method contract for Part 5's
 * reference-image/editing workflow — additive only, the registry itself
 * never calls it, and no UI surface calls it yet (Part 5: "do not expose
 * editing to the UI yet if that expands Batch 1 too far").
 *
 * Security (Part 4): server-side only. This file lives under
 * netlify/functions/_shared/ — never under public/ — and reads
 * OPENAI_API_KEY exclusively from the env object passed in (defaulting to
 * process.env), exactly like the Cloudflare adapter reads its own
 * credentials. The key is never returned, echoed, or logged by anything
 * in this file. Prefer a project-scoped OpenAI API key in the real
 * environment configuration, not an org-wide key.
 */

import { uploadWebsiteMedia, publicWebsiteMediaUrl } from "./website-media.js";
import { estimateOpenAiImageCostCents, estimateOpenAiActualCostCentsFromUsage } from "./marketing-cost-config.js";

export const PROVIDER_NAME = "openai";

// Part 5: "Use model gpt-image-2 ... do not use a deprecated or legacy
// image model unless there is a documented fallback reason." GPT-Image-1
// is documented (architecture-review pass) as deprecating 2026-10-23;
// gpt-image-2 is the current flagship as of this writing. Kept as a named,
// overridable constant (not inlined) so a documented future fallback is a
// one-line change, never a silent one.
export const OPENAI_IMAGE_MODEL_DEFAULT = "gpt-image-2";

// GPT-Image-2 itself only supports these three output sizes. Listed
// narrowly and honestly (same principle as the Cloudflare adapter's own
// CAPABILITIES comment) rather than pretending every aspect ratio the app
// uses elsewhere is supported — an aspect ratio not in this map is a real
// "this provider can't do that," not a bug to paper over.
export const SIZE_BY_ASPECT_RATIO = Object.freeze({
  "1:1": "1024x1024",
  "2:3": "1024x1536",
  "3:2": "1536x1024"
});

const CAPABILITIES = Object.freeze({
  aspectRatios: Object.freeze(Object.keys(SIZE_BY_ASPECT_RATIO)),
  qualityTiers: Object.freeze(["low", "medium", "high"])
});

/** Real credential check — genuine key present, never a guess. Mirrors
 * ai-image-engine.js's imageGenerationConfigured() pattern. */
export function openAiImageGenerationConfigured(env = process.env) {
  return Boolean(String(env.OPENAI_API_KEY || "").trim());
}

/**
 * @param {object} [env] - defaults to process.env; a test may pass a fake
 *   env object instead of mutating real process.env (and, critically,
 *   never needs a real key to exercise configured()===false / interface
 *   shape / cost-estimation branches).
 */
export function createOpenAiMarketingImageProvider(env = process.env) {
  const model = String(env.OPENAI_IMAGE_MODEL || OPENAI_IMAGE_MODEL_DEFAULT);

  function apiKey() {
    return String(env.OPENAI_API_KEY || "").trim();
  }

  return Object.freeze({
    name: PROVIDER_NAME,

    configured() {
      return openAiImageGenerationConfigured(env);
    },

    capabilities() {
      return CAPABILITIES;
    },

    /** Reuses the ONE new conservative OpenAI cost model in
     * marketing-cost-config.js — never a second, competing cost figure.
     * A safe per-tier reservation ceiling, never Claude's report's
     * $0.053/image treated as authoritative (Part 6's explicit
     * instruction). */
    estimateCost({ qualityTier = "medium" } = {}) {
      if (!CAPABILITIES.qualityTiers.includes(qualityTier)) return null;
      return estimateOpenAiImageCostCents({ qualityTier });
    },

    /**
     * Real generation call. NOT invoked by any live Marketing Studio path
     * as of Batch 1 (see file header) — genuinely billable if it ever is.
     *
     * @param {object} params
     * @param {import('@supabase/supabase-js').SupabaseClient} params.client
     * @param {string} params.shopId
     * @param {string} params.prompt
     * @param {string} [params.filename]
     * @param {string|null} [params.aspectRatio] - must be a key of
     *   SIZE_BY_ASPECT_RATIO; unrecognized values fail closed rather than
     *   silently picking a default the caller didn't ask for.
     * @param {string} [params.qualityTier] - "low" | "medium" | "high"
     * @param {string|null} [params.traceId] - echoed back for the
     *   caller's own usage-ledger/log correlation.
     * @returns {Promise<object>} { ok, path, url, provider, model, prompt,
     *   imageDataUrl, usage, actualCostCents } on success — the same
     *   ok/path/url/provider/model/prompt shape generateImage() returns,
     *   plus usage/actualCostCents ONLY when OpenAI's response actually
     *   reported usage (Part 6: reconcile when available, never fabricate
     *   it). { ok: false, stage, error } on any failure — never throws.
     */
    async generate({ client, shopId, prompt, filename, aspectRatio = "1:1", qualityTier = "medium", traceId = null } = {}) {
      const cleanPrompt = String(prompt || "").trim().slice(0, 4000);
      if (!cleanPrompt) return { ok: false, stage: "config", error: "No image prompt provided." };
      if (!openAiImageGenerationConfigured(env)) {
        return { ok: false, stage: "config", error: "OpenAI image generation is not configured (OPENAI_API_KEY missing)." };
      }
      const size = SIZE_BY_ASPECT_RATIO[aspectRatio];
      if (!size) {
        return { ok: false, stage: "config", error: `Unsupported aspect ratio for OpenAI image generation: "${aspectRatio}".` };
      }
      if (!CAPABILITIES.qualityTiers.includes(qualityTier)) {
        return { ok: false, stage: "config", error: `Unsupported quality tier for OpenAI image generation: "${qualityTier}".` };
      }

      let response;
      try {
        response = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: cleanPrompt, size, quality: qualityTier, n: 1 })
        });
      } catch (error) {
        return { ok: false, stage: "provider", error: `OpenAI image generation request failed: ${String(error?.message || error).slice(0, 200)}` };
      }

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        return { ok: false, stage: "provider", error: `OpenAI image generation returned a non-JSON response (${response.status}).` };
      }
      if (!response.ok) {
        const detail = payload?.error?.message || `OpenAI image generation failed (${response.status})`;
        return { ok: false, stage: "provider", error: detail };
      }
      const base64 = payload?.data?.[0]?.b64_json;
      if (!base64) return { ok: false, stage: "provider", error: "OpenAI image generation returned no image data." };

      const uploaded = await uploadWebsiteMedia(client, shopId, {
        dataUrl: `data:image/png;base64,${base64}`,
        filename: filename || "openai-generated-image.png"
      });
      if (!uploaded.ok) return { ok: false, stage: "upload", error: uploaded.error };

      // Reconcile against real reported usage ONLY when OpenAI actually
      // returned it — otherwise leave actualCostCents undefined so the
      // caller honestly falls back to the pre-flight reservation amount
      // (Part 6: never fabricate a reconciled figure).
      const usage = payload?.usage || null;
      const reconciled = usage ? estimateOpenAiActualCostCentsFromUsage(usage) : null;

      return {
        ok: true,
        path: uploaded.path,
        url: publicWebsiteMediaUrl(client, uploaded.path),
        provider: PROVIDER_NAME,
        model,
        prompt: cleanPrompt,
        imageDataUrl: `data:image/png;base64,${base64}`,
        providerName: PROVIDER_NAME,
        traceId,
        aspectRatio,
        qualityTier,
        usage: usage || undefined,
        actualCostCents: reconciled?.cents ?? undefined,
        costSource: reconciled ? reconciled.cost_source : "openai_conservative_ceiling_estimate"
      };
    },

    /**
     * Reference-image / mask-based editing (Part 5's "editing/reference-
     * image workflows where the API adapter can expose them cleanly").
     * NOT part of the 5-method registry interface, NOT called by any UI
     * surface yet, NOT invoked by any live path as of Batch 1 — additive
     * only, kept here (rather than a second file) because it is the same
     * provider/credentials/upload plumbing, per this codebase's own
     * "no parallel architecture" rule.
     *
     * @param {object} params
     * @param {import('@supabase/supabase-js').SupabaseClient} params.client
     * @param {string} params.shopId
     * @param {string} params.prompt
     * @param {string} params.referenceImageDataUrl - a `data:image/...`
     *   URL for the source image to edit (e.g. a florist-uploaded photo).
     * @param {string|null} [params.maskDataUrl] - optional mask for
     *   inpainting; when omitted OpenAI edits the whole reference image.
     * @param {string} [params.filename]
     * @param {string|null} [params.aspectRatio]
     * @param {string} [params.qualityTier]
     * @param {string|null} [params.traceId]
     * @returns {Promise<object>} same success/failure shape as generate().
     */
    async edit({
      client,
      shopId,
      prompt,
      referenceImageDataUrl,
      maskDataUrl = null,
      filename,
      aspectRatio = "1:1",
      qualityTier = "medium",
      traceId = null
    } = {}) {
      const cleanPrompt = String(prompt || "").trim().slice(0, 4000);
      if (!cleanPrompt) return { ok: false, stage: "config", error: "No edit prompt provided." };
      if (!openAiImageGenerationConfigured(env)) {
        return { ok: false, stage: "config", error: "OpenAI image generation is not configured (OPENAI_API_KEY missing)." };
      }
      const size = SIZE_BY_ASPECT_RATIO[aspectRatio];
      if (!size) {
        return { ok: false, stage: "config", error: `Unsupported aspect ratio for OpenAI image editing: "${aspectRatio}".` };
      }
      const refBuffer = dataUrlToBuffer(referenceImageDataUrl);
      if (!refBuffer) return { ok: false, stage: "config", error: "No valid reference image provided for OpenAI image editing." };

      const form = new FormData();
      form.append("model", model);
      form.append("prompt", cleanPrompt);
      form.append("size", size);
      form.append("quality", qualityTier);
      form.append("image", new Blob([refBuffer.bytes], { type: refBuffer.mime }), "reference.png");
      const maskBuffer = maskDataUrl ? dataUrlToBuffer(maskDataUrl) : null;
      if (maskBuffer) form.append("mask", new Blob([maskBuffer.bytes], { type: maskBuffer.mime }), "mask.png");

      let response;
      try {
        response = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey()}` },
          body: form
        });
      } catch (error) {
        return { ok: false, stage: "provider", error: `OpenAI image edit request failed: ${String(error?.message || error).slice(0, 200)}` };
      }

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        return { ok: false, stage: "provider", error: `OpenAI image edit returned a non-JSON response (${response.status}).` };
      }
      if (!response.ok) {
        const detail = payload?.error?.message || `OpenAI image edit failed (${response.status})`;
        return { ok: false, stage: "provider", error: detail };
      }
      const base64 = payload?.data?.[0]?.b64_json;
      if (!base64) return { ok: false, stage: "provider", error: "OpenAI image edit returned no image data." };

      const uploaded = await uploadWebsiteMedia(client, shopId, {
        dataUrl: `data:image/png;base64,${base64}`,
        filename: filename || "openai-edited-image.png"
      });
      if (!uploaded.ok) return { ok: false, stage: "upload", error: uploaded.error };

      const usage = payload?.usage || null;
      const reconciled = usage ? estimateOpenAiActualCostCentsFromUsage(usage) : null;

      return {
        ok: true,
        path: uploaded.path,
        url: publicWebsiteMediaUrl(client, uploaded.path),
        provider: PROVIDER_NAME,
        model,
        prompt: cleanPrompt,
        imageDataUrl: `data:image/png;base64,${base64}`,
        providerName: PROVIDER_NAME,
        traceId,
        aspectRatio,
        qualityTier,
        usage: usage || undefined,
        actualCostCents: reconciled?.cents ?? undefined,
        costSource: reconciled ? reconciled.cost_source : "openai_conservative_ceiling_estimate"
      };
    }
  });
}

/** Parses a `data:<mime>;base64,<data>` URL into raw bytes + mime, or null
 * for anything malformed — fails closed rather than sending garbage to
 * OpenAI's edit endpoint. */
function dataUrlToBuffer(dataUrl) {
  const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!match) return null;
  try {
    return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}
