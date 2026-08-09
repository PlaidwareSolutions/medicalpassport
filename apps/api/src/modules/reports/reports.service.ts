import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, REPORT_ANALYTE_IDS, reportAnalyteById } from "@medpass/domain";
import { parseReportNumericValue, type AddReportValueInput, type CreateReportInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { PractitionersService } from "../practitioners/practitioners.service";

interface Actor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
}

interface ReportValueRow {
  id: string;
  analyte: string;
  otherLabel: string | null;
  enteredValue: string;
  numericValue: { toString(): string } | null;
  referenceText: string | null;
  createdAt: Date;
}

/** Display label + canonical unit resolved from the closed vocabulary; `other` uses its own label. */
function mapValue(v: ReportValueRow) {
  const analyte = reportAnalyteById(v.analyte);
  return {
    id: v.id,
    analyte: v.analyte,
    label: v.analyte === "other" ? (v.otherLabel ?? "Other test value") : (analyte?.label ?? v.analyte),
    unit: analyte?.unit ?? null,
    enteredValue: v.enteredValue,
    // Prisma Decimal serializes as an object over JSON — stringify explicitly.
    numericValue: v.numericValue?.toString() ?? null,
    referenceText: v.referenceText,
    createdAt: v.createdAt.toISOString(),
  };
}

