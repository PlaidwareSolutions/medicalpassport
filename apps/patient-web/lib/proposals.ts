"use client";
import { useCallback, useRef, useState } from "react";
import type { MessageKey } from "@medpass/localization";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { invalidateHealthTimeline } from "./health-timeline";
import { invalidateMedicationData } from "./medications";

/**
 * The patient's "Proposals" inbox (docs_v2/05 §11, docs_v2/06 P11-5,
 * ADR-V2-009 "providers propose, patients accept"). Nothing a clinic,
 * pharmacy, laboratory or hospital sends touches the record until the
 * patient accepts it here, and a transition's lines are decided one at a
 * time (H-43) rather than as one yes/no over the whole thing.
 */

export const PROPOSAL_KINDS = ["reconciliation", "prescription", "encounter", "dispense", "diagnostic_report", "discharge_transition"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export type ProposalStatus = "proposed" | "accepted" | "rejected" | "withdrawn" | "expired";

export const LINE_DECISIONS = ["START", "CONTINUE", "CHANGE", "STOP"] as const;
export type LineDecision = (typeof LINE_DECISIONS)[number];

export interface ProposalOrganization {
  id: string;
  displayName: string;
  kind: string;
}

export interface ProposedInstruction {
  doseQuantity: number | string;
  doseUnit: string;
  frequencyCode: string;
  pattern?: string | null;
  foodInstruction?: string | null;
  durationDays?: number | null;
}

/** One transition line exactly as `reconciliationLineSchema` validates it. */
export interface ProposalLine {
  decision: LineDecision;
  patientMedicationId?: string | null;
  proposedName?: string | null;
  productId?: string | null;
  proposedInstruction?: ProposedInstruction | null;
  reasonText?: string | null;
}

export interface ReconciliationPayload {
  notes?: string | null;
  practitionerName?: string;
  lines: ProposalLine[];
}

export interface DischargePayload extends ReconciliationPayload {
  admittedAt: string;
  dischargedAt: string;
  diagnosisText?: string | null;
  summaryText?: string | null;
  followUpOn?: string | null;
}

export interface PrescriptionItemPayload {
  enteredName: string;
  strengthLabel?: string | null;
  formText?: string | null;
  doseQuantity?: number | string | null;
  doseUnit?: string | null;
  frequencyCode?: string | null;
  pattern?: string | null;
  foodInstruction?: string | null;
  durationDays?: number | null;
  routeText?: string | null;
  text?: string | null;
}

export interface PrescriptionPayload {
  practitionerName?: string;
  prescribedAt?: string;
  notes?: string | null;
  diagnosisText?: string | null;
  validUntil?: string | null;
  followUpOn?: string | null;
  items: PrescriptionItemPayload[];
}

export interface EncounterPayload {
  kind: string;
  startedAt: string;
  endedAt?: string | null;
  practitionerName?: string;
  reasonText?: string | null;
  diagnosisText?: string | null;
  notes?: string | null;
  followUpOn?: string | null;
}

export interface DispensePayload {
  patientMedicationId?: string | null;
  medicineName: string;
  dispensedAt: string;
  quantity: number;
  unit: string;
  daysSupply?: number | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
}

export interface DiagnosticResultPayload {
  analyteLabelText?: string | null;
  enteredValueText?: string | null;
  enteredUnit?: string | null;
  referenceText?: string | null;
}

export interface DiagnosticReportPayload {
  title: string;
  testedAt?: string | null;
  reportedAt?: string | null;
  facilityNameText?: string | null;
  results: DiagnosticResultPayload[];
}

export interface ProposalDto {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  linkId: string;
  organization: ProposalOrganization;
  payload: unknown;
  proposedAt: string;
  decidedAt: string | null;
  resultingEntityType: string | null;
  resultingEntityId: string | null;
  updatedAt: string;
  /** Present on the accept response only — what the accepted lines actually did. */
  applied?: Record<string, unknown>;
}

interface ProposalsPage {
  items: ProposalDto[];
  nextCursor: string | null;
}

const PROPOSALS_PATH = "/profiles/current/proposals";

function pagePath(status: ProposalStatus | undefined, cursor?: string): string {
  const params = new URLSearchParams({ limit: "50" });
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  return `${PROPOSALS_PATH}?${params.toString()}`;
}

function fetchPage(status: ProposalStatus | undefined, cursor?: string): Promise<ProposalsPage> {
  return api.get<ProposalsPage>(pagePath(status, cursor), { profileId: getActiveProfileId() });
}

/**
 * The inbox list. A caregiver whose scopes don't reach the proposal kinds
 * still sees the screen (403 → empty) rather than an error page — the same
 * shape `useCaregiverAlerts` uses.
 */
export function useProposals(status: ProposalStatus | undefined = "proposed") {
  const firstPath = pagePath(status);
  const first = useSharedResource<ProposalsPage>({
    path: firstPath,
    fetcher: () => fetchPage(status),
    mapApiError: (err) => (err.status === 403 ? { items: [], nextCursor: null } : undefined),
  });

  const [more, setMore] = useState<{ forPath: string; items: ProposalDto[]; nextCursor: string | null }>({
    forPath: firstPath,
    items: [],
    nextCursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);

  const extra = more.forPath === firstPath ? more : { forPath: firstPath, items: [], nextCursor: null };
  const nextCursor = extra.items.length > 0 ? extra.nextCursor : (first.data?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchPage(status, nextCursor);
      setMore((prev) => ({
        forPath: firstPath,
        items: [...(prev.forPath === firstPath ? prev.items : []), ...page.items],
        nextCursor: page.nextCursor,
      }));
    } catch {
      /* the "Show more" button stays; the list already on screen is unaffected */
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, firstPath, status]);

  const seen = new Set<string>();
  const items = first.data
    ? [...first.data.items, ...extra.items].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    : undefined;

  return { items, error: first.error, fromCache: first.fromCache, reload: first.reload, hasMore: nextCursor !== null, loadMore, loadingMore };
}

export function useProposal(id: string) {
  const { data, error, reload } = useSharedResource<ProposalDto>({
    path: `/proposals/${id}`,
    fetcher: () => api.get<ProposalDto>(`/proposals/${id}`, { profileId: getActiveProfileId() }),
  });
  return { proposal: data, error, reload };
}

/** Everything an accepted proposal can have changed behind the screens. */
function invalidateAfterDecision(): void {
  invalidate("profile", PROPOSALS_PATH);
  invalidate("profile", "/proposals/");
  invalidateMedicationData();
  invalidateHealthTimeline();
  invalidate("profile", "/profiles/current/prescriptions");
  invalidate("profile", "/profiles/current/diagnostic-reports");
  invalidate("profile", "/profiles/current/encounters");
}

/** Step-up guarded (ADR-V2-012). `declinedLines` are indexes into `payload.lines` (H-43). */
export async function acceptProposal(id: string, declinedLines: number[] = []): Promise<ProposalDto> {
  const res = await api.post<ProposalDto>(`/proposals/${id}/accept`, { declinedLines }, { profileId: getActiveProfileId() });
  invalidateAfterDecision();
  return res;
}

export async function rejectProposal(id: string, reason?: string): Promise<ProposalDto> {
  const body = reason && reason.trim().length > 0 ? { reason: reason.trim() } : {};
  const res = await api.post<ProposalDto>(`/proposals/${id}/reject`, body, { profileId: getActiveProfileId() });
  invalidateAfterDecision();
  return res;
}

// ───────────────────────── payload readers ─────────────────────────

/** The lines of a transition, or an empty list for the kinds that have none. */
export function proposalLines(p: Pick<ProposalDto, "kind" | "payload">): ProposalLine[] {
  if (p.kind !== "reconciliation" && p.kind !== "discharge_transition") return [];
  const lines = (p.payload as ReconciliationPayload | null)?.lines;
  return Array.isArray(lines) ? lines : [];
}

/** Counts by decision, in START / CONTINUE / CHANGE / STOP order. */
export function lineCounts(lines: readonly ProposalLine[]): Record<LineDecision, number> {
  const counts: Record<LineDecision, number> = { START: 0, CONTINUE: 0, CHANGE: 0, STOP: 0 };
  for (const line of lines) if (counts[line.decision] !== undefined) counts[line.decision] += 1;
  return counts;
}

export function kindLabelKey(kind: ProposalKind): MessageKey {
  return `proposals.kind.${kind}` as MessageKey;
}

export function decisionTitleKey(decision: LineDecision): MessageKey {
  return `proposals.decision.${decision.toLowerCase()}_title` as MessageKey;
}

export function decisionBodyKey(decision: LineDecision): MessageKey {
  return `proposals.decision.${decision.toLowerCase()}_body` as MessageKey;
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * One plain-language sentence for the inbox row: what this proposal would
 * change if it were accepted as it stands. Never a verb the patient has to
 * decode ("reconciliation"), and never a claim that anything already
 * happened.
 */
export function proposalSummary(p: ProposalDto, t: Translate): string {
  switch (p.kind) {
    case "reconciliation":
    case "discharge_transition": {
      const counts = lineCounts(proposalLines(p));
      const parts: string[] = [];
      if (counts.START > 0) parts.push(t("proposals.summary.start", { n: counts.START }));
      if (counts.CONTINUE > 0) parts.push(t("proposals.summary.continue", { n: counts.CONTINUE }));
      if (counts.CHANGE > 0) parts.push(t("proposals.summary.change", { n: counts.CHANGE }));
      if (counts.STOP > 0) parts.push(t("proposals.summary.stop", { n: counts.STOP }));
      return parts.length > 0 ? parts.join(" · ") : t("proposals.summary.no_lines");
    }
    case "prescription": {
      const items = (p.payload as PrescriptionPayload | null)?.items;
      return t("proposals.summary.prescription", { n: Array.isArray(items) ? items.length : 0 });
    }
    case "encounter":
      return t("proposals.summary.encounter");
    case "dispense": {
      const payload = p.payload as DispensePayload | null;
      return payload
        ? t("proposals.summary.dispense", { name: payload.medicineName, quantity: payload.quantity, unit: payload.unit })
        : t("proposals.summary.dispense_plain");
    }
    case "diagnostic_report": {
      const payload = p.payload as DiagnosticReportPayload | null;
      return t("proposals.summary.report", { title: payload?.title ?? "", n: payload?.results?.length ?? 0 });
    }
    default:
      return "";
  }
}

/** Where an accepted proposal's new record lives, when the app has a screen for it. */
export function resultHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "prescription":
      return `/prescriptions/${entityId}`;
    case "diagnostic_report":
      return `/reports/${entityId}`;
    case "encounter":
      return `/health/visits/${entityId}`;
    case "medication_reconciliation":
    case "medication_dispense":
      // Neither has a screen of its own; both are visible as what they did
      // to the medicines list and as a row on the health timeline.
      return "/health";
    default:
      return null;
  }
}

export function resultLabelKey(entityType: string | null): MessageKey {
  switch (entityType) {
    case "prescription":
      return "proposals.result.prescription";
    case "diagnostic_report":
      return "proposals.result.diagnostic_report";
    case "encounter":
      return "proposals.result.encounter";
    case "medication_dispense":
      return "proposals.result.medication_dispense";
    default:
      return "proposals.result.medication_reconciliation";
  }
}
