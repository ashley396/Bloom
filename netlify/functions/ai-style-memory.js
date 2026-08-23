/**
 * "My Style" — the florist-facing screen for what Lily has learned about
 * this shop's visual style (see _shared/ai-style-memory.js for the actual
 * learning rules this only exposes). Every action here is a thin wrapper
 * over that module's pure functions; this file's only job is auth, input
 * validation, and persistence.
 */

import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser, fail, requireRoles } from "./_shared/supabase.js";
import {
  STYLE_CATEGORIES,
  loadStyleMemory,
  saveStyleMemory,
  applyExplicitPreferenceUpdates,
  recordApprovalSignal,
  forgetPreference,
  resetPreferences,
  buildStyleSummary
} from "./_shared/ai-style-memory.js";

/** Shapes a stored preferences object into what the My Style screen
 * actually renders: active traits grouped by category (the headline
 * chips), plus any inferred trait still building evidence toward the
 * promotion threshold (visible, honestly labeled as "still learning" —
 * never hidden, never presented as already part of the shop's style). */
export function toScreenPayload(preferences) {
  const categories = {};
  for (const category of STYLE_CATEGORIES) {
    const traits = preferences[category]?.traits || [];
    categories[category] = {
      active: traits.filter((t) => t.active),
      learning: traits.filter((t) => !t.active)
    };
  }
  return { categories, summary: buildStyleSummary(preferences) };
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const ctx = await currentUser(event);
    const { client, shopId } = ctx;

    if (event.httpMethod === "GET") {
      const { preferences, error } = await loadStyleMemory(client, shopId);
      if (error) return json(200, { ...toScreenPayload(preferences), warning: "Started fresh — nothing learned yet could be loaded." });
      return json(200, toScreenPayload(preferences));
    }

    if (event.httpMethod !== "POST") return methodNotAllowed();

    // Everything past this point changes what Lily has learned — the same
    // roles allowed to run Lily's creative jobs (owner/manager/staff/
    // designer) get to review and edit that memory; anyone else is chat-only.
    requireRoles(ctx, ["owner", "manager", "staff", "designer"]);

    const body = bodyOf(event);
    const action = String(body.action || "").trim();

    if (action === "update") {
      // Manual edit from the My Style screen itself — treated exactly like
      // an explicit spoken statement (writes immediately, full strength).
      const updates = Array.isArray(body.updates) ? body.updates : [];
      if (!updates.length) return json(400, { error: "Add at least one style update." });
      const { preferences } = await loadStyleMemory(client, shopId);
      const next = applyExplicitPreferenceUpdates(preferences, updates);
      const saved = await saveStyleMemory(client, shopId, next);
      if (!saved.ok) return json(500, { error: saved.error });
      return json(200, toScreenPayload(next));
    }

    if (action === "forget") {
      if (!body.category || !body.text) return json(400, { error: "category and text are required." });
      const { preferences } = await loadStyleMemory(client, shopId);
      const next = forgetPreference(preferences, { category: body.category, text: body.text });
      const saved = await saveStyleMemory(client, shopId, next);
      if (!saved.ok) return json(500, { error: saved.error });
      return json(200, toScreenPayload(next));
    }

    if (action === "reset") {
      const next = resetPreferences();
      const saved = await saveStyleMemory(client, shopId, next);
      if (!saved.ok) return json(500, { error: saved.error });
      return json(200, toScreenPayload(next));
    }

    // "record-outcome": the Save/Undo signal from a generated visual's
    // preview card — the OTHER half of shop style memory (approval
    // behavior, not a spoken statement). Never fires from a bare
    // generation, only a real Save (reinforces) or a real Undo-without-
    // saving (weakens) — see recordApprovalSignal()'s own docstring.
    if (action === "record-outcome") {
      const signal = body.signal === "saved" || body.signal === "undone" ? body.signal : null;
      const traits = Array.isArray(body.traits_used) ? body.traits_used : [];
      if (!signal) return json(400, { error: "signal must be \"saved\" or \"undone\"." });
      if (!traits.length) return json(200, { ok: true, note: "No shop-style traits were used in this generation — nothing to reinforce or weaken." });
      const { preferences } = await loadStyleMemory(client, shopId);
      const next = recordApprovalSignal(preferences, { traits, signal });
      const saved = await saveStyleMemory(client, shopId, next);
      if (!saved.ok) return json(500, { error: saved.error });
      return json(200, { ok: true });
    }

    return json(400, { error: `Unknown action: "${action || "(none)"}".` });
  } catch (error) {
    return fail(error);
  }
}
