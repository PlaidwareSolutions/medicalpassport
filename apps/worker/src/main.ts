/**
 * Continuously-operating worker (docs/12, docs/22 Stage 3/7/8 follow-up):
 * polls the Postgres-backed `background_jobs` queue (docs/13 — originally
 * specced as a BullMQ+Redis mirror, but there's no Redis in this sandbox,
 * so Postgres is the primary queue here; a real deployment with Redis
 * could swap the queue implementation with no change to the processors
 * below). Two queues: OCR/PDF-text prescription extraction (Stage 3/8) and
 * doctor-visit-summary PDF rendering (Stage 7) — both previously ran
 * synchronously inside the API request.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { getPrisma } from "@medpass/database";
import { loadEnv, workerEnvShape } from "@medpass/config";
import { createLogger } from "@medpass/observability";
import { createObjectStorage } from "@medpass/object-storage";
import { claimNextJob, completeJob, failJob } from "./lib/queue";
import { processOcrExtraction, type OcrExtractionPayload } from "./processors/ocr-extraction";
import { terminateOcrWorker } from "./processors/ocr";
import { closeBrowser, renderPdf } from "./processors/pdf-render";
import type { VisitSummaryDto } from "./processors/visit-summary-html";
import { processContentEnrichment, type ContentEnrichmentPayload } from "./processors/content-enrichment";

const logger = createLogger("worker");
const env = loadEnv(workerEnvShape);
const prisma = getPrisma();

// Same R2-or-local-disk selection as apps/api/src/common/storage.ts — the
// worker never presigns URLs itself, only reads bytes via getObjectBytes,
// but needs the same backend (docs/26 §13, Stage 11 follow-up).
const objectStorage = createObjectStorage({
  r2:
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_PREFIX
      ? {
          accountId: env.R2_ACCOUNT_ID,
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          bucketPrefix: env.R2_BUCKET_PREFIX,
        }
      : undefined,
  local: {
    rootDir: resolve(process.cwd(), env.OBJECT_STORAGE_ROOT),
    // Only used by LocalDiskObjectStorage to sign/verify presigned tokens —
    // the worker only ever calls getObjectBytes/pathFor, never presigns
    // anything itself, so this value is never actually exercised.
    secret: createHash("sha256").update(env.OBJECT_STORAGE_ROOT + ":object-storage").digest("hex"),
  },
});

const POLL_INTERVAL_MS = 500;
const QUEUES = ["ocr_extraction", "pdf_render", "content_enrichment"] as const;

let shuttingDown = false;

async function pollQueue(queue: (typeof QUEUES)[number]): Promise<boolean> {
  const job = await claimNextJob(prisma, queue);
  if (!job) return false;

  logger.info({ jobId: job.id, queue, attempt: job.attempts }, "job claimed");
  try {
    let result: unknown;
    if (queue === "ocr_extraction") {
      await processOcrExtraction(prisma, objectStorage, job.payload as OcrExtractionPayload);
      result = { ok: true };
    } else if (queue === "pdf_render") {
      const pdf = await renderPdf((job.payload as { summary: VisitSummaryDto }).summary);
      result = { pdfBase64: pdf.toString("base64") };
    } else {
      await processContentEnrichment(prisma, job.payload as ContentEnrichmentPayload, env.OPENFDA_API_KEY);
      result = { ok: true };
    }
    await completeJob(prisma, job.id, result);
    logger.info({ jobId: job.id, queue }, "job succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    logger.error({ jobId: job.id, queue, attempt: job.attempts, err: message }, "job failed");
    await failJob(prisma, job, message.slice(0, 500));
  }
  return true;
}

async function loop(): Promise<void> {
  while (!shuttingDown) {
    let didWork = false;
    for (const queue of QUEUES) {
      // eslint-disable-next-line no-await-in-loop -- sequential polling across a handful of queues, not a hot path
      didWork = (await pollQueue(queue)) || didWork;
    }
    if (!didWork) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

async function shutdown(): Promise<void> {
  logger.info({}, "worker shutting down");
  shuttingDown = true;
  await terminateOcrWorker();
  await closeBrowser();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

logger.info({ queues: QUEUES }, "worker started");
void loop();
