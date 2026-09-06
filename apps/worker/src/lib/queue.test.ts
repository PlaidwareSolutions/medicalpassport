import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@medpass/database";
import { WORKER_ID, completeJob, failJob, type ClaimedJob } from "./queue";

// The retry / dead-letter decision is pure logic over the claimed row —
// exercised here against a fake client so it runs without Postgres. The
// SQL itself (claim ordering, SKIP LOCKED, enum cast) is covered by
// queue.integration.test.ts against the real database.
function fakePrisma() {
  const backgroundJob = { update: vi.fn().mockResolvedValue(undefined) };
  const deadLetterJob = { create: vi.fn().mockResolvedValue(undefined) };
  const $transaction = vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
  return { client: { backgroundJob, deadLetterJob, $transaction } as unknown as PrismaClient, backgroundJob, deadLetterJob, $transaction };
}

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    queue: "ocr_extraction",
    payload: { documentId: "doc-1" },
    attempts: 1,
    maxAttempts: 3,
    correlationId: "corr-1",
    ...overrides,
  };
}

describe("WORKER_ID", () => {
  it("is pid plus a short random suffix so two workers on one host stay distinguishable", () => {
    expect(WORKER_ID).toMatch(/^\d+-[0-9a-f]{8}$/);
    expect(WORKER_ID.startsWith(`${process.pid}-`)).toBe(true);
  });
});

describe("completeJob", () => {
  it("marks the row succeeded with the result and a completion time", async () => {
    const { client, backgroundJob } = fakePrisma();
    await completeJob(client, "job-1", { pdfBase64: "AAAA" });

    expect(backgroundJob.update).toHaveBeenCalledTimes(1);
    const call = backgroundJob.update.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: "job-1" });
    expect(call.data.status).toBe("succeeded");
    expect(call.data.result).toEqual({ pdfBase64: "AAAA" });
    expect(call.data.completedAt).toBeInstanceOf(Date);
  });
});

describe("failJob — retry vs dead-letter decision", () => {
  it("re-queues and clears the lock while attempts remain", async () => {
    const { client, backgroundJob, deadLetterJob, $transaction } = fakePrisma();
    await failJob(client, job({ attempts: 1, maxAttempts: 3 }), "boom");

    expect(backgroundJob.update).toHaveBeenCalledTimes(1);
    expect(backgroundJob.update).toHaveBeenCalledWith({
      where: { id: "11111111-1111-4111-8111-111111111111" },
      data: { status: "queued", lockedAt: null, lockedBy: null, errorDigest: "boom" },
    });
    expect(deadLetterJob.create).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("re-queues on the penultimate attempt (attempts < maxAttempts)", async () => {
    const { client, backgroundJob, deadLetterJob } = fakePrisma();
    await failJob(client, job({ attempts: 2, maxAttempts: 3 }), "boom");
    expect((backgroundJob.update.mock.calls[0]?.[0] as { data: { status: string } }).data.status).toBe("queued");
    expect(deadLetterJob.create).not.toHaveBeenCalled();
  });

  it("re-queues immediately — there is no backoff delay between attempts", async () => {
    // Pinned as current behaviour: a transient failure is retried on the
    // very next poll (~500 ms), not after an increasing delay.
    const { client, backgroundJob } = fakePrisma();
    await failJob(client, job({ attempts: 1, maxAttempts: 3 }), "boom");
    const data = (backgroundJob.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.lockedAt).toBeNull();
    expect(Object.keys(data).sort()).toEqual(["errorDigest", "lockedAt", "lockedBy", "status"]);
  });

  it("dead-letters atomically once attempts reach maxAttempts", async () => {
    const { client, backgroundJob, deadLetterJob, $transaction } = fakePrisma();
    const j = job({ attempts: 3, maxAttempts: 3, queue: "pdf_render", payload: { summary: { profile: {} } } });
    await failJob(client, j, "still broken");

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(($transaction.mock.calls[0]?.[0] as unknown[]).length).toBe(2);

    const update = backgroundJob.update.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
    expect(update.where).toEqual({ id: j.id });
    expect(update.data.status).toBe("failed");
    expect(update.data.errorDigest).toBe("still broken");
    expect(update.data.completedAt).toBeInstanceOf(Date);

    expect(deadLetterJob.create).toHaveBeenCalledWith({
      data: { queue: "pdf_render", originalJobId: j.id, payload: { summary: { profile: {} } }, attempts: 3, errorDigest: "still broken" },
    });
  });

  it("also dead-letters when attempts somehow exceed maxAttempts (never re-queues forever)", async () => {
    const { client, deadLetterJob } = fakePrisma();
    await failJob(client, job({ attempts: 5, maxAttempts: 3 }), "boom");
    expect(deadLetterJob.create).toHaveBeenCalledTimes(1);
  });

  it("treats maxAttempts = 1 as no retries at all", async () => {
    const { client, deadLetterJob } = fakePrisma();
    await failJob(client, job({ attempts: 1, maxAttempts: 1 }), "boom");
    expect(deadLetterJob.create).toHaveBeenCalledTimes(1);
  });
});
