import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { CreateReportInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

interface Actor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
}

/** Prisma transaction client — the subset this service actually uses. */
type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/**
 * Test reports (docs/07 screen 44) — blood/urine panels, imaging, ECGs,
 * biopsies, discharge summaries. Document-first: the uploaded report is the
 * record, with free-text notes alongside. Individual analyte values are
 * deliberately not stored (see the MedicalReport schema comment).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Same case-insensitive per-profile dedup prescriptions use, so a doctor
   * named on a report and on a prescription resolves to one record.
   */
  private async resolvePractitioner(tx: Tx, profileId: string, practitionerName: string | undefined): Promise<string | null> {
    const displayName = practitionerName?.trim();
    if (!displayName) return null;
    const existing = await tx.practitioner.findFirst({
      where: { createdByProfileId: profileId, displayName: { equals: displayName, mode: "insensitive" }, deletedAt: null },
    });
    if (existing) return existing.id;
    const created = await tx.practitioner.create({ data: { displayName, createdByProfileId: profileId } });
    return created.id;
  }

  async create(profileId: string, input: CreateReportInput, actor: Actor) {
    const report = await this.prisma.$transaction(async (tx) => {
      const practitionerId = await this.resolvePractitioner(tx, profileId, input.practitionerName);
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
      include: { practitioner: true, _count: { select: { documents: true } } },
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
        documents: { orderBy: { createdAt: "asc" }, include: { storedObject: { select: { status: true } } } },
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
    };
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
