import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { abdmTransactionsQuerySchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";

/**
 * ABDM transaction explorer (docs_v2/14 §3, abdm_operations): the
 * `AbdmTransaction` ledger the gateway client writes — kind, direction,
 * status, gateway ids, error code/text, timings. Request/response bodies
 * are never stored (only digests), so nothing clinical can surface here;
 * the profile id is opaque.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/abdm")
export class AdminAbdmTransactionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("transactions")
  async list(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_abdm_operations");
    const input = parseWith(abdmTransactionsQuerySchema, query);
    const where = {
      status: input.status,
      kind: input.kind,
      direction: input.direction,
      gatewayEnv: input.gatewayEnv,
      ...(input.errorCode ? { errorCode: input.errorCode } : input.errorsOnly ? { errorCode: { not: null } } : {}),
    };
    const [rows, byStatus, byKind] = await Promise.all([
      this.prisma.abdmTransaction.findMany({
        where,
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      }),
      this.prisma.abdmTransaction.groupBy({ by: ["status"], _count: true }),
      this.prisma.abdmTransaction.groupBy({ by: ["kind"], _count: true }),
    ]);
    const page = rows.slice(0, input.limit);
    return {
      items: page.map((t) => ({
        id: t.id,
        patientProfileId: t.patientProfileId,
        kind: t.kind,
        direction: t.direction,
        status: t.status,
        requestId: t.requestId,
        transactionId: t.transactionId,
        correlationId: t.correlationId,
        errorCode: t.errorCode,
        errorText: t.errorText,
        gatewayEnv: t.gatewayEnv,
        startedAt: t.startedAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
        durationMs: t.completedAt ? t.completedAt.getTime() - t.startedAt.getTime() : null,
      })),
      nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      totals: {
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
        byKind: Object.fromEntries(byKind.map((k) => [k.kind, k._count])),
      },
    };
  }
}