/** Vocabulary order (the order panels print in), then entry order within an analyte. */
function sortValuesByVocabulary<T extends ReportValueRow>(values: T[]): T[] {
  const order = new Map(REPORT_ANALYTE_IDS.map((id, i) => [id, i]));
  return [...values].sort((a, b) => {
    const oa = order.get(a.analyte) ?? Number.MAX_SAFE_INTEGER;
    const ob = order.get(b.analyte) ?? Number.MAX_SAFE_INTEGER;
    return oa - ob || a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/** Prisma transaction client — the subset this service actually uses. */
type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/**
 * Test reports (docs/07 screen 44) — blood/urine panels, imaging, ECGs,
 * biopsies, discharge summaries. Document-first: the uploaded report is the
 * record, with free-text notes alongside — plus structured values as a
 * closed-vocabulary transcription layer (see the ReportValue schema
 * comment): entered text immutable, parsed numeric twin for trending only,
 * reference ranges display-only and never compared (docs/02).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly practitioners: PractitionersService,
  ) {}

  async create(profileId: string, input: CreateReportInput, actor: Actor) {
    const report = await this.prisma.$transaction(async (tx) => {
      const practitionerId = await this.practitioners.resolve(tx, profileId, input.practitionerName);
      const created = await tx.medicalReport.create({
        data: {
          patientProfileId: profileId,
          kind: input.kind,
          label: input.label,
          facilityName: input.facilityName,
          practitionerId,
          testedAt: input.testedAt,
          notes: input.notes,
        },
      });
      await writeAudit(tx, {
        action: "report.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "medical_report",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { kind: input.kind },
      });
      return created;
    });
    return (await this.byId(profileId, report.id))!;
  }

  async list(profileId: string) {
    const reports = await this.prisma.medicalReport.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      // Same rule as prescriptions: a failed upload's deleted stub must not
      // count as a file in the list.
      include: { practitioner: true, _count: { select: { documents: { where: { status: { not: "deleted" } } } } } },
      // Newest test first; one with no date recorded falls back to when it was
      // filed rather than sinking to the bottom of the list forever.
      orderBy: [{ testedAt: "desc" }, { createdAt: "desc" }],
    });
    return reports.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      facilityName: r.facilityName,
      practitionerName: r.practitioner?.displayName ?? null,
      testedAt: r.testedAt?.toISOString().slice(0, 10) ?? null,
      notes: r.notes,
      documentCount: r._count.documents,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async byId(profileId: string, id: string) {
    const report = await this.prisma.medicalReport.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      include: {
        practitioner: true,
        documents: {
          where: { status: { not: "deleted" } },
          orderBy: { createdAt: "asc" },
          include: { storedObject: { select: { status: true } } },
        },
        values: { where: { deletedAt: null } },
      },
    });
    if (!report) return null;
    return {
      id: report.id,
      kind: report.kind,
      label: report.label,
      facilityName: report.facilityName,
      practitionerName: report.practitioner?.displayName ?? null,
      testedAt: report.testedAt?.toISOString().slice(0, 10) ?? null,
      notes: report.notes,
      createdAt: report.createdAt.toISOString(),
      documents: report.documents.map((d) => ({
        id: d.id,
        kind: d.kind,
        status: d.status,
        // Only a verified object can actually be fetched — the UI uses this to
        // avoid offering a download link for an upload that never landed.
        downloadable: d.storedObject.status === "verified",
        createdAt: d.createdAt.toISOString(),
      })),
      values: sortValuesByVocabulary(report.values).map(mapValue),
    };
  }

  /** Guards the summary/PDF blast radius from `other`-spam (docs/31 quota posture). */
  private static readonly MAX_VALUES_PER_REPORT = 50;

  async addValue(profileId: string, reportId: string, input: AddReportValueInput, actor: Actor) {
    const report = await this.prisma.medicalReport.findFirst({
      where: { id: reportId, patientProfileId: profileId, deletedAt: null },
      select: { id: true },
    });
    if (!report) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Report not found", 404);

    const value = await this.prisma.$transaction(async (tx) => {
      const count = await tx.reportValue.count({ where: { reportId, deletedAt: null } });
      if (count >= ReportsService.MAX_VALUES_PER_REPORT) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This report already has the maximum number of values", 400);
      }
      const created = await tx.reportValue.create({
        data: {
          reportId,
          patientProfileId: profileId,
          analyte: input.analyte,
          otherLabel: input.otherLabel,
          enteredValue: input.enteredValue,
          // Derived twin only — display always uses enteredValue verbatim, so
          // a parse bug can never change what a doctor sees.
          numericValue: parseReportNumericValue(input.enteredValue),
          referenceText: input.referenceText,
          recordedByUserId: actor.userId,
        },
      });
      await writeAudit(tx, {
        action: "report_value.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "report_value",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        // The analyte id is not PHI; the value itself never goes in context.
        context: { analyte: input.analyte },
      });
      return created;
    });
    return mapValue(value);
  }

  async deleteValue(profileId: string, id: string, actor: Actor) {
    const value = await this.prisma.reportValue.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!value) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Value not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.reportValue.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAudit(tx, {
        action: "report_value.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "report_value",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { analyte: value.analyte },
      });
    });
  }

  /**
   * One analyte across every report — the trend the structured values exist
   * for. Report values only, never check-up entries (docs/07 screens 42/44:
   * the two surfaces are deliberately never merged or auto-synced).
   */
  async valueHistory(profileId: string, analyte: string) {
    const values = await this.prisma.reportValue.findMany({
      where: { patientProfileId: profileId, analyte, deletedAt: null, report: { deletedAt: null } },
      include: { report: { select: { id: true, kind: true, label: true, facilityName: true, testedAt: true, createdAt: true } } },
    });
    // True coalesce sort, in JS: addReports' orderBy is NOT one — Postgres
    // DESC puts NULL testedAt first, which would pin undated reports to the
    // top of the history forever. Result sets are one analyte for one
    // patient; sorting here is cheap and honest.
    const sorted = values.sort((a, b) => {
      const ta = (a.report.testedAt ?? a.report.createdAt).getTime();
      const tb = (b.report.testedAt ?? b.report.createdAt).getTime();
      return tb - ta || b.createdAt.getTime() - a.createdAt.getTime();
    });
    return sorted.map((v) => ({
      ...mapValue(v),
      reportId: v.report.id,
      reportKind: v.report.kind,
      reportLabel: v.report.label,
      facilityName: v.report.facilityName,
      testedAt: v.report.testedAt?.toISOString().slice(0, 10) ?? null,
      reportCreatedAt: v.report.createdAt.toISOString(),
    }));
  }

  /**
   * Soft-delete only, mirroring medications/prescriptions. The attached
   * documents keep their `reportId` — this app never cascades a soft-delete
   * into child rows, and the uploaded original stays retrievable on its own.
   */
  async softDelete(profileId: string, id: string, actor: Actor) {
    const report = await this.prisma.medicalReport.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!report) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Report not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.medicalReport.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAudit(tx, {
        action: "report.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "medical_report",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
  }
}
