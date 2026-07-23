import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { adminFindingsSearchSchema } from "@medpass/validation";
import { RULE_VERSIONS } from "../safety/safety-rules";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { parseWith } from "../../common/zod";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";

/**
 * Read-only Rules/Findings review (docs/06 "safety rules, versions,
 * review", docs/23 E7.4). Rule *editing* stays blocked on OD-6 (no clinical
 * lead appointed to be the checker) — this is purely a traceability
 * browser over data that's already fully recorded per finding.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin")
export class AdminRulesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("rules")
  listRules(@Req() req: ApiRequest) {
    requireAdminDuty(req, "view_rules");
    return { items: Object.entries(RULE_VERSIONS).map(([name, rule]) => ({ name, ...rule })) };
  }

  @Get("findings")
  async listFindings(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_rules");
    const input = parseWith(adminFindingsSearchSchema, query);
    await writeAudit(this.prisma, {
      action: "admin.findings_viewed",
      actorUserId: req.adminAuth!.adminUserId,
      actorType: "admin",
      patientProfileId: input.patientProfileId,
      correlationId: req.correlationId,
      context: { status: input.status, severity: input.severity, ruleKey: input.ruleKey },
    });

    const items = await this.prisma.safetyFinding.findMany({
      where: {
        status: input.status,
        severity: input.severity,
        category: input.category,
        ruleKey: input.ruleKey,
        patientProfileId: input.patientProfileId,
        evaluatedAt: input.from || input.to ? { gte: input.from, lte: input.to } : undefined,
      },
      orderBy: { evaluatedAt: "desc" },
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > input.limit;
    const page = hasMore ? items.slice(0, input.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  @Get("findings/:id")
  async findingDetail(@Param("id") id: string, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_rules");
    const finding = await this.prisma.safetyFinding.findUnique({
      where: { id },
      include: { actions: { orderBy: { occurredAt: "desc" } }, evaluation: true },
    });
    if (!finding) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Finding not found", 404);
    await writeAudit(this.prisma, {
      action: "admin.findings_viewed",
      actorUserId: req.adminAuth!.adminUserId,
      actorType: "admin",
      entityType: "safety_finding",
      entityId: id,
      patientProfileId: finding.patientProfileId,
      correlationId: req.correlationId,
    });
    return finding;
  }
}
