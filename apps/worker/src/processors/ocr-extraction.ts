import type { PrismaClient } from "@medpass/database";
import type { ObjectStorage } from "@medpass/object-storage";
import { writeAudit } from "@medpass/audit";
import type { AuditActorType } from "@medpass/domain";
import { detectCandidates } from "./candidate-detection";
import { OCR_ENGINE, OCR_ENGINE_VERSION, runOcr } from "./ocr";
import { PDF_TEXT_ENGINE, PDF_TEXT_ENGINE_VERSION, extractPdfText } from "./pdf-text";

export interface OcrExtractionPayload {
  documentId: string;
  profileId: string;
  actorUserId: string;
  actorType: AuditActorType;
  correlationId?: string;
}

/**
 * Moved here from apps/api (docs/22 Stage 3/8 follow-up: async via the
 * Postgres-backed queue instead of synchronous-in-request). Behavior is
 * unchanged from the original synchronous version — same deterministic
 * candidate detection, same audit trail, same "never fabricate" rule —
 * only the caller (a queued job, not an HTTP request) is different.
 */
export async function processOcrExtraction(prisma: PrismaClient, storage: ObjectStorage, payload: OcrExtractionPayload): Promise<void> {
  const { documentId, profileId, actorUserId, actorType, correlationId } = payload;

  const doc = await prisma.prescriptionDocument.findFirstOrThrow({
    where: { id: documentId, patientProfileId: profileId },
    include: { storedObject: true },
  });

  const isPdf = doc.storedObject.contentType === "application/pdf";

  const extraction = await prisma.prescriptionExtraction.create({
    data: {
      prescriptionDocumentId: documentId,
      engine: isPdf ? PDF_TEXT_ENGINE : OCR_ENGINE,
      engineVersion: isPdf ? PDF_TEXT_ENGINE_VERSION : OCR_ENGINE_VERSION,
      status: "running",
    },
  });

  try {
    const bytes = await storage.getObjectBytes({ bucket: "patient-docs", objectKey: doc.storedObject.objectKey });
    const rawText = isPdf ? await extractPdfText(bytes) : await runOcr(bytes);

    const products = await prisma.medicationProduct.findMany({
      where: { status: "active" },
      include: { brand: true },
    });
    const catalog = products.map((p) => ({
      id: p.id,
      brandName: p.brand?.name ?? null,
      brandAliases: p.brand?.aliases ?? [],
      genericName: p.genericName,
    }));
    const candidates = detectCandidates(rawText, catalog);

    await prisma.$transaction(async (tx) => {
      await tx.prescriptionExtraction.update({
        where: { id: extraction.id },
        data: { status: "succeeded", rawText, completedAt: new Date() },
      });
      for (const c of candidates) {
        await tx.extractionCandidate.create({
          data: {
            extractionId: extraction.id,
            field: c.field,
            detectedText: c.detectedText,
            proposedValue: c.proposedValue,
            confidence: c.confidence,
          },
        });
      }
      await tx.prescriptionDocument.update({ where: { id: documentId }, data: { status: "processed" } });
      await writeAudit(tx, {
        action: "extraction.processed",
        actorUserId,
        actorType,
        entityType: "prescription_extraction",
        entityId: extraction.id,
        patientProfileId: profileId,
        correlationId,
        context: { candidateCount: candidates.length, fields: candidates.map((c) => c.field), engine: isPdf ? "pdf-parse" : "ocr" },
      });
    });
  } catch (err) {
    await prisma.$transaction([
      prisma.prescriptionExtraction.update({ where: { id: extraction.id }, data: { status: "failed" } }),
      prisma.prescriptionDocument.update({ where: { id: documentId }, data: { status: "failed" } }),
    ]);
    throw err;
  }
}
