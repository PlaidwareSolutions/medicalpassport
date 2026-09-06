import { createHash } from "node:crypto";
import { writeAudit } from "@medpass/audit";
import type { PrismaClient } from "@medpass/database";
import type { AuditActorType } from "@medpass/domain";
import {
  DeterministicClassifier,
  DETERMINISTIC_CLASSIFIER_VERSION,
  type DocumentInput,
  type MalwareScanner,
  type OcrProvider,
  type PageInput,
} from "@medpass/document-intelligence";
import { opaqueObjectKey, type ObjectStorage } from "@medpass/object-storage";
import { createLogger } from "@medpass/observability";
import { toIntelligenceKind, toPrismaDocumentKind } from "./document-kinds";
import { encodeOcrTextObject, fromOcrResult, fromPdfText, OCR_TEXT_OBJECT_CONTENT_TYPE, type OcrTextObjectV1 } from "./ocr-text-object";
import { PDF_TEXT_ENGINE, PDF_TEXT_ENGINE_VERSION, extractPdfText } from "./pdf-text";

const logger = createLogger("worker-document-classify");

export interface DocumentClassifyPayload {
  documentId: string;
  profileId: string;
  actorUserId: string;
  actorType: AuditActorType;
  correlationId?: string;
}

/** The two adapters this stage depends on, chosen by configuration in main.ts (docs_v2/09 §7). */
export interface DocumentClassifyDeps {
  scanner: MalwareScanner;
  ocr: OcrProvider;
}

/**
 * Stage 1 of the V2 document pipeline (docs_v2/09 §2): scan every page for
 * malware, get text for every page, decide what the document is, and hand the
 * work on to extraction.
 *
 * Scanning comes first and covers every page before OCR touches any of them
 * (docs_v2/06 P3-3): an infected page quarantines the whole document — the
 * object rows stay (nothing is served while quarantined, see documents-v2
 * `byId` and dev-storage download) and the job ends there, successfully. The
 * patient sees `documents.quarantined`; the admin funnel counts it.
 *
 * Text first, classification second — the classifier reads the whole document,
 * not a page at a time, so a two-page discharge summary whose medicine list is
 * on page 2 is still a discharge summary (H-34). Each page's text — and, from
 * the OCR provider, its word boxes with their confidences — is stored as its
 * own `ocr-tmp` object (48 h lifecycle, docs_v2/09 §9) rather than a column:
 * it is derived data, it is regenerable, and it must not sit in the clinical
 * tables.
 *
 * The one thing this job may never do is re-label a document the patient
 * already labelled. `classifiedBy = "user"` is a decision, not a hint
 * (docs_v2/09 §4) — the classifier's own opinion is still recorded in
 * `classification` for the accuracy metrics, but `kind` does not move.
 */
