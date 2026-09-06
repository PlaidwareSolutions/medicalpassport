import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { documentsStatusQuerySchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";

/**
 * Document processing funnel (docs_v2/14 §3, operations_view): counts of
 * documents that reached each stage — uploaded → classified → extracted →
 * confirmed — over a trailing window, plus failures by engine. Counts and
 * engine names only: never a title, a page, a candidate value, or a
 * profile id. Not audited, same reasoning as admin/operations (aggregate
 * only).
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/documents")
export class AdminDocumentsStatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("status")
  async status(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_operations");
    const { days } = parseWith(documentsStatusQuerySchema, query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const live = { deletedAt: null, createdAt: { gte: since } } as const;

    const [uploaded, classified, extracted, confirmed, byStatus, byClassifiedBy, failuresByEngine, candidatesByStatus, pendingUpload, quarantined, malwareQuarantined] = await Promise.all([
      this.prisma.patientDocument.count({ where: { ...live, status: { in: ["uploaded", "verified", "processing", "processed", "failed"] } } }),
      this.prisma.patientDocument.count({ where: { ...live, classification: { not: null } } }),
      this.prisma.patientDocument.count({ where: { ...live, extractions: { some: { status: "succeeded" } } } }),
      this.prisma.patientDocument.count({ where: { ...live, extractions: { some: { candidates: { some: { status: { in: ["confirmed", "corrected"] } } } } } } }),
      this.prisma.patientDocument.groupBy({ by: ["status"], where: live, _count: true }),
      this.prisma.patientDocument.groupBy({ by: ["classifiedBy"], where: { ...live, classifiedBy: { not: null } }, _count: true }),
      this.prisma.documentExtraction.groupBy({ by: ["engine", "engineVersion"], where: { status: "failed", createdAt: { gte: since } }, _count: true }),
      this.prisma.documentCandidate.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.patientDocument.count({ where: { ...live, status: "pending_upload" } }),
      this.prisma.patientDocument.count({ where: { ...live, status: "quarantined" } }),
      // docs_v2/06 P3-3: quarantines decided by the worker's malware scan (signature
      // mismatches at upload are the remainder of `quarantined`). Audit rows only, no PHI.
      this.prisma.auditEvent.count({ where: { action: "document.quarantined", occurredAt: { gte: since } } }),
    ]);

    const toRecord = <K extends string>(rows: Array<{ _count: number } & Record<K, unknown>>, key: K) =>
      rows.reduce<Record<string, number>>((acc, row) => {
        acc[String(row[key])] = row._count;
        return acc;
      }, {});

    return {
      windowDays: days,
      funnel: { uploaded, classified, extracted, confirmed },
      pendingUpload,
      quarantined,
      malwareQuarantined,
      byStatus: toRecord(byStatus, "status"),
      byClassifiedBy: toRecord(byClassifiedBy, "classifiedBy"),
      candidatesByStatus: toRecord(candidatesByStatus, "status"),
      failuresByEngine: failuresByEngine.map((f) => ({ engine: f.engine, engineVersion: f.engineVersion, count: f._count })),
    };
  }
}
