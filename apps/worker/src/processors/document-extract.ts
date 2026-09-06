import { writeAudit } from "@medpass/audit";
import type { Prisma, PrismaClient } from "@medpass/database";
import type { AuditActorType } from "@medpass/domain";
import {
  classifyThenExtract,
  composeExtractors,
  DeterministicClassifier,
  DeterministicExtractor,
  DETERMINISTIC_EXTRACTOR,
  documentAiAsExtractor,
  NULL_DOCUMENT_AI_PROVENANCE,
  type CatalogMatch,
  type CatalogMatcher,
  type ClinicalExtractor,
  type DocumentAiProvider,
  type DocumentInput,
  type PageInput,
} from "@medpass/document-intelligence";
import type { ObjectStorage } from "@medpass/object-storage";
import { matchBrandInLine, type CatalogProduct } from "./candidate-detection";
import { toIntelligenceKind } from "./document-kinds";
import { decodeOcrTextObject, toPageInput } from "./ocr-text-object";

export interface DocumentExtractPayload {
  documentId: string;
  profileId: string;
  actorUserId: string;
  actorType: AuditActorType;
  correlationId?: string;
}

/** The AI extractor chosen by configuration (docs_v2/09 §7); `NullDocumentAiProvider` by default. */
export interface DocumentExtractDeps {
  documentAi: DocumentAiProvider;
}

/**
 * Stage 2 of the V2 document pipeline (docs_v2/09 §2): deterministic clinical
 * extraction over the text and word boxes `document-classify` already stored,
 * producing `DocumentCandidate` rows and nothing else.
 *
 * Not one of these rows is clinical data. They are proposals with a citation:
 * the exact source line, the page, the box, and a confidence. They become
 * clinical only through `materializeCandidate` in apps/api, after a person
 * confirms them (docs_v2/09 §1 rule 3).
 *
 * `DocumentExtraction` records engine and version — read from the package, not
 * hardcoded here — so every candidate is traceable to the code that made it
 * (docs_v2/09 §8). When a real `DocumentAiProvider` is configured (OD-12) its
 * candidates run through the same pipeline guards as the deterministic ones
 * and the row additionally records modelProvider/modelName/modelVersion/
 * promptVersion; with the null provider those stay null, which is the honest
 * answer.
 */
