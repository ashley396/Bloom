import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import {
  BUCKET,
  TABLE,
  buildDocumentsExpiryDate,
  enqueueVerificationEmail,
  isMissingVerificationTableError,
  parseOptionalTimestamp,
  resolveFloristTargetStatus,
  sanitizeApplicationRecord,
  stripTaxIdFromProfileData,
  upsertTaxSecret,
  validateProfileForSubmission,
  withDocumentExpirationMetadata,
  writeVerificationAudit,
  assertSignedDocumentPathForUser
} from "./_shared/marketplace-verification.js";

const APPLICATION_SELECT =
  "id, user_id, florist_shop_id, wholesaler_shop_id, status, consent_confirmed, consent_at, profile_data, review_history, review_notes, submitted_at, reviewed_at, documents_expire_at, approval_expires_at, created_at, updated_at";

function sanitizeFileName(value = "file") {
  return String(value || "file")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "file";
}

function buildStoragePath(userId, documentKey, fileName) {
  const stamp = Date.now();
  return `${userId}/${stamp}/${documentKey}-${sanitizeFileName(fileName)}`;
}

function decodeDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/i);
  if (!match) return null;
  return { contentType: match[1], data: Buffer.from(match[2], "base64") };
}

async function uploadDocumentToStorage(client, userId, documentKey, documentMeta) {
  if (!documentMeta || typeof documentMeta !== "object") return documentMeta;
  const dataUrl = documentMeta.dataUrl || documentMeta.data_url;
  if (!dataUrl) {
    if (documentMeta.storage_path) {
      assertSignedDocumentPathForUser(userId, documentMeta.storage_path);
    }
    return documentMeta;
  }
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return documentMeta;
  const path = buildStoragePath(userId, documentKey, documentMeta.name || documentKey);
  const storage = client.storage.from(BUCKET);
  const { error } = await storage.upload(path, decoded.data, {
    contentType: decoded.contentType,
    upsert: false
  });
  if (error) {
    throw error;
  }
  return {
    ...documentMeta,
    storage_path: path,
    uploaded_at: new Date().toISOString(),
    dataUrl: undefined,
    data_url: undefined
  };
}

async function prepareDocuments(client, userId, documents = {}) {
  if (!documents || typeof documents !== "object") return {};
  const nextDocuments = {};
  for (const [key, value] of Object.entries(documents)) {
    if (!value || typeof value !== "object") {
      nextDocuments[key] = value;
      continue;
    }
    nextDocuments[key] = await uploadDocumentToStorage(client, userId, key, value);
  }
  return withDocumentExpirationMetadata(nextDocuments);
}

async function attachSignedUrls(client, userId, documents = {}) {
  if (!documents || typeof documents !== "object") return documents;
  const nextDocuments = {};
  for (const [key, value] of Object.entries(documents)) {
    if (!value || typeof value !== "object") {
      nextDocuments[key] = value;
      continue;
    }
    const storagePath = value.storage_path;
    if (!storagePath) {
      nextDocuments[key] = value;
      continue;
    }
    assertSignedDocumentPathForUser(userId, storagePath);
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
    nextDocuments[key] = {
      ...value,
      signedUrl: error ? null : data?.signedUrl || null
    };
  }
  return nextDocuments;
}

async function formatApplicationForClient(client, userId, application) {
  if (!application) return null;
  const documents = application.profile_data?.documents || {};
  const sanitized = await sanitizeApplicationRecord(client, {
    ...application,
    profile_data: {
      ...(application.profile_data || {}),
      documents: await attachSignedUrls(client, userId, documents)
    }
  });
  return sanitized;
}

