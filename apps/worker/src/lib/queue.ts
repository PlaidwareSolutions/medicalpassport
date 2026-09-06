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

/**
 * A job still `running` this long after it was locked is treated as
 * abandoned (the worker died mid-job: OOM, redeploy during a puppeteer
 * render) and becomes claimable again; the attempt counter still increments,
 * so a job that keeps killing its worker dead-letters like any other
 * failure instead of running forever (docs_v2/16 §3 item 3).
 */
export const STALE_LOCK_MINUTES = 15;

/**
 * Retry backoff (docs_v2/16 §3 defect 2). A failed job used to be reclaimed
 * on the very next 500 ms poll, so a transient outage (OCR engine warming
 * up, object store hiccup) burned every attempt in under two seconds and
 * dead-lettered work that would have succeeded a minute later. Delay grows
 * 30 s → 60 s → 2 m → 4 m … capped at 15 m, with ±25 % jitter so a burst of
 * failures does not come back as a burst.
 */
export const RETRY_BASE_MS = 30_000;
export const RETRY_MAX_MS = 15 * 60_000;

export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
  const jitter = 1 + (random() * 2 - 1) * 0.25;
  return Math.round(base * jitter);
}

export async function claimNextJob(prisma: PrismaClient, queue: BackgroundJobQueue): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; queue: BackgroundJobQueue; payload: unknown; attempts: number; maxAttempts: number; correlationId: string | null }>
  >`
    UPDATE background_jobs
    SET status = 'running', locked_at = now(), locked_by = ${WORKER_ID}, started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM background_jobs
      WHERE queue = ${queue}::"BackgroundJobQueue"
        AND (
          (status = 'queued' AND (retry_after IS NULL OR retry_after <= now()))
          OR (status = 'running' AND locked_at < now() - (${STALE_LOCK_MINUTES}::int * interval '1 minute'))
        )
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

/**
 * Retries (with backoff) until maxAttempts, then moves the job to the
 * dead-letter table — never silently dropped.
 */
export async function failJob(
  prisma: PrismaClient,
  job: ClaimedJob,
  errorDigest: string,
  now: () => Date = () => new Date(),
): Promise<void> {
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
      data: {
        status: "queued",
        lockedAt: null,
        lockedBy: null,
        errorDigest,
        retryAfter: new Date(now().getTime() + retryDelayMs(job.attempts)),
      },
    });
  }
}