export async function processDocumentExtract(
  prisma: PrismaClient,
  storage: ObjectStorage,
  payload: DocumentExtractPayload,
  deps: DocumentExtractDeps,
): Promise<void> {
  const { documentId, profileId, actorUserId, actorType, correlationId } = payload;

  const document = await prisma.patientDocument.findFirstOrThrow({
    where: { id: documentId, patientProfileId: profileId, deletedAt: null },
    include: { pages: { orderBy: { pageNumber: "asc" }, include: { storedObject: true } } },
  });

  const ai = deps.documentAi;
  const aiActive = ai.provenance.provider !== NULL_DOCUMENT_AI_PROVENANCE.provider;

  const extraction = await prisma.documentExtraction.create({
    data: {
      documentId,
      engine: DETERMINISTIC_EXTRACTOR.name,
      engineVersion: DETERMINISTIC_EXTRACTOR.version,
      ...(aiActive
        ? {
            modelProvider: ai.provenance.provider,
            modelName: ai.provenance.model,
            modelVersion: ai.provenance.version,
            promptVersion: ai.provenance.promptVersion,
          }
        : {}),
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const pages: PageInput[] = [];
    let mimeType = "application/octet-stream";
    let pdfTextLayer = false;
    for (const page of document.pages) {
      if (!page.ocrTextObjectId) continue;
      const object = await prisma.storedObject.findUnique({ where: { id: page.ocrTextObjectId } });
      if (!object) continue;
      const bytes = await storage.getObjectBytes({ bucket: "ocr-tmp", objectKey: object.objectKey });
      pages.push(toPageInput(page.pageNumber, decodeOcrTextObject(bytes)));
      if (page.storedObject.contentType === "application/pdf") {
        mimeType = "application/pdf";
        pdfTextLayer = true;
      } else {
        mimeType = page.storedObject.contentType ?? mimeType;
      }
    }

    const input: DocumentInput = {
      pages,
      mimeType,
      ...(pdfTextLayer ? { pdfTextLayer: true } : {}),
      // The patient's own choice governs which extractors run — a document
      // they labelled a discharge summary is never mined as a prescription.
      ...(document.classifiedBy === "user" ? { kind: toIntelligenceKind(document.kind) } : {}),
    };

    const deterministic: ClinicalExtractor = new DeterministicExtractor();
    const result = await classifyThenExtract(input, {
      classifier: new DeterministicClassifier(),
      extractor: aiActive ? composeExtractors(deterministic, documentAiAsExtractor(ai)) : deterministic,
      catalogMatcher: await buildCatalogMatcher(prisma),
    });

    await prisma.$transaction(async (tx) => {
      for (const candidate of result.candidates) {
        await tx.documentCandidate.create({
          data: {
            extractionId: extraction.id,
            patientProfileId: profileId,
            targetEntity: candidate.targetEntity,
            targetField: candidate.targetField,
            groupKey: candidate.groupKey ?? null,
            pageNumber: candidate.pageNumber,
            boundingBox: (candidate.boundingBox ? { ...candidate.boundingBox } : null) as Prisma.InputJsonValue,
            detectedText: candidate.detectedText,
            proposedValue: candidate.proposedValue as Prisma.InputJsonValue,
            confidence: candidate.confidence,
          },
        });
      }
      await tx.documentExtraction.update({
        where: { id: extraction.id },
        data: { status: "succeeded", finishedAt: new Date() },
      });
      await tx.patientDocument.update({ where: { id: documentId }, data: { status: "processed" } });
      await writeAudit(tx, {
        action: "extraction.processed",
        actorUserId,
        actorType,
        entityType: "document_extraction",
        entityId: extraction.id,
        patientProfileId: profileId,
        correlationId,
        context: {
          // Counts and reason codes only — `dropped[].draft` holds page text
          // and never leaves the worker (docs_v2/09 §2).
          candidateCount: result.candidates.length,
          entities: [...new Set(result.candidates.map((c) => c.targetEntity))],
          droppedCount: result.dropped.length,
          droppedReasons: [...new Set(result.dropped.flatMap((d) => d.reasons))].slice(0, 12),
          engine: DETERMINISTIC_EXTRACTOR.name,
          engineVersion: DETERMINISTIC_EXTRACTOR.version,
          modelProvider: ai.provenance.provider,
          pagesWithWordBoxes: pages.filter((p) => (p.words?.length ?? 0) > 0).length,
        },
      });
    });
  } catch (err) {
    await prisma.$transaction([
      prisma.documentExtraction.update({
        where: { id: extraction.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          errorDigest: (err instanceof Error ? err.name : "unknown").slice(0, 200),
        },
      }),
      prisma.patientDocument.update({ where: { id: documentId }, data: { status: "failed" } }),
    ]);
    throw err;
  }
}

/**
 * The package has no database access by design, so catalog matching is a
 * callback (docs_v2/09 §2 "Normalization: catalog match"). The matching rule
 * itself is V1's, imported from ./candidate-detection so both pipelines
 * propose the same medicines from the same line.
 */
export async function buildCatalogMatcher(prisma: PrismaClient): Promise<CatalogMatcher> {
  const products = await prisma.medicationProduct.findMany({
    where: { status: "active" },
    include: { brand: true },
  });
  const catalog: CatalogProduct[] = products.map((p) => ({
    id: p.id,
    brandName: p.brand?.name ?? null,
    brandAliases: p.brand?.aliases ?? [],
    genericName: p.genericName,
  }));
  return (line: string): CatalogMatch | null => {
    const match = matchBrandInLine(line, catalog);
    if (!match) return null;
    return { productId: match.productId, label: match.label, matchedText: match.matchedText, quality: match.quality };
  };
}
