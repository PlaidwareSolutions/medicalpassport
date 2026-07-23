import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { adminAuditSearchSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";

/** Admin audit search (docs/06, docs/13, docs/21) — read access to the
 * append-only, hash-chained AuditEvent log, itself audited on every use. */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/audit")
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async search(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "search_audit");
    const input = parseWith(adminAuditSearchSchema, query);

    const items = await this.prisma.auditEvent.findMany({
      where: {
        action: input.action,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        patientProfileId: input.patientProfileId,
        correlationId: input.correlationId,
        occurredAt: input.from || input.to ? { gte: input.from, lte: input.to } : undefined,
      },
      orderBy: { seq: "desc" },
      take: input.limit + 1,
      ...(input.cursor !== undefined ? { cursor: { seq: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > input.limit;
    const page = hasMore ? items.slice(0, input.limit) : items;

    await writeAudit(this.prisma, {
      action: "admin.audit_searched",
      actorUserId: req.adminAuth!.adminUserId,
      actorType: "admin",
      correlationId: req.correlationId,
      context: {
        action: input.action,
        actorType: input.actorType,
        entityType: input.entityType,
        patientProfileId: input.patientProfileId,
      },
    });

    return {
      items: page.map((e) => ({ ...e, seq: e.seq.toString() })),
      nextCursor: hasMore ? page[page.length - 1]!.seq.toString() : null,
    };
  }
}
