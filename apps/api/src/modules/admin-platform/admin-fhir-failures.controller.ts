import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { fhirValidationFailuresQuerySchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";

/**
 * FHIR validation failures (docs_v2/14 §3, fhir_view): what the validator
 * rejected, by direction / IG version / profile / resource path. The
 * validator writes structural messages (path + rule), never element
 * values, so this is a conformance dashboard rather than a data view;
 * the bundle id is opaque.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/fhir")
export class AdminFhirFailuresController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("validation-failures")
  async list(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_fhir");
    const input = parseWith(fhirValidationFailuresQuerySchema, query);
    const where = { direction: input.direction, severity: input.severity, resourceType: input.resourceType, igVersion: input.igVersion };
    const [rows, byResourceType, bySeverity] = await Promise.all([
      this.prisma.fhirValidationFailure.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      }),
      this.prisma.fhirValidationFailure.groupBy({ by: ["resourceType"], where, _count: true }),
      this.prisma.fhirValidationFailure.groupBy({ by: ["severity"], where, _count: true }),
    ]);
    const page = rows.slice(0, input.limit);
    return {
      items: page.map((f) => ({
        id: f.id,
        bundleId: f.bundleId,
        direction: f.direction,
        igVersion: f.igVersion,
        profileUrl: f.profileUrl,
        resourceType: f.resourceType,
        path: f.path,
        severity: f.severity,
        message: f.message,
        createdAt: f.createdAt.toISOString(),
      })),
      nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      totals: {
        byResourceType: Object.fromEntries(byResourceType.map((r) => [r.resourceType, r._count])),
        bySeverity: Object.fromEntries(bySeverity.map((s) => [s.severity, s._count])),
      },
    };
  }
}