export async function processDocumentClassify(
  prisma: PrismaClient,
  storage: ObjectStorage,
  payload: DocumentClassifyPayload,
  deps: DocumentClassifyDeps,
): Promise<void> {
  const { documentId, profileId, actorUserId, actorType, correlationId } = payload;

  const document = await prisma.patientDocument.findFirstOrThrow({
    where: { id: documentId, patientProfileId: profileId, deletedAt: null },
    include: { pages: { orderBy: { pageNumber: "asc" }, include: { storedObject: true } } },
  });

  const verifiedPages = document.pages.filter((p) => p.storedObject.status === "verified");

  // ---- 1. Malware scan, every page, before any OCR (docs_v2/06 P3-3) ----
  const bytesByPage = new Map<string, Buffer>();
  for (const page of verifiedPages) {
    const contentType = page.storedObject.contentType ?? "";
    const bytes = await storage.getObjectBytes({ bucket: "patient-docs", objectKey: page.storedObject.objectKey });
    const scan = await deps.scanner.scan(bytes, contentType);
    if (scan.verdict === "infected") {
      await quarantine(prisma, payload, page.storedObjectId, page.pageNumber, scan);
      return;
    }
    if (scan.verdict === "unsupported") {
      // The API already verified the signature on upload; an unsupported declared type
      // here is a configuration gap worth a log line, not a reason to block the patient.
      logger.warn({ documentId, pageNumber: page.pageNumber, reason: scan.reason, engine: scan.engine }, "malware scan could not cover this page");
    }
    bytesByPage.set(page.id, bytes);
  }

  // ---- 2. Text for every page ----
  const pages: PageInput[] = [];
  let sawPdfTextLayer = false;
  let mimeType = "application/octet-stream";

  for (const page of verifiedPages) {
    const contentType = page.storedObject.contentType ?? "";
    mimeType = contentType || mimeType;
    const bytes = bytesByPage.get(page.id)!;
    const isPdf = contentType === "application/pdf";

    let stored: OcrTextObjectV1;
    if (isPdf) {
      const text = await extractPdfText(bytes);
      if (text.trim().length > 0) sawPdfTextLayer = true;
      stored = fromPdfText(text, PDF_TEXT_ENGINE, PDF_TEXT_ENGINE_VERSION);
    } else {
      stored = fromOcrResult(await deps.ocr.recognize({ bytes, contentType, pageNumber: page.pageNumber }));
    }

    await storeOcrText(prisma, storage, page.id, page.ocrTextObjectId, encodeOcrTextObject(stored));
    const input: PageInput = { pageNumber: page.pageNumber, text: stored.text };
    if (stored.words.length > 0) input.words = stored.words;
    if (!stored.pdfTextLayer && typeof stored.confidence === "number") input.confidence = stored.confidence;
    pages.push(input);
  }

  // ---- 3. Classification ----
  // The patient's own choice, translated into the classifier's vocabulary, so
  // the pipeline reports "user-selected-kind" instead of guessing.
  const chosenKind = document.classifiedBy === "user" ? toIntelligenceKind(document.kind) : undefined;
  const input: DocumentInput = {
    pages,
    mimeType,
    ...(sawPdfTextLayer ? { pdfTextLayer: true } : {}),
    ...(chosenKind ? { kind: chosenKind } : {}),
  };
  const classification = await new DeterministicClassifier().classify(input);
  const userChose = document.classifiedBy === "user";

  await prisma.$transaction(async (tx) => {
    await tx.patientDocument.update({
      where: { id: documentId },
      data: {
        // `classification` is always what the classifier said; `kind` is the
        // effective answer, and the user outranks the classifier for good.
        classification: toPrismaDocumentKind(classification.kind),
        classificationConfidence: classification.confidence,
        ...(userChose ? {} : { kind: toPrismaDocumentKind(classification.kind), classifiedBy: "deterministic" as const }),
      },
    });
    await writeAudit(tx, {
      action: "document.classified",
      actorUserId,
      actorType,
      entityType: "patient_document",
      entityId: documentId,
      patientProfileId: profileId,
      correlationId,
      context: {
        // PHI-free by construction: signal ids are static strings, never page text.
        classification: classification.kind,
        confidence: classification.confidence,
        signals: classification.signals.slice(0, 12),
        classifierVersion: DETERMINISTIC_CLASSIFIER_VERSION,
        keptUserKind: userChose,
        pages: pages.length,
        // Provenance comes from the provider that actually ran (docs_v2/06 P3-2).
        engine: sawPdfTextLayer ? PDF_TEXT_ENGINE : deps.ocr.engine,
        engineVersion: sawPdfTextLayer ? PDF_TEXT_ENGINE_VERSION : deps.ocr.engineVersion,
        scanner: deps.scanner.engine,
        scannerVersion: deps.scanner.engineVersion,
      },
    });
    await enqueueExtract(tx, payload);
  });
}

