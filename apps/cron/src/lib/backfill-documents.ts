/**
 * Phase 3 documents backfill (docs_v2/04 §7.3, §14): every V1
 * `PrescriptionDocument` becomes one `PatientDocument` plus one
 * `DocumentPage` for the object it already holds — "V1's one-object-per-
 * document rows backfill as page 1".
 *
 * Nothing is moved or deleted: the V1 row and its endpoints keep working
 * until the V2.5 sunset (docs_v2/05 §15), and the same `StoredObject` is
 * shared by both, so no bytes are copied and no original is at risk
 * (docs_v2/09 §1 rule 1).
 *
 * Idempotent via the unique `legacyPrescriptionDocumentId`: a re-run updates
 * the row it already made rather than minting a second one. Resumable: keyset
 * pagination by id in batches, each batch its own transaction. Logs counts
 * only — never row content.
 */
import type { DocumentKind, PrismaClient } from "@medpass/database";
import { BACKFILL_BATCH, type BackfillLogger } from "./backfill-provenance";

/**
 * V1 and V2 share one `DocumentKind` enum, so most values copy across. The two
 * exceptions are V1's own spellings for the two kinds V2 renamed: V2 readers
 * (the classifier, the extraction targets, patient-web's kind picker) switch
 * on `laboratory_report` / `imaging_report`, and a backfilled row that kept
 * `lab_report` would quietly fall through every one of them.
 */
const KIND_MAP: Readonly<Partial<Record<DocumentKind, DocumentKind>>> = Object.freeze({
  lab_report: "laboratory_report",
  scan_report: "imaging_report",
});

export function backfillDocumentKind(kind: DocumentKind): DocumentKind {
  return KIND_MAP[kind] ?? kind;
}

export interface DocumentBackfillCounts {
  scanned: number;
  documentsCreated: number;
  documentsUpdated: number;
  pagesCreated: number;
  /** V1 rows whose `reportId` has no V2 `DiagnosticReport` yet — the link is left null rather than guessed. */
  reportLinksDeferred: number;
}

export async function backfillDocuments(prisma: PrismaClient, log?: BackfillLogger): Promise<DocumentBackfillCounts> {
  const counts: DocumentBackfillCounts = {
    scanned: 0,
    documentsCreated: 0,
    documentsUpdated: 0,
    pagesCreated: 0,
    reportLinksDeferred: 0,
  };

  let afterId: string | undefined;
  for (;;) {
    const batch = await prisma.prescriptionDocument.findMany({
      where: afterId ? { id: { gt: afterId } } : {},
      orderBy: { id: "asc" },
      take: BACKFILL_BATCH,
      include: { storedObject: { select: { id: true, status: true, sizeBytes: true } } },
    });
    if (batch.length === 0) break;
    afterId = batch[batch.length - 1]!.id;
    counts.scanned += batch.length;

    // A V1 `reportId` points at a `MedicalReport`; the V2 column points at a
    // `DiagnosticReport`. They are joined by the reports backfill's
    // `legacyMedicalReportId`, so this resolves through it and leaves the
    // link null when that backfill hasn't run yet — a wrong link is worse
    // than a missing one (H-36).
    const legacyReportIds = [...new Set(batch.map((d) => d.reportId).filter((id): id is string => Boolean(id)))];
    const diagnosticReports = legacyReportIds.length
      ? await prisma.diagnosticReport.findMany({
          where: { legacyMedicalReportId: { in: legacyReportIds } },
          select: { id: true, legacyMedicalReportId: true },
        })
      : [];
    const diagnosticReportByLegacy = new Map(
      diagnosticReports.map((r) => [r.legacyMedicalReportId!, r.id] as const),
    );

    await prisma.$transaction(async (tx) => {
      for (const legacy of batch) {
        const diagnosticReportId = legacy.reportId ? (diagnosticReportByLegacy.get(legacy.reportId) ?? null) : null;
        if (legacy.reportId && !diagnosticReportId) counts.reportLinksDeferred += 1;

        const verified = legacy.storedObject.status === "verified";
        const shared = {
          patientProfileId: legacy.patientProfileId,
          kind: backfillDocumentKind(legacy.kind),
          prescriptionId: legacy.prescriptionId,
          diagnosticReportId,
          status: legacy.status,
          // V1 had one upload path and no channel column; "file" is the
          // honest neutral value, not a guess at camera vs gallery.
          sourceChannel: "file" as const,
          pageCount: verified ? 1 : 0,
          // V1's kind came from a form field that defaulted to "prescription"
          // rather than from a deliberate choice, so `classifiedBy` stays
          // null: a later classify run may still label these, and nothing
          // here pretends the patient decided (docs_v2/09 §4).
          classifiedBy: null,
          provenanceSource: "user_entered" as const,
          verification: "patient_confirmed" as const,
          recordedVia: "pwa",
          createdAt: legacy.createdAt,
        };

        const existing = await tx.patientDocument.findUnique({
          where: { legacyPrescriptionDocumentId: legacy.id },
          select: { id: true },
        });
        const document = existing
          ? await tx.patientDocument.update({ where: { id: existing.id }, data: shared, select: { id: true } })
          : await tx.patientDocument.create({
              data: { ...shared, legacyPrescriptionDocumentId: legacy.id },
              select: { id: true },
            });
        if (existing) counts.documentsUpdated += 1;
        else counts.documentsCreated += 1;

        // The V1 object becomes page 1. Both rows point at the same
        // StoredObject — the bytes are never copied.
        const page = await tx.documentPage.findUnique({
          where: { documentId_pageNumber: { documentId: document.id, pageNumber: 1 } },
          select: { id: true },
        });
        if (!page) {
          await tx.documentPage.create({
            data: { documentId: document.id, pageNumber: 1, storedObjectId: legacy.storedObjectId },
          });
          counts.pagesCreated += 1;
        }
      }
    });

    log?.info({ ...counts }, "documents backfill batch");
  }

  log?.info({ ...counts }, "documents backfill complete");
  return counts;
}