function extractProfilePayload(body) {
  const incoming = body.profile_data || body.application || body;
  return incoming && typeof incoming === "object" ? incoming : {};
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const { client, user, shopId } = await currentUser(event);
    const body = bodyOf(event);
    const taxKey = process.env.MARKETPLACE_TAX_ENCRYPTION_KEY;

    if (event.httpMethod === "GET") {
      const { data, error } = await client
        .from(TABLE)
        .select(APPLICATION_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const application = await formatApplicationForClient(client, user.id, data);
      return json(200, { application });
    }

    if (event.httpMethod === "POST") {
      const profileData = extractProfilePayload(body);
      const requestedStatus = profileData.status || body.status || "draft";
      const submitting = Boolean(body.submit || profileData.submit || requestedStatus === "submitted");

      const { data: existing, error: existingError } = await client
        .from(TABLE)
        .select("id, status, profile_data")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existingError) throw existingError;

      const nextStatus = resolveFloristTargetStatus(existing?.status, requestedStatus, { submitting });
      if (submitting) {
        const validation = validateProfileForSubmission(profileData);
        if (!validation.valid) {
          return json(400, { error: validation.errors.join(" ") });
        }
      }

      const rawTaxId = profileData.tax_id;
      const documents = await prepareDocuments(client, user.id, profileData.documents || {});
      const profileWithoutTax = stripTaxIdFromProfileData({
        ...profileData,
        documents
      });

      const payload = {
        user_id: user.id,
        florist_shop_id: shopId,
        wholesaler_shop_id: body.wholesaler_shop_id || profileData.wholesaler_shop_id || null,
        status: nextStatus,
        consent_confirmed: Boolean(profileData.consent_confirmed),
        consent_at: profileData.consent_confirmed ? parseOptionalTimestamp(profileData.consent_at) || new Date().toISOString() : null,
        profile_data: profileWithoutTax,
        review_history: Array.isArray(profileData.review_history) ? profileData.review_history : [],
        submitted_at: nextStatus === "submitted" ? parseOptionalTimestamp(profileData.submitted_at) || new Date().toISOString() : parseOptionalTimestamp(profileData.submitted_at),
        reviewed_at: parseOptionalTimestamp(profileData.reviewed_at),
        review_notes: profileData.review_notes || "",
        documents_expire_at: nextStatus === "submitted" ? buildDocumentsExpiryDate() : parseOptionalTimestamp(profileData.documents_expire_at),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await client.from(TABLE).upsert(payload, { onConflict: "user_id" }).select(APPLICATION_SELECT).single();
      if (error) throw error;

      if (rawTaxId) {
        await upsertTaxSecret(client, {
          applicationId: data.id,
          userId: user.id,
          taxId: rawTaxId,
          keyMaterial: taxKey
        });
      }

      if (nextStatus === "submitted") {
        await writeVerificationAudit(client, {
          applicationId: data.id,
          actorUserId: user.id,
          action: "florist_submitted",
          metadata: { florist_shop_id: shopId, wholesaler_shop_id: payload.wholesaler_shop_id }
        });
        await enqueueVerificationEmail(client, {
          userId: user.id,
          recipientEmail: user.email,
          eventType: "verification_submitted",
          applicationId: data.id,
          payload: { status: nextStatus }
        });
      }

      const application = await formatApplicationForClient(client, user.id, data);
      return json(200, { application });
    }

    if (event.httpMethod === "PATCH") {
      const { data: currentApplication, error: currentError } = await client
        .from(TABLE)
        .select(APPLICATION_SELECT)
        .eq("user_id", user.id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!currentApplication) {
        return json(404, { error: "No marketplace verification application exists yet." });
      }

      const profileData = extractProfilePayload(body);
      const requestedStatus = profileData.status || body.status;
      const submitting = Boolean(body.submit || profileData.submit || requestedStatus === "submitted");
      const nextStatus = resolveFloristTargetStatus(currentApplication.status, requestedStatus || currentApplication.status, { submitting });

      if (submitting) {
        const mergedForValidation = {
          ...(currentApplication.profile_data || {}),
          ...profileData,
          consent_confirmed: profileData.consent_confirmed ?? currentApplication.consent_confirmed
        };
        const validation = validateProfileForSubmission(mergedForValidation);
        if (!validation.valid) {
          return json(400, { error: validation.errors.join(" ") });
        }
      }

      const updates = {
        florist_shop_id: shopId,
        updated_at: new Date().toISOString()
      };

      if (body.wholesaler_shop_id !== undefined || profileData.wholesaler_shop_id !== undefined) {
        updates.wholesaler_shop_id = body.wholesaler_shop_id || profileData.wholesaler_shop_id || null;
      }

      if (requestedStatus) {
        updates.status = nextStatus;
      }

      if (typeof profileData.consent_confirmed === "boolean") {
        updates.consent_confirmed = profileData.consent_confirmed;
        if (profileData.consent_confirmed) {
          updates.consent_at = parseOptionalTimestamp(profileData.consent_at) || currentApplication.consent_at || new Date().toISOString();
        }
      }

      if (profileData.review_notes !== undefined) updates.review_notes = profileData.review_notes;
      if (profileData.review_history !== undefined) updates.review_history = profileData.review_history;
      if (profileData.submitted_at !== undefined) updates.submitted_at = parseOptionalTimestamp(profileData.submitted_at);
      if (profileData.reviewed_at !== undefined) updates.reviewed_at = parseOptionalTimestamp(profileData.reviewed_at);

      if (nextStatus === "submitted") {
        updates.submitted_at = updates.submitted_at || new Date().toISOString();
        updates.documents_expire_at = buildDocumentsExpiryDate();
      }

      const rawTaxId = profileData.tax_id;
      const mergedProfile = {
        ...(currentApplication.profile_data || {}),
        ...stripTaxIdFromProfileData(profileData)
      };

      if (profileData.documents !== undefined) {
        mergedProfile.documents = await prepareDocuments(client, user.id, profileData.documents || {});
      }

      updates.profile_data = mergedProfile;

      const { data, error } = await client
        .from(TABLE)
        .update(updates)
        .eq("id", currentApplication.id)
        .select(APPLICATION_SELECT)
        .single();
      if (error) throw error;

      if (rawTaxId) {
        await upsertTaxSecret(client, {
          applicationId: data.id,
          userId: user.id,
          taxId: rawTaxId,
          keyMaterial: taxKey
        });
      }

      if (nextStatus === "submitted" && currentApplication.status !== "submitted") {
        await writeVerificationAudit(client, {
          applicationId: data.id,
          actorUserId: user.id,
          action: "florist_submitted",
          metadata: { florist_shop_id: shopId, wholesaler_shop_id: data.wholesaler_shop_id }
        });
        await enqueueVerificationEmail(client, {
          userId: user.id,
          recipientEmail: user.email,
          eventType: "verification_submitted",
          applicationId: data.id,
          payload: { status: nextStatus }
        });
      }

      const application = await formatApplicationForClient(client, user.id, data);
      return json(200, { application });
    }

    return methodNotAllowed();
  } catch (error) {
    if (isMissingVerificationTableError(error)) {
      return json(503, {
        error: "Marketplace verification tables are not available yet. Apply the marketplace verification migration in Supabase."
      });
    }
    return fail(error);
  }
}