/**
 * Quarantine (docs_v2/06 P3-3): the infected page's object and the document
 * flip to `quarantined` in one transaction with the audit row, so a crash
 * between them cannot leave a served page. Nothing is deleted — the bytes are
 * evidence, and retention (OD-7) decides their fate — and no further job is
 * queued for this document. The audit context names the engine and the
 * reason code (a signature name, never page content).
 */
async function quarantine(
  prisma: PrismaClient,
  payload: DocumentClassifyPayload,
  storedObjectId: string,
  pageNumber: number,
  scan: { reason?: string; engine: string; engineVersion: string },
): Promise<void> {
  const { documentId, profileId, actorUserId, actorType, correlationId } = payload;
  await prisma.$transaction(async (tx) => {
    await tx.storedObject.update({ where: { id: storedObjectId }, data: { status: "quarantined" } });
    await tx.patientDocument.update({ where: { id: documentId }, data: { status: "quarantined" } });
    await writeAudit(tx, {
      action: "document.quarantined",
      actorUserId,
      actorType,
      entityType: "patient_document",
      entityId: documentId,
      patientProfileId: profileId,
      correlationId,
      context: {
        pageNumber,
        reason: (scan.reason ?? "unspecified").slice(0, 120),
        engine: scan.engine,
        engineVersion: scan.engineVersion,
        stage: "document_classify",
      },
    });
  });
  logger.warn({ documentId, pageNumber, engine: scan.engine, reason: scan.reason }, "document quarantined by malware scan");
}

/**
 * Writes one page's OCR object to the `ocr-tmp` bucket and points the page at
 * it. A re-run reuses the page's existing object row rather than orphaning it,
 * so re-processing a document does not leak objects.
 */
async function storeOcrText(
  prisma: PrismaClient,
  storage: ObjectStorage,
  pageId: string,
  existingObjectId: string | null,
  body: Buffer,
): Promise<void> {
  const sha256 = createHash("sha256").update(body).digest("hex");

  if (existingObjectId) {
    const existing = await prisma.storedObject.findUnique({ where: { id: existingObjectId } });
    if (existing) {
      await storage.putObjectBytes({ bucket: "ocr-tmp", objectKey: existing.objectKey, body, contentType: OCR_TEXT_OBJECT_CONTENT_TYPE });
      await prisma.storedObject.update({
        where: { id: existing.id },
        data: { sha256, sizeBytes: body.length, status: "verified", contentType: OCR_TEXT_OBJECT_CONTENT_TYPE },
      });
      return;
    }
  }

  const objectKey = opaqueObjectKey("ocr", pageId);
  await storage.putObjectBytes({ bucket: "ocr-tmp", objectKey, body, contentType: OCR_TEXT_OBJECT_CONTENT_TYPE });
  const stored = await prisma.storedObject.create({
    data: {
      bucket: "ocr_tmp",
      objectKey,
      contentType: OCR_TEXT_OBJECT_CONTENT_TYPE,
      sha256,
      sizeBytes: body.length,
      status: "verified",
      // Derived data with a 48 h lifecycle (docs_v2/09 §9) — the original is
      // the record, this is a cache.
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });
  await prisma.documentPage.update({ where: { id: pageId }, data: { ocrTextObjectId: stored.id } });
}

async function enqueueExtract(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  payload: DocumentClassifyPayload,
): Promise<void> {
  const jobKey = `document-extract:${payload.documentId}:${DETERMINISTIC_CLASSIFIER_VERSION}`;
  const existing = await tx.backgroundJob.findUnique({ where: { jobKey }, select: { id: true, status: true } });
  if (existing) {
    // A re-process of the same document re-runs extraction rather than
    // silently returning the previous run's candidates.
    await tx.backgroundJob.update({
      where: { id: existing.id },
      data: { status: "queued", lockedAt: null, lockedBy: null, attempts: 0, completedAt: null, errorDigest: null, retryAfter: null },
    });
    return;
  }
  await tx.backgroundJob.create({
    data: {
      queue: "document_extract",
      jobKey,
      payload: { ...payload },
      correlationId: payload.correlationId,
    },
  });
}
