import { createHash } from "node:crypto";
import { writeAudit } from "@medpass/audit";
import type { PrismaClient } from "@medpass/database";
import type { AuditActorType } from "@medpass/domain";
import {
  DeterministicClassifier,
  DETERMINISTIC_CLASSIFIER_VERSION,
  type DocumentInput,
  type PageInput,
} from "@medpass/document-intelligence";
import { opaqueObjectKey, type ObjectStorage } from "@medpass/object-storage";
import { toIntelligenceKind, toPrismaDocumentKind } from "./document-kinds";
import { OCR_ENGINE, OCR_ENGINE_VERSION, runOcr } from "./ocr";
import { PDF_TEXT_ENGINE, PDF_TEXT_ENGINE_VERSION, extractPdfText } from "./pdf-text";

export interface DocumentClassifyPayload {
  documentId: string;
  profileId: string;
  actorUserId: string;
  actorType: AuditActorType;
  correlationId?: string;
}

/**
 * Stage 1 of the V2 document pipeline (docs_v2/09 §2): get text for every
 * page, decide what the document is, and hand the work on to extraction.
 *
 * Text first, classification second — the classifier reads the whole document,
 * not a page at a time, so a two-page discharge summary whose medicine list is
 * on page 2 is still a discharge summary (H-34). Each page's raw text is
 * stored as its own `ocr-tmp` object (48 h lifecycle, docs_v2/09 §9) rather
 * than a column: it is derived data, it is regenerable, and it must not sit in
 * the clinical tables.
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
): Promise<void> {
  const { documentId, profileId, actorUserId, actorType, correlationId } = payload;

  const document = await prisma.patientDocument.findFirstOrThrow({
    where: { id: documentId, patientProfileId: profileId, deletedAt: null },
    include: { pages: { orderBy: { pageNumber: "asc" }, include: { storedObject: true } } },
  });

  const pages: PageInput[] = [];
  let sawPdfTextLayer = false;
  let mimeType = "application/octet-stream";

  for (const page of document.pages) {
    if (page.storedObject.status !== "verified") continue;
    const contentType = page.storedObject.contentType ?? "";
    mimeType = contentType || mimeType;
    const bytes = await storage.getObjectBytes({ bucket: "patient-docs", objectKey: page.storedObject.objectKey });
    const isPdf = contentType === "application/pdf";
    const text = isPdf ? await extractPdfText(bytes) : await runOcr(bytes);
    if (isPdf && text.trim().length > 0) sawPdfTextLayer = true;

    await storeOcrText(prisma, storage, page.id, page.ocrTextObjectId, text);
    pages.push({ pageNumber: page.pageNumber, text });
  }

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
        engine: sawPdfTextLayer ? PDF_TEXT_ENGINE : OCR_ENGINE,
        engineVersion: sawPdfTextLayer ? PDF_TEXT_ENGINE_VERSION : OCR_ENGINE_VERSION,
      },
    });
    await enqueueExtract(tx, payload);
  });
}

/**
 * Writes one page's raw text to the `ocr-tmp` bucket and points the page at
 * it. A re-run reuses the page's existing object row rather than orphaning it,
 * so re-processing a document does not leak objects.
 */
async function storeOcrText(
  prisma: PrismaClient,
  storage: ObjectStorage,
  pageId: string,
  existingObjectId: string | null,
  text: string,
): Promise<void> {
  const body = Buffer.from(text, "utf8");
  const sha256 = createHash("sha256").update(body).digest("hex");

  if (existingObjectId) {
    const existing = await prisma.storedObject.findUnique({ where: { id: existingObjectId } });
    if (existing) {
      await storage.putObjectBytes({ bucket: "ocr-tmp", objectKey: existing.objectKey, body, contentType: "text/plain" });
      await prisma.storedObject.update({
        where: { id: existing.id },
        data: { sha256, sizeBytes: body.length, status: "verified" },
      });
      return;
    }
  }

  const objectKey = opaqueObjectKey("ocr", pageId);
  await storage.putObjectBytes({ bucket: "ocr-tmp", objectKey, body, contentType: "text/plain" });
  const stored = await prisma.storedObject.create({
    data: {
      bucket: "ocr_tmp",
      objectKey,
      contentType: "text/plain",
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
      data: { status: "queued", lockedAt: null, lockedBy: null, attempts: 0, completedAt: null, errorDigest: null },
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
