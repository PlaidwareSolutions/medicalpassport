import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { writeAuditDeferred } from "@medpass/audit";
import { breakGlassListQuerySchema, breakGlassRequestSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";
import { BreakGlassService, presentGrant } from "./break-glass.service";

/**
 * `POST/GET admin/break-glass` (docs_v2/05 §13, docs_v2/14 §3 "Security
 * audit … break-glass log"). Granted to audit_search holders; the grant
 * itself is the whole of what this ticket exposes — see BreakGlassService.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/break-glass")
export class AdminBreakGlassController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly breakGlass: BreakGlassService,
  ) {}

  @Post()
  async grant(@Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "grant_break_glass");
    const input = parseWith(breakGlassRequestSchema, body);
    return this.breakGlass.grant(req.adminAuth!.adminUserId, input, req.correlationId);
  }

  /** The break-glass log: every grant, newest first; reading it is itself audited. */
  @Get()
  async list(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_break_glass");
    const input = parseWith(breakGlassListQuerySchema, query);
    const now = new Date();
    const rows = await this.prisma.breakGlassGrant.findMany({
      where: {
        patientProfileId: input.patientProfileId,
        adminUserId: input.adminUserId,
        ...(input.active === true ? { revokedAt: null, expiresAt: { gt: now } } : {}),
        ...(input.active === false ? { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }] } : {}),
      },
      orderBy: [{ grantedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, input.limit);
    await writeAuditDeferred(this.prisma, {
      action: "admin.break_glass_listed",
      actorUserId: req.adminAuth!.adminUserId,
      actorType: "admin",
      correlationId: req.correlationId,
      context: { patientProfileId: input.patientProfileId ?? null, active: input.active ?? null },
    });
    return { items: page.map((g) => presentGrant(g, now)), nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null };
  }
}
