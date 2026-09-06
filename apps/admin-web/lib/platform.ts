"use client";
import { ApiError } from "@medpass/api-client";
import { useAdminSession } from "./session";

/**
 * Shared shapes for the V2 admin-platform pages (docs_v2/14 §3) — mirrors
 * of apps/api/src/modules/admin-platform/*. Every id is opaque; none of
 * these shapes ever carries a clinical value or a person's name.
 */

export function errorText(err: unknown): string {
  return err instanceof ApiError ? err.problem.title : "Something went wrong";
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

export function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("en-IN") : "—";
}

/** True when the session carries `duty` (super_admin implies every duty) — the same rule AdminShell applies to the nav. */
export function useHasDuty(duty: string): boolean {
  const { admin } = useAdminSession();
  const duties = admin?.duties ?? [];
  return duties.includes(duty) || duties.includes("super_admin");
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface FeatureFlagRow {
  key: string;
  description: string | null;
  defaultOn: boolean;
  rolloutPercent: number;
  allowProfileIds: string[];
  environment: string | null;
  updatedByAdminId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  source: "row" | "static";
}

export const SUPPORT_CASE_STATUSES = ["open", "waiting_on_patient", "resolved", "closed"] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];
export const SUPPORT_CASE_CHANNELS = ["in_app", "email", "phone", "whatsapp", "provider"] as const;

export function supportStatusTone(status: string): "default" | "success" | "warning" | "danger" {
  if (status === "open") return "warning";
  if (status === "resolved" || status === "closed") return "success";
  return "default";
}

export interface SupportCaseRow {
  id: string;
  subject: string;
  status: SupportCaseStatus;
  channel: string;
  patientProfileId: string | null;
  openedByUserId: string | null;
  assignedAdminId: string | null;
  noteCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupportCaseNote {
  id: string;
  authorAdminId: string | null;
  body: string;
  createdAt: string;
}

export interface BreakGlassGrant {
  id: string;
  adminUserId: string;
  patientProfileId: string;
  reason?: string;
  supportCaseId?: string | null;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  patientNotifiedAt?: string | null;
  active: boolean;
}

export interface SupportCaseDetail extends SupportCaseRow {
  notes: SupportCaseNote[];
  breakGlassGrants: BreakGlassGrant[];
}

export interface ConsentAudit {
  profileId: string;
  profileDeleted: boolean;
  consents: Array<{
    id: string;
    type: string;
    purpose: string;
    status: string;
    grantedAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    events: Array<{ id: string; event: string; occurredAt: string; actorType: string }>;
  }>;
  abdmConsents: Array<{
    id: string;
    purposeCode: string;
    hiTypes: string[];
    status: string;
    dateRangeFrom: string | null;
    dateRangeTo: string | null;
    dataEraseAt: string | null;
    grantedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }>;
  timeline: Array<{ at: string; source: "consent" | "abdm"; id: string; event: string; type: string; actorType: string }>;
}

export interface DocumentsStatus {
  windowDays: number;
  funnel: { uploaded: number; classified: number; extracted: number; confirmed: number };
  pendingUpload: number;
  quarantined: number;
  /** Quarantines decided by the worker malware scan (docs_v2/06 P3-3); the rest are upload-time signature mismatches. */
  malwareQuarantined?: number;
  byStatus: Record<string, number>;
  byClassifiedBy: Record<string, number>;
  candidatesByStatus: Record<string, number>;
  failuresByEngine: Array<{ engine: string; engineVersion: string; count: number }>;
}

export interface AbdmTransactionRow {
  id: string;
  patientProfileId: string | null;
  kind: string;
  direction: string;
  status: string;
  requestId: string | null;
  transactionId: string | null;
  correlationId: string | null;
  errorCode: string | null;
  errorText: string | null;
  gatewayEnv: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface FhirFailureRow {
  id: string;
  bundleId: string | null;
  direction: string;
  igVersion: string;
  profileUrl: string | null;
  resourceType: string;
  path: string;
  severity: string;
  message: string;
  createdAt: string;
}

export interface IntegrationRow {
  key: string;
  label: string;
  health: "configured" | "not_configured" | "none" | "mock";
  version: string | null;
  lastSuccessAt: string | null;
  lastSuccessSource: string | null;
  note: string | null;
}

export interface NotificationFailures {
  windowDays: number;
  failedTotal: number;
  byChannel: Record<string, number>;
  byKind: Record<string, number>;
  byChannelAndKind: Record<string, Record<string, number>>;
  topErrors: Record<string, Array<{ errorDigest: string; count: number }>>;
  attemptsByChannelAndStatus: Array<{ channel: string; status: string; count: number }>;
  cancelledByKind: Record<string, number>;
}
