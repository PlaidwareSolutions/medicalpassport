import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma, type PrismaClient } from "@medpass/database";
import { backfillDocumentKind, backfillDocuments } from "./backfill-documents";

/**
 * Phase 3 documents backfill (docs_v2/04 §7.3). Needs a database; skipped
 * without DATABASE_URL, the same convention as the other backfill suites and
 * the worker integration tests.
 */
describe("backfillDocumentKind", () => {
  it("renames only the two kinds V2 respelled, and leaves the rest alone", () => {
    expect(backfillDocumentKind("lab_report")).toBe("laboratory_report");
    expect(backfillDocumentKind("scan_report")).toBe("imaging_report");
    expect(backfillDocumentKind("prescription")).toBe("prescription");
    expect(backfillDocumentKind("strip")).toBe("strip");
    expect(backfillDocumentKind("discharge_summary")).toBe("discharge_summary");
    expect(backfillDocumentKind("other")).toBe("other");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("Phase 3 documents backfill", () => {
  let prisma: PrismaClient;
  let profileId: string;
  let userId: string;
  let prescriptionId: string;
  let legacyPrescriptionDocId: string;
  let legacyLabDocId: string;
  let legacyReportDocId: string;
  let diagnosticReportId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    const user = await prisma.user.create({
      data: { phoneDigest: `docs-backfill-${randomUUID()}`, phoneCiphertext: "not-a-real-ciphertext" },
    });
    userId = user.id;
    const profile = await prisma.patientProfile.create({
      data: { ownerUserId: userId, displayName: "Documents Backfill", timezone: "Asia/Kolkata" },
    });
    profileId = profile.id;

    const prescription = await prisma.prescription.create({ data: { patientProfileId: profileId } });
    prescriptionId = prescription.id;

    // A V1 medical report that the diagnostics backfill has already remapped…
    const medicalReport = await prisma.medicalReport.create({
      data: { patientProfileId: profileId, kind: "blood_test", recordedByUserId: userId },
    });
    const diagnostic = await prisma.diagnosticReport.create({
      data: { patientProfileId: profileId, title: "CBC", legacyMedicalReportId: medicalReport.id },
    });
    diagnosticReportId = diagnostic.id;

    const makeLegacy = async (kind: "prescription" | "lab_report", link: Record<string, string>) => {
      const object = await prisma.storedObject.create({
        data: {
          bucket: "patient_docs",
          objectKey: `backfill/${randomUUID()}`,
          contentType: "image/png",
          status: "verified",
          sizeBytes: 1234,
        },
      });
      const doc = await prisma.prescriptionDocument.create({
        data: { patientProfileId: profileId, storedObjectId: object.id, kind, status: "uploaded", ...link },
      });
      return doc.id;
    };

    legacyPrescriptionDocId = await makeLegacy("prescription", { prescriptionId });
    legacyLabDocId = await makeLegacy("lab_report", {});
    legacyReportDocId = await makeLegacy("lab_report", { reportId: medicalReport.id });
  });

  afterAll(async () => {
    await prisma.documentPage.deleteMany({ where: { document: { patientProfileId: profileId } } });
    await prisma.patientDocument.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.prescriptionDocument.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.diagnosticResult.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.diagnosticReport.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.medicalReport.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.prescription.deleteMany({ where: { patientProfileId: profileId } });
    // The backfill projects a timeline event per document, and health_events
    // has an FK to the profile — so these have to go before the profile does.
    await prisma.healthEvent.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.patientProfile.deleteMany({ where: { id: profileId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("makes one PatientDocument and one page per V1 document, copying the links", async () => {
    const counts = await backfillDocuments(prisma);
    expect(counts.scanned).toBeGreaterThanOrEqual(3);

    const migrated = await prisma.patientDocument.findMany({
      where: { patientProfileId: profileId },
      include: { pages: { include: { storedObject: true } } },
    });
    expect(migrated).toHaveLength(3);

    const fromPrescription = migrated.find((d) => d.legacyPrescriptionDocumentId === legacyPrescriptionDocId)!;
    expect(fromPrescription.kind).toBe("prescription");
    expect(fromPrescription.prescriptionId).toBe(prescriptionId);
    expect(fromPrescription.pageCount).toBe(1);
    expect(fromPrescription.sourceChannel).toBe("file");
    expect(fromPrescription.provenanceSource).toBe("user_entered");
    expect(fromPrescription.verification).toBe("patient_confirmed");
    // The classifier may still label these — V1's kind was a form default,
    // not the patient's decision.
    expect(fromPrescription.classifiedBy).toBeNull();

    // The original object is shared, never copied.
    const legacy = await prisma.prescriptionDocument.findUniqueOrThrow({ where: { id: legacyPrescriptionDocId } });
    expect(fromPrescription.pages).toHaveLength(1);
    expect(fromPrescription.pages[0]!.pageNumber).toBe(1);
    expect(fromPrescription.pages[0]!.storedObjectId).toBe(legacy.storedObjectId);
  });

  it("maps V1's kind spellings onto the ones V2 reads", async () => {
    await backfillDocuments(prisma);
    const lab = await prisma.patientDocument.findUniqueOrThrow({
      where: { legacyPrescriptionDocumentId: legacyLabDocId },
    });
    expect(lab.kind).toBe("laboratory_report");
  });

  it("resolves a V1 reportId through the diagnostics backfill's legacy link", async () => {
    await backfillDocuments(prisma);
    const fromReport = await prisma.patientDocument.findUniqueOrThrow({
      where: { legacyPrescriptionDocumentId: legacyReportDocId },
    });
    expect(fromReport.diagnosticReportId).toBe(diagnosticReportId);
  });

  it("is idempotent — a second run creates nothing new", async () => {
    await backfillDocuments(prisma);
    const before = await prisma.patientDocument.count({ where: { patientProfileId: profileId } });
    const pagesBefore = await prisma.documentPage.count({ where: { document: { patientProfileId: profileId } } });

    const counts = await backfillDocuments(prisma);

    expect(await prisma.patientDocument.count({ where: { patientProfileId: profileId } })).toBe(before);
    expect(await prisma.documentPage.count({ where: { document: { patientProfileId: profileId } } })).toBe(pagesBefore);
    // Everything it touched this time already existed.
    expect(counts.documentsUpdated).toBeGreaterThanOrEqual(3);
  });

  it("leaves the V1 rows and their endpoints untouched", async () => {
    await backfillDocuments(prisma);
    const legacy = await prisma.prescriptionDocument.findMany({ where: { patientProfileId: profileId } });
    expect(legacy).toHaveLength(3);
    expect(legacy.every((d) => d.status === "uploaded")).toBe(true);
  });
});
