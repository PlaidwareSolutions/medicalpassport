import { Injectable } from "@nestjs/common";
import { getAnalyte } from "@medpass/terminology";
import { PrismaService } from "../../common/prisma.service";
import { ALL_SECTIONS, VisitSummaryService, type VisitSummaryDto, type VisitSummarySections } from "./visit-summary.service";

/**
 * The concise clinician view (docs_v2/05 §9, docs_v2/04 §11 "DoctorSnapshot
 * is a view, materialized per request"). Same data as the visit summary,
 * arranged the way a doctor reads in the first minute of a consult: what
 * the patient takes now, what they must not be given, what they live with,
 * what changed recently, the latest number for each test, the last month
 * of home measurements, and which documents exist.
 *
 * Hazard H-33: `recentChanges` is read from HealthEvent but the projection
 * here carries neither `actorType` nor `caregiver_action` events — a share
 * recipient learns what changed, never who in the family changed it.
 */
export interface DoctorSnapshotDto {
  profile: VisitSummaryDto["profile"];
  generatedAt: string;
  currentMedications?: NonNullable<VisitSummaryDto["currentMedications"]>;
  allergies?: NonNullable<VisitSummaryDto["allergies"]>;
  majorConditions?: Array<{ label: string; clinicalStatus: string | null; onsetDate: string | null; note: string | null }>;
  /** Prescription and medicine events from the timeline, last 90 days, newest first. */
  recentChanges?: Array<{ kind: string; occurredAt: string; summary: unknown }>;
  /** The most recent live (non-superseded) value per analyte, in the canonical unit where one exists. */
  latestResults?: Array<{
    analyteKey: string;
    label: string;
    value: string;
    unit: string | null;
    comparator: string | null;
    referenceText: string | null;
    interpretation: string | null;
    at: string;
    reportTitle: string;
  }>;
  measurements?: NonNullable<VisitSummaryDto["measurements"]>;
  documents?: NonNullable<VisitSummaryDto["documents"]>;
}

const RECENT_DAYS = 90;
const RECENT_CHANGES_LIMIT = 30;
/** Bounds the reduce below; a patient with more live results than this still gets the newest per analyte in practice. */
const RESULT_SCAN_LIMIT = 1000;
const CHANGE_KINDS = [
  "prescription",
  "medicine_started",
  "medicine_changed",
  "medicine_stopped",
  "medicine_paused",
  "medicine_resumed",
  "medicine_completed",
] as const;

const NO_SECTIONS = Object.fromEntries(Object.keys(ALL_SECTIONS).map((k) => [k, false])) as unknown as VisitSummarySections;

/**
 * Timeline summaries carry row ids (`medicationId`, `linkedPrescriptionId`,
 * …) so the app can deep-link; a share recipient has no use for them and
 * the public payload carries no internal handles (Stage-7 data
 * minimization). Strips every id-shaped key, recursively.
 */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key === "id" || /Id$/.test(key)) continue;
    out[key] = withoutIds(inner);
  }
  return out;
}

@Injectable()
export class DoctorSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visitSummary: VisitSummaryService,
  ) {}

  /**
   * `sections` uses the share vocabulary: medications → currentMedications,
   * allergies, conditions → majorConditions, recentChanges, reports →
   * latestResults, measurements, documents. Everything else on the share
   * (glucose diary, check-ups, prescriptions list…) belongs to the fuller
   * visit summary and is not repeated here.
   */
  async build(profileId: string, sections: VisitSummarySections): Promise<DoctorSnapshotDto> {
    const base = await this.visitSummary.build(profileId, {
      ...NO_SECTIONS,
      medications: !!sections.medications,
      allergies: !!sections.allergies,
      measurements: !!sections.measurements,
      documents: !!sections.documents,
    });
    const snapshot: DoctorSnapshotDto = { profile: base.profile, generatedAt: base.generatedAt };
    if (base.currentMedications) snapshot.currentMedications = base.currentMedications;
    if (base.allergies) snapshot.allergies = base.allergies;
    if (base.measurements) snapshot.measurements = base.measurements;
    if (base.documents) snapshot.documents = base.documents;

    await Promise.all([
      this.addConditions(profileId, sections, snapshot),
      this.addRecentChanges(profileId, sections, snapshot),
      this.addLatestResults(profileId, sections, snapshot),
    ]);
    return snapshot;
  }

  private async addConditions(profileId: string, sections: VisitSummarySections, out: DoctorSnapshotDto): Promise<void> {
    if (!sections.conditions) return;
    const rows = await this.prisma.patientCondition.findMany({
      where: { patientProfileId: profileId, active: true, deletedAt: null },
      orderBy: [{ onsetDate: "desc" }, { createdAt: "desc" }],
      select: { label: true, clinicalStatus: true, onsetDate: true, note: true },
    });
    out.majorConditions = rows.map((c) => ({
      label: c.label,
      clinicalStatus: c.clinicalStatus,
      onsetDate: c.onsetDate?.toISOString().slice(0, 10) ?? null,
      note: c.note,
    }));
  }

  private async addRecentChanges(profileId: string, sections: VisitSummarySections, out: DoctorSnapshotDto): Promise<void> {
    if (!sections.recentChanges) return;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const events = await this.prisma.healthEvent.findMany({
      where: { patientProfileId: profileId, supersededAt: null, kind: { in: [...CHANGE_KINDS] }, occurredAt: { gte: cutoff } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: RECENT_CHANGES_LIMIT,
      // No actorType / actorUserId on purpose (H-33).
      select: { kind: true, occurredAt: true, summary: true },
    });
    out.recentChanges = events.map((e) => ({ kind: e.kind, occurredAt: e.occurredAt.toISOString(), summary: withoutIds(e.summary) }));
  }

  private async addLatestResults(profileId: string, sections: VisitSummarySections, out: DoctorSnapshotDto): Promise<void> {
    if (!sections.reports) return;
    const rows = await this.prisma.diagnosticResult.findMany({
      where: { patientProfileId: profileId, deletedAt: null, supersededById: null, diagnosticReport: { deletedAt: null } },
      include: { diagnosticReport: { select: { title: true, testedAt: true, reportedAt: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
      take: RESULT_SCAN_LIMIT,
    });
    const latest = new Map<string, (typeof rows)[number] & { at: Date }>();
    for (const r of rows) {
      const at = r.diagnosticReport.testedAt ?? r.diagnosticReport.reportedAt ?? r.diagnosticReport.createdAt;
      // `other` is many different tests; key it by its free-text label so two unrelated "other" values never shadow each other.
      const key = r.analyteKey === "other" ? `other:${r.analyteLabelText ?? ""}` : r.analyteKey;
      const current = latest.get(key);
      if (!current || at > current.at || (at.getTime() === current.at.getTime() && r.createdAt > current.createdAt)) {
        latest.set(key, { ...r, at });
      }
    }
    out.latestResults = [...latest.values()]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map((r) => {
        const analyte = getAnalyte(r.analyteKey);
        return {
          analyteKey: r.analyteKey,
          label: r.analyteKey === "other" ? (r.analyteLabelText ?? "Other test value") : (analyte?.display ?? r.analyteKey),
          // Canonical value when the unit could be resolved, else exactly what the paper said (H-35/H-39).
          value: r.unit && r.valueNumeric != null ? r.valueNumeric.toString() : r.enteredValueText,
          unit: r.unit ?? r.enteredUnit ?? null,
          comparator: r.comparator,
          referenceText: r.referenceText,
          interpretation: r.interpretation,
          at: r.at.toISOString(),
          reportTitle: r.diagnosticReport.title,
        };
      });
  }
}
