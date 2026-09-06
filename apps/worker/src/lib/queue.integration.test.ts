import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@medpass/database";
import { WORKER_ID, claimNextJob, completeJob, failJob } from "./queue";

/**
 * Runs the real claim SQL (`UPDATE ... FOR UPDATE SKIP LOCKED`, the
 * `::"BackgroundJobQueue"` cast) against Postgres. Skipped unless
 * DATABASE_URL is set, e.g.
 *   DATABASE_URL=postgresql://medpass:medpass@localhost:5432/medpass pnpm --filter @medpass/worker test
 *
 * `queue` is a Postgres enum, so a made-up job kind cannot be inserted;
 * test rows use real queue values but are tagged by jobKey prefix and
 * back-dated to the epoch so `ORDER BY created_at` always claims them
 * ahead of anything else in the table. The tests never claim beyond
 * their own rows (a second claim on an empty test set would grab a real
 * queued job from the shared local database).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const KEY_PREFIX = "worker-test:";

describe.skipIf(!DATABASE_URL)("queue runner (postgres)", () => {
  const prisma = new PrismaClient();
  const created: string[] = [];

  async function cleanupTagged(): Promise<void> {
    const stale = await prisma.backgroundJob.findMany({ where: { jobKey: { startsWith: KEY_PREFIX } }, select: { id: true } });
    const ids = [...new Set([...stale.map((r) => r.id), ...created])];
    if (ids.length === 0) return;
    await prisma.deadLetterJob.deleteMany({ where: { originalJobId: { in: ids } } });
    await prisma.backgroundJob.deleteMany({ where: { id: { in: ids } } });
  }

  async function enqueue(input: { queue?: "ocr_extraction" | "pdf_render" | "content_enrichment"; maxAttempts?: number; correlationId?: string } = {}) {
    const row = await prisma.backgroundJob.create({
      data: {
        queue: input.queue ?? "ocr_extraction",
        jobKey: `${KEY_PREFIX}${WORKER_ID}:${randomUUID()}`,
        payload: { test: true, marker: randomUUID() },
        maxAttempts: input.maxAttempts ?? 2,
        correlationId: input.correlationId ?? null,
        createdAt: new Date(0),
      },
    });
    created.push(row.id);
    return row;
  }

  beforeAll(async () => {
    await cleanupTagged();
  });

  afterAll(async () => {
    await cleanupTagged();
    await prisma.$disconnect();
  });

  it("claim → success: locks the row for this worker, then records the result", async () => {
    const row = await enqueue({ correlationId: "corr-abc" });

    const claimed = await claimNextJob(prisma, "ocr_extraction");
    expect(claimed).not.toBeNull();
    expect(claimed).toMatchObject({ id: row.id, queue: "ocr_extraction", attempts: 1, maxAttempts: 2, correlationId: "corr-abc" });
    expect(claimed?.payload).toEqual(row.payload);

    const running = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: row.id } });
    expect(running.status).toBe("running");
    expect(running.lockedBy).toBe(WORKER_ID);
    expect(running.lockedAt).toBeInstanceOf(Date);
    expect(running.startedAt).toBeInstanceOf(Date);
    expect(running.attempts).toBe(1);

    await completeJob(prisma, row.id, { ok: true });

    const done = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ ok: true });
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.errorDigest).toBeNull();
  });

  it("claim → retry → dead-letter after maxAttempts, never silently dropped", async () => {
    const row = await enqueue({ maxAttempts: 2 });

    // Attempt 1 fails: back to queued with the lock cleared and a backoff,
    // so the row is NOT claimable on the next poll.
    const first = await claimNextJob(prisma, "ocr_extraction");
    expect(first?.id).toBe(row.id);
    expect(first?.attempts).toBe(1);
    await failJob(prisma, first!, "attempt one failed");

    const requeued = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: row.id } });
    expect(requeued.status).toBe("queued");
    expect(requeued.lockedAt).toBeNull();
    expect(requeued.lockedBy).toBeNull();
    expect(requeued.attempts).toBe(1);
    expect(requeued.errorDigest).toBe("attempt one failed");
    expect(requeued.retryAfter).toBeInstanceOf(Date);
    expect(requeued.retryAfter!.getTime()).toBeGreaterThan(Date.now() + 20_000);
    await expect(prisma.deadLetterJob.count({ where: { originalJobId: row.id } })).resolves.toBe(0);

    // While retry_after is in the future the claim SQL must skip this row.
    // Read the row back instead of claiming again: a second claim on the
    // shared local database could grab a real queued job.
    const stillWaiting = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: row.id } });
    expect(stillWaiting.status).toBe("queued");
    expect(stillWaiting.lockedBy).toBeNull();

    // Backoff elapsed (simulated): attempt 2 (== maxAttempts) fails: terminal.
    await prisma.backgroundJob.update({ where: { id: row.id }, data: { retryAfter: new Date(0) } });
    const second = await claimNextJob(prisma, "ocr_extraction");
    expect(second?.id).toBe(row.id);
    expect(second?.attempts).toBe(2);
    await failJob(prisma, second!, "attempt two failed");

    const dead = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: row.id } });
    expect(dead.status).toBe("failed");
    expect(dead.errorDigest).toBe("attempt two failed");
    expect(dead.completedAt).toBeInstanceOf(Date);

    const dlq = await prisma.deadLetterJob.findMany({ where: { originalJobId: row.id } });
    expect(dlq).toHaveLength(1);
    expect(dlq[0]).toMatchObject({ queue: "ocr_extraction", attempts: 2, errorDigest: "attempt two failed", replayedAt: null });
    expect(dlq[0]?.payload).toEqual(row.payload);
  });

  it("only claims rows for the requested queue", async () => {
    const pdfRow = await enqueue({ queue: "pdf_render" });
    const ocrRow = await enqueue({ queue: "ocr_extraction" });

    const claimed = await claimNextJob(prisma, "ocr_extraction");
    expect(claimed?.id).toBe(ocrRow.id);

    const untouched = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: pdfRow.id } });
    expect(untouched.status).toBe("queued");

    // Settle both so nothing tagged stays claimable by a live worker.
    await completeJob(prisma, ocrRow.id, { ok: true });
    const pdfClaimed = await claimNextJob(prisma, "pdf_render");
    expect(pdfClaimed?.id).toBe(pdfRow.id);
    await completeJob(prisma, pdfRow.id, { ok: true });
  });

  it("concurrent claims never hand the same row to two workers (SKIP LOCKED)", async () => {
    const a = await enqueue();
    const b = await enqueue();

    const [x, y] = await Promise.all([claimNextJob(prisma, "ocr_extraction"), claimNextJob(prisma, "ocr_extraction")]);
    expect(x).not.toBeNull();
    expect(y).not.toBeNull();
    expect(new Set([x!.id, y!.id])).toEqual(new Set([a.id, b.id]));

    await Promise.all([completeJob(prisma, a.id, { ok: true }), completeJob(prisma, b.id, { ok: true })]);
  });
});
