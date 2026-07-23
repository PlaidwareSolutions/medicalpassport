import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

@Injectable()
export class AdminIncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listDlq(filters: { queue?: string; replayed?: boolean }) {
    return this.prisma.deadLetterJob.findMany({
      where: {
        queue: filters.queue as never,
        replayedAt: filters.replayed === undefined ? undefined : filters.replayed ? { not: null } : null,
      },
      orderBy: { failedAt: "desc" },
    });
  }

  /** Resets the original BackgroundJob row rather than creating a new one
   * (docs/30 R3 "Worker DLQ growth") — a fresh row would collide with the
   * job's own jobKey unique constraint. */
  async replayJob(deadLetterJobId: string, adminUserId: string, correlationId?: string) {
    const dlq = await this.prisma.deadLetterJob.findUnique({ where: { id: deadLetterJobId } });
    if (!dlq) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Dead-letter job not found", 404);
    if (dlq.replayedAt) throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This job has already been replayed", 409);

    await this.prisma.$transaction(async (tx) => {
      await tx.backgroundJob.update({
        where: { id: dlq.originalJobId },
        data: { status: "queued", attempts: 0, lockedAt: null, lockedBy: null, errorDigest: null, startedAt: null, completedAt: null },
      });
      const result = await tx.deadLetterJob.updateMany({ where: { id: dlq.id, replayedAt: null }, data: { replayedAt: new Date() } });
      if (result.count === 0) throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This job has already been replayed", 409);
      await writeAudit(tx, {
        action: "admin.job_replayed",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "dead_letter_job",
        entityId: dlq.id,
        correlationId,
        context: { queue: dlq.queue, originalJobId: dlq.originalJobId },
      });
    });
    return { id: dlq.id, replayed: true as const };
  }
}
