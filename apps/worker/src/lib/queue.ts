import { randomUUID } from "node:crypto";
import type { BackgroundJobQueue, PrismaClient } from "@medpass/database";

/**
 * Postgres-backed job queue (docs/13 background_jobs, docs/22 Stage 7/8
 * follow-up) — a real deployment would run this against BullMQ+Redis
 * instead, but there's no Redis in this sandbox, so Postgres is the
 * primary queue here, not just an audit mirror. `FOR UPDATE SKIP LOCKED`
 * is the standard, safe way to let multiple workers claim rows without
 * double-processing the same job.
 */

export interface ClaimedJob {
  id: string;
  queue: BackgroundJobQueue;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
}

export const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

export async function claimNextJob(prisma: PrismaClient, queue: BackgroundJobQueue): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; queue: BackgroundJobQueue; payload: unknown; attempts: number; maxAttempts: number; correlationId: string | null }>
  >`
    UPDATE background_jobs
    SET status = 'running', locked_at = now(), locked_by = ${WORKER_ID}, started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM background_jobs
      WHERE queue = ${queue}::"BackgroundJobQueue" AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, queue, payload, attempts, max_attempts AS "maxAttempts", correlation_id AS "correlationId"
  `;
  return rows[0] ?? null;
}

export async function completeJob(prisma: PrismaClient, jobId: string, result: unknown): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: { status: "succeeded", result: result as object, completedAt: new Date() },
  });
}

/** Retries until maxAttempts, then moves the job to the dead-letter table — never silently dropped. */
export async function failJob(prisma: PrismaClient, job: ClaimedJob, errorDigest: string): Promise<void> {
  if (job.attempts >= job.maxAttempts) {
    await prisma.$transaction([
      prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: "failed", errorDigest, completedAt: new Date() },
      }),
      prisma.deadLetterJob.create({
        data: { queue: job.queue, originalJobId: job.id, payload: job.payload as object, attempts: job.attempts, errorDigest },
      }),
    ]);
  } else {
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: "queued", lockedAt: null, lockedBy: null, errorDigest },
    });
  }
}
