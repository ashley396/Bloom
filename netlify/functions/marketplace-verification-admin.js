import { json, preflight, methodNotAllowed } from "./_shared/http.js";
import {
  platformAdmin,
  writeAdminAudit,
  requireSuperAdmin,
  platformAdminErrorResponse,
  platformAdminError,
  parsePlatformAdminJsonBody,
  resolvePlatformAdminHandlerDeps
} from "./_shared/platform-admin.js";
import {
  TABLE,
  ADMIN_REVIEW_DECISIONS,
  adminDecisionToStatus,
  buildApprovalExpiryDate,
  enqueueVerificationEmail,
  isMissingVerificationTableError,
  parseOptionalTimestamp,
  sanitizeApplicationRecord,
  writeVerificationAudit
} from "./_shared/marketplace-verification.js";

const APPLICATION_SELECT =
  "id, user_id, florist_shop_id, wholesaler_shop_id, status, consent_confirmed, consent_at, profile_data, review_history, review_notes, submitted_at, reviewed_at, documents_expire_at, approval_expires_at, created_at, updated_at";

export async function handler(event, contextOrDeps) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const deps = resolvePlatformAdminHandlerDeps(contextOrDeps);
    const { client, user, admin } = await platformAdmin(event, ["super_admin"], deps);

    if (event.httpMethod === "GET") {
      const status = event.queryStringParameters?.status;
      let query = client.from(TABLE).select(APPLICATION_SELECT).order("created_at", { ascending: false });
      if (status) {
        query = query.eq("status", status);
      }
      const { data, error } = await query;
      if (error) throw error;
      const applications = await Promise.all(
        (data || []).map((row) => sanitizeApplicationRecord(client, row))
      );
      return json(200, { applications });
    }

    if (event.httpMethod === "POST") {
      requireSuperAdmin(admin);
      const body = parsePlatformAdminJsonBody(event);
      const applicationId = body.application_id || body.id;
      const decision = String(body.decision || "").toLowerCase();

      if (!applicationId) {
        return json(400, { error: "application_id is required." });
      }
      if (!ADMIN_REVIEW_DECISIONS.has(decision)) {
        return json(400, { error: "Invalid review decision." });
      }

      const nextStatus = adminDecisionToStatus(decision);
      const { data: application, error: loadError } = await client
        .from(TABLE)
        .select(APPLICATION_SELECT)
        .eq("id", applicationId)
        .maybeSingle();
      if (loadError) throw loadError;
      if (!application) {
        return json(404, { error: "Application not found." });
      }

      const reviewEntry = {
        status: nextStatus,
        decision,
        notes: body.review_notes || body.notes || "",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        admin_role: admin.role
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
        action: "platform_admin_review",
        metadata: { decision, status: nextStatus, admin_role: admin.role }
      });

      await writeAdminAudit(client, user.id, application.florist_shop_id, "marketplace_verification_review", {
        application_id: applicationId,
        decision,
        status: nextStatus
      });

      await enqueueVerificationEmail(client, {
        userId: application.user_id,
        recipientEmail: body.recipient_email || null,
        eventType: `verification_${nextStatus}`,
        applicationId,
        payload: { decision, status: nextStatus, review_notes: reviewEntry.notes }
      });

      const sanitizedApplication = await sanitizeApplicationRecord(client, updated);
      return json(200, { application: sanitizedApplication });
    }

    return methodNotAllowed();
  } catch (error) {
    if (isMissingVerificationTableError(error)) {
      return platformAdminErrorResponse(
        event,
        platformAdminError("verification_schema_unavailable")
      );
    }
    return platformAdminErrorResponse(event, error);
  }
}
