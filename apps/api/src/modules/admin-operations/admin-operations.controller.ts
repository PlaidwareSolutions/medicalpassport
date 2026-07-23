import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 168;

/**
 * Live operations summary (docs/06, docs/21) — reproduces, on demand, the
 * exact aggregation apps/cron's daily `operational-report` job already
 * computes into a log line. Querying live is strictly better than reading
 * that job's output: never more than a request away instead of up to 24h
 * stale, over the same tables.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/operations")
export class AdminOperationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("summary")
  async summary(@Query("windowHours") windowHoursRaw: string | undefined, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_operations");
    const windowHours = Math.min(Math.max(Number(windowHoursRaw) || DEFAULT_WINDOW_HOURS, 1), MAX_WINDOW_HOURS);
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const [failedJobs, dlqAddedInWindow, dlqOutstanding, attemptsByStatus, latestBackup, latestRestoreTest] = await Promise.all([
      this.prisma.backgroundJob.count({ where: { status: "failed", completedAt: { gte: since } } }),
      this.prisma.deadLetterJob.count({ where: { failedAt: { gte: since } } }),
      this.prisma.deadLetterJob.count({ where: { replayedAt: null } }),
      this.prisma.notificationAttempt.groupBy({ by: ["channel", "status"], where: { attemptedAt: { gte: since } }, _count: true }),
      this.prisma.backupExecution.findFirst({ orderBy: { startedAt: "desc" } }),
      this.prisma.restoreTest.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);

    const reminderPipeline = attemptsByStatus.reduce<Record<string, number>>((acc, row) => {
      acc[`${row.channel}_${row.status}`] = row._count;
      return acc;
    }, {});

    return {
      windowHours,
      jobFailuresInWindow: failedJobs,
      dlqAddedInWindow,
      dlqOutstanding,
      reminderPipeline,
      latestBackup: latestBackup ? { id: latestBackup.id, status: latestBackup.status, completedAt: latestBackup.completedAt } : null,
      latestRestoreTest: latestRestoreTest
        ? { id: latestRestoreTest.id, status: latestRestoreTest.status, completedAt: latestRestoreTest.completedAt }
        : null,
    };
  }
}
