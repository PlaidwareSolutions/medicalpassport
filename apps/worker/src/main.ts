/**
 * Continuously-operating worker (docs/12). Stage 1 foundation: queue wiring,
 * graceful shutdown, retry/backoff/DLQ conventions. Real processors land with
 * their stages (notifications S4, OCR S8, safety S6, ...).
 */
import { Worker, type Job } from "bullmq";
import { loadEnv, workerEnvShape } from "@medpass/config";
import { getPrisma } from "@medpass/database";
import { createLogger } from "@medpass/observability";

const logger = createLogger("worker");
const env = loadEnv(workerEnvShape);
const prisma = getPrisma();

const connection = { url: env.REDIS_URL };

/** Queue conventions (docs/12): idempotent jobs, capped retries, DLQ. */
const DEFAULT_WORKER_OPTS = {
  connection,
  concurrency: 5,
} as const;

async function handlePing(job: Job): Promise<void> {
  logger.info({ jobId: job.id, correlationId: job.data?.correlationId }, "ping job processed");
}

const workers: Worker[] = [
  new Worker("system", handlePing, DEFAULT_WORKER_OPTS),
  // Stage 4+: new Worker("notifications", ...), new Worker("ocr", ...),
  // new Worker("safety-evaluation", ...) — each idempotent, with
  // attempts/backoff configured at enqueue time and failures recorded to
  // dead_letter_jobs for manual replay.
];

for (const w of workers) {
  w.on("failed", (job, err) => {
    logger.error({ queue: w.name, jobId: job?.id, err: err.message }, "job failed");
  });
}

async function shutdown(): Promise<void> {
  logger.info({}, "worker shutting down");
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

logger.info({ queues: workers.map((w) => w.name) }, "worker started");
