import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { adminProductMetricsQuerySchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";

/** Days are cut on the product's own calendar; the API runs on UTC. */
const METRICS_TIMEZONE = "Asia/Kolkata";

interface DailyCountRow {
  day: string;
  name: string;
  count: bigint | number;
}

/**
 * Product metrics (docs_v2/06 P1-7, docs_v2/14 §6): counts per catalogue
 * event per day over `product_events`. Aggregate only — the table holds no
 * identifier that could be returned, and this endpoint never groups by the
 * digests. Same duty as the rest of the Operations page (`operations_view`).
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/metrics")
export class AdminMetricsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("product")
  async product(@Query() query: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_operations");
    const { from, to } = parseWith(adminProductMetricsQuerySchema, query);

    const rows = await this.prisma.$queryRaw<DailyCountRow[]>`
      SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE ${METRICS_TIMEZONE}), 'YYYY-MM-DD') AS day,
             name,
             COUNT(*)::int AS count
      FROM product_events
      WHERE occurred_at >= ${from} AND occurred_at <= ${to}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    const days = new Map<string, Record<string, number>>();
    const totals: Record<string, number> = {};
    for (const row of rows) {
      const count = Number(row.count);
      const bucket = days.get(row.day) ?? {};
      bucket[row.name] = count;
      days.set(row.day, bucket);
      totals[row.name] = (totals[row.name] ?? 0) + count;
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: METRICS_TIMEZONE,
      days: [...days.entries()].map(([date, counts]) => ({ date, counts })),
      totals,
    };
  }
}
