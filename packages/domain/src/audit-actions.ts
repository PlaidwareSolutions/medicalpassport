/**
 * Audit event taxonomy (dot-namespaced). Every PHI read/write path emits one
 * of these via @medpass/audit. Adding an action here is reviewed like an API
 * change — dashboards and audit-completeness tests key off these names.
 */
export const AUDIT_ACTIONS = [
  "auth.otp_requested",
  "auth.otp_verified",
  "auth.otp_failed",
  "auth.otp_locked",
  "auth.session_created",
  "auth.session_refreshed",
  "auth.session_revoked",
  "profile.created",
  "profile.updated",
  "profile.viewed_by_caregiver",
  "consent.granted",
  "consent.revoked",
  "consent.enforced",
  "caregiver.invited",
  "caregiver.accepted",
  "caregiver.scope_changed",
  "caregiver.revoked",
  "caregiver.access_used",
  "caregiver.dependent_created",
  "allergy.created",
  "allergy.updated",
  "condition.created",
  "condition.updated",
  "medication.created",
  "medication.updated",
  "medication.status_changed",
  "medication.deleted",
  "medication.list_viewed",
  "medication.refill_recorded",
  "dose.recorded",
  "document.upload_authorized",
  "document.upload_completed",
  "document.downloaded",
  "extraction.processed",
  "extraction.field_confirmed",
  "extraction.field_rejected",
  "safety.evaluation_completed",
  "finding.viewed",
  "finding.acknowledged",
  "finding.action_recorded",
  "share.created",
  "share.accessed",
  "share.revoked",
  "notification.preferences_updated",
  "notification.dismissed",
  "data.export_requested",
  "data.deletion_requested",
  "admin.audit_searched",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditActorType = "patient" | "caregiver" | "admin" | "system" | "share_visitor";
