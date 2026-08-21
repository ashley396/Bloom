import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles } from "./_shared/supabase.js";
import {
  TABLE,
  adminDecisionToStatus,
  attachSignedUrlsForReviewer,
  buildApprovalExpiryDate,
  enqueueVerificationEmail,
  isMissingVerificationTableError,
  parseOptionalTimestamp,
  sanitizeApplicationRecord,
  wholesalerCanAccessApplication,
  writeVerificationAudit
} from "./_shared/marketplace-verification.js";

/** Access to `application` must already be verified before calling this —
 * "list" is pre-filtered by wholesaler_shop_id, "review" calls
 * assertWholesalerAccess first. See attachSignedUrlsForReviewer()'s
 * docstring for why it doesn't re-check authorization itself. */
async function withReviewerDocuments(client, application) {
  if (!application?.profile_data?.documents) return application;
  return {
    ...application,
    profile_data: {
      ...application.profile_data,
      documents: await attachSignedUrlsForReviewer(client, application.profile_data.documents)
    }
  };
}

const APPLICATION_SELECT =
  "id, user_id, florist_shop_id, wholesaler_shop_id, status, consent_confirmed, consent_at, profile_data, review_history, review_notes, submitted_at, reviewed_at, documents_expire_at, approval_expires_at, created_at, updated_at";

function assertWholesalerAccess(shopId, application) {
  if (wholesalerCanAccessApplication(application, { shopId })) {
    return;
  }
  const err = new Error("You do not have access to review this verification application.");
  err.statusCode = 403;
  throw err;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const { client, user, shopId, role } = await currentUser(event);
    requireRoles({ role }, ["owner", "manager", "admin"]);
    const body = bodyOf(event);
    const action = String(body.action || "list").toLowerCase();

    if (action === "list") {
      const { data, error } = await client
        .from(TABLE)
        .select(APPLICATION_SELECT)
        .eq("wholesaler_shop_id", shopId)
        .neq("status", "draft")
        .order("submitted_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      const applications = await Promise.all(
        (data || []).map(async (row) => withReviewerDocuments(client, await sanitizeApplicationRecord(client, row)))
      );
      return json(200, { applications });
    }

    if (action === "review") {
      const applicationId = body.application_id || body.id;
      if (!applicationId) {
        return json(400, { error: "application_id is required." });
      }

      const decision = String(body.decision || "").toLowerCase();
      const nextStatus = adminDecisionToStatus(decision);
      if (!nextStatus) {
        return json(400, { error: "Invalid review decision." });
      }

      const { data: application, error: loadError } = await client
        .from(TABLE)
        .select(APPLICATION_SELECT)
        .eq("id", applicationId)
        .maybeSingle();
      if (loadError) throw loadError;
      if (!application) {
        return json(404, { error: "Application not found." });
      }

      assertWholesalerAccess(shopId, application);

      const reviewEntry = {
        status: nextStatus,
        decision,
        notes: body.review_notes || body.notes || "",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString()
      };
      const reviewHistory = Array.isArray(application.review_history) ? application.review_history : [];

      const updates = {
        status: nextStatus,
        review_notes: reviewEntry.notes,
        reviewed_at: parseOptionalTimestamp(body.reviewed_at) || reviewEntry.reviewed_at,
        review_history: [...reviewHistory, reviewEntry],
        updated_at: new Date().toISOString()
      };

      if (nextStatus === "approved") {
        updates.approval_expires_at = parseOptionalTimestamp(body.approval_expires_at) || buildApprovalExpiryDate();
      }

      const { data: updated, error: updateError } = await client
        .from(TABLE)
        .update(updates)
        .eq("id", applicationId)
        .select(APPLICATION_SELECT)
        .single();
      if (updateError) throw updateError;

      await writeVerificationAudit(client, {
        applicationId,
        actorUserId: user.id,
        action: "wholesaler_review",
        metadata: { decision, status: nextStatus, wholesaler_shop_id: shopId }
      });

      await enqueueVerificationEmail(client, {
        userId: application.user_id,
        recipientEmail: body.recipient_email || null,
        eventType: `verification_${nextStatus}`,
        applicationId,
        payload: { decision, status: nextStatus, review_notes: reviewEntry.notes }
      });

      const sanitized = await withReviewerDocuments(client, await sanitizeApplicationRecord(client, updated));
      return json(200, { application: sanitized });
    }

    return json(400, { error: "Unsupported action. Use list or review." });
  } catch (error) {
    if (isMissingVerificationTableError(error)) {
      return json(503, {
        error: "Marketplace verification tables are not available yet. Apply the marketplace verification migration in Supabase."
      });
    }
    return fail(error);
  }
}
