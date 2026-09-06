/**
 * Continuously-operating worker (docs/12, docs/22 Stage 3/7/8 follow-up):
 * polls the Postgres-backed `background_jobs` queue (docs/13 — originally
 * specced as a BullMQ+Redis mirror, but there's no Redis in this sandbox,
 * so Postgres is the primary queue here; a real deployment with Redis
 * could swap the queue implementation with no change to the processors
 * below). Queues: V1 OCR/PDF-text prescription extraction (Stage 3/8),
 * doctor-visit-summary PDF rendering (Stage 7), clinical-content enrichment,
 * and the two halves of the V2 document pipeline — `document_classify` and
 * `document_extract` (docs_v2/09 §2).
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
import { processDocumentClassify, type DocumentClassifyPayload } from "./processors/document-classify";
import { processDocumentExtract, type DocumentExtractPayload } from "./processors/document-extract";

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
// document_classify / document_extract are the two halves of the V2 document
// pipeline (docs_v2/09 §2): classify enqueues extract, so they are separate
// queues rather than one long job — a slow OCR pass never blocks a retry of
// the cheap extraction step, and each has its own attempt budget.
const QUEUES = ["ocr_extraction", "pdf_render", "content_enrichment", "document_classify", "document_extract"] as const;

let shuttingDown = false;
/** The job currently being processed, so shutdown can let it finish (docs_v2/16 §3 item 3). */
let inFlight: Promise<unknown> | undefined;

async function pollQueue(queue: (typeof QUEUES)[number]): Promise<boolean> {
  if (shuttingDown) return false;
  const job = await claimNextJob(prisma, queue);
  if (!job) return false;

  logger.info({ jobId: job.id, queue, attempt: job.attempts }, "job claimed");
  const work = runJob(queue, job);
  inFlight = work;
  try {
    await work;
  } finally {
    inFlight = undefined;
  }
  return true;
}

async function runJob(queue: (typeof QUEUES)[number], job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>): Promise<void> {
  try {
    let result: unknown;
    if (queue === "ocr_extraction") {
      await processOcrExtraction(prisma, objectStorage, job.payload as OcrExtractionPayload);
      result = { ok: true };
    } else if (queue === "pdf_render") {
      const pdf = await renderPdf((job.payload as { summary: VisitSummaryDto }).summary);
      result = { pdfBase64: pdf.toString("base64") };
    } else if (queue === "document_classify") {
      await processDocumentClassify(prisma, objectStorage, job.payload as DocumentClassifyPayload);
      result = { ok: true };
    } else if (queue === "document_extract") {
      await processDocumentExtract(prisma, objectStorage, job.payload as DocumentExtractPayload);
      result = { ok: true };
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

const SHUTDOWN_GRACE_MS = 60_000;

async function shutdown(): Promise<void> {
  logger.info({}, "worker shutting down");
  shuttingDown = true;
  // Let the in-flight job finish (or fail and re-queue itself) rather than
  // leaving it `running` under a lock nobody holds; the stale-lock reclaim
  // in claimNextJob is the backstop if the platform kills us first.
  if (inFlight) {
    await Promise.race([inFlight.catch(() => undefined), new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS))]);
  }
  await terminateOcrWorker();
  await closeBrowser();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

logger.info({ queues: QUEUES }, "worker started");
void loop();
