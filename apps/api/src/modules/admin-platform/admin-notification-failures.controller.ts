import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { notificationFailuresQuerySchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";

/**
 * Notification failures (docs_v2/14 §3 — split out of the operations
 * summary), operations_view: failed / undelivered attempts over the last
 * N days by channel and by kind, with the most common error digests per
 * channel. Aggregates only; attempts carry no message content.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/notifications")
export class AdminNotificationFailuresController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("failures")
  async failures(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_operations");
    const { days } = parseWith(notificationFailuresQuerySchema, query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const window = { attemptedAt: { gte: since } } as const;

    const [failed, totalsByChannel, cancelledByKind] = await Promise.all([
      this.prisma.notificationAttempt.findMany({
        where: { ...window, status: "failed" },
        select: { channel: true, status: true, errorDigest: true, attemptedAt: true, notification: { select: { kind: true } } },
        orderBy: { attemptedAt: "desc" },
        take: 5000,
      }),
      this.prisma.notificationAttempt.groupBy({ by: ["channel", "status"], where: window, _count: true }),
      this.prisma.notification.groupBy({ by: ["kind"], where: { status: "cancelled", createdAt: { gte: since } }, _count: true }),
    ]);

    const byChannel: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    const byChannelAndKind: Record<string, Record<string, number>> = {};
    const errorsByChannel: Record<string, Record<string, number>> = {};
    for (const a of failed) {
      byChannel[a.channel] = (byChannel[a.channel] ?? 0) + 1;
      byKind[a.notification.kind] = (byKind[a.notification.kind] ?? 0) + 1;
      (byChannelAndKind[a.channel] ??= {})[a.notification.kind] = (byChannelAndKind[a.channel]![a.notification.kind] ?? 0) + 1;
      const digest = a.errorDigest ?? "unknown";
      (errorsByChannel[a.channel] ??= {})[digest] = (errorsByChannel[a.channel]![digest] ?? 0) + 1;
    }
    const topErrors = Object.fromEntries(
      Object.entries(errorsByChannel).map(([channel, digests]) => [
        channel,
        Object.entries(digests)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([errorDigest, count]) => ({ errorDigest, count })),
      ]),
    );

    return {
      windowDays: days,
      failedTotal: failed.length,
      byChannel,
      byKind,
      byChannelAndKind,
      topErrors,
      attemptsByChannelAndStatus: totalsByChannel.map((t) => ({ channel: t.channel, status: t.status, count: t._count })),
      cancelledByKind: Object.fromEntries(cancelledByKind.map((c) => [c.kind, c._count])),
    };
  }
}
